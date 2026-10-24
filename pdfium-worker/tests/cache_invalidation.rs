use std::fs::{File, FileTimes, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::process::{Command, Stdio};

fn drawing_pdf(color: &str) -> Vec<u8> {
    let content = format!("{color} rg 10 10 80 80 re f\n");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>".to_string(),
        format!(
            "<< /Length {} >>\nstream\n{}endstream",
            content.len(),
            content
        ),
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, object).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
    );
    pdf
}

fn exchange(
    stdin: &mut impl Write,
    stdout: &mut impl BufRead,
    request: serde_json::Value,
) -> serde_json::Value {
    writeln!(stdin, "{request}").unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    serde_json::from_str(&line).unwrap()
}

#[test]
fn same_path_same_size_same_mtime_reloads_after_invalidation() {
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if cfg!(target_os = "linux") && !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping: Linux PDFium runtime is unavailable");
        return;
    }

    let red = drawing_pdf("1 0 0");
    let blue = drawing_pdf("0 0 1");
    assert_eq!(red.len(), blue.len());
    let unique = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let path = std::env::temp_dir().join(format!("oculith-pdf-cache-{unique}.pdf"));
    std::fs::write(&path, &red).unwrap();
    let old_mtime = std::fs::metadata(&path).unwrap().modified().unwrap();

    let slot = 99;
    let mut command = Command::new(env!("CARGO_BIN_EXE_pdfium-worker"));
    command
        .arg(slot.to_string())
        .arg(&unique)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if cfg!(target_os = "linux") {
        command.current_dir(&lib_dir);
    }
    let mut child = command.spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ready = String::new();
    stdout.read_line(&mut ready).unwrap();
    assert!(ready.contains("\"op\":\"ready\""), "{ready}");

    let render = |id| serde_json::json!({ "op":"render", "id":id, "path":path, "page_index":0, "scale":1.0, "rotation":0 });
    let first = exchange(&mut stdin, &mut stdout, render(1));
    assert_eq!(first["ok"], true, "{first}");
    let shm = std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm"));
    let pixels = |response: &serde_json::Value| {
        let mut file = File::open(&shm).unwrap();
        file.seek(SeekFrom::Start(32)).unwrap();
        let mut bytes = vec![0; response["shm_bytes"].as_u64().unwrap() as usize];
        file.read_exact(&mut bytes).unwrap();
        bytes
    };
    let red_pixels = pixels(&first);

    std::fs::write(&path, &blue).unwrap();
    OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(FileTimes::new().set_modified(old_mtime))
        .unwrap();
    let meta = std::fs::metadata(&path).unwrap();
    assert_eq!(meta.len(), red.len() as u64);
    assert_eq!(meta.modified().unwrap(), old_mtime);

    // The old worker cache really does stay warm without explicit eviction.
    let stale = exchange(&mut stdin, &mut stdout, render(2));
    assert_eq!(stale["ok"], true, "{stale}");
    assert_eq!(pixels(&stale), red_pixels);

    let ack = exchange(
        &mut stdin,
        &mut stdout,
        serde_json::json!({ "op":"invalidate", "id":3, "path":path }),
    );
    assert_eq!(ack["id"], 3);
    assert_eq!(ack["ok"], true);
    let fresh = exchange(&mut stdin, &mut stdout, render(4));
    assert_eq!(fresh["ok"], true, "{fresh}");
    assert_ne!(pixels(&fresh), red_pixels);

    writeln!(stdin, "{{\"op\":\"shutdown\"}}").unwrap();
    drop(stdin);
    assert!(child.wait().unwrap().success());
    std::fs::remove_file(path).unwrap();
}
