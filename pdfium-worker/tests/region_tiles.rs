//! A region tile must be that slice of the page, not a thumbnail of the
//! whole sheet. Run with:
//! `cargo test -p pdfium-worker --test region_tiles -- --nocapture`

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

/// 200×100 pt page. The left half is red, the right half is blue.
fn fixture() -> Vec<u8> {
    let stream = "1 0 0 rg\n0 0 100 100 re f\n0 0 1 rg\n100 0 100 100 re f\n";
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}endstream", stream.len(), stream),
    ];
    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", index + 1, object).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes(),
    );
    pdf
}

#[test]
fn region_tiles_are_slices_not_thumbnails() {
    if !cfg!(target_os = "linux") {
        eprintln!("Skipping: only the bundled Linux runtime is characterized");
        return;
    }
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping: Linux PDFium runtime unavailable");
        return;
    }
    let unique = format!(
        "region-tiles-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    );
    let pdf_path = std::env::temp_dir().join(format!("{unique}.pdf"));
    std::fs::write(&pdf_path, fixture()).unwrap();
    let slot = 97;
    let mut child = Command::new(env!("CARGO_BIN_EXE_pdfium-worker"))
        .arg(slot.to_string())
        .arg(&unique)
        .current_dir(&lib_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let ready: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(ready["op"], "ready", "worker did not start: {line}");

    let mut render = |id: u64, x: f64| {
        writeln!(stdin, "{}", serde_json::json!({
            "op": "render_region", "id": id, "path": pdf_path,
            "page_index": 0, "scale": 1.0, "rotation": 0,
            "region_x_pt": x, "region_y_pt": 0.0,
            "region_w_pt": 100.0, "region_h_pt": 100.0
        })).unwrap();
        line.clear();
        stdout.read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        let shm = std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm"));
        let mut file = std::fs::File::open(&shm).unwrap();
        use std::io::{Read, Seek, SeekFrom};
        file.seek(SeekFrom::Start(32)).unwrap();
        let mut rgba = vec![0; response["shm_bytes"].as_u64().unwrap() as usize];
        file.read_exact(&mut rgba).unwrap();
        (response["w"].as_u64().unwrap(), rgba)
    };
    let px = |rgba: &[u8], w: u64, x: u64, y: u64| -> [u8; 3] {
        let i = ((y * w + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2]]
    };
    let red = [255, 0, 0];
    let blue = [0, 0, 255];

    let (w, left) = render(1, 0.0);
    assert_eq!(w, 100);
    assert_eq!(px(&left, w, 25, 50), red, "left tile must be the red half, not a thumbnail");
    assert_eq!(px(&left, w, 75, 50), red, "left tile must not also contain the blue half");

    let (w, right) = render(2, 100.0);
    assert_eq!(w, 100);
    assert_eq!(px(&right, w, 25, 50), blue, "right tile must be the blue half, not a thumbnail");
    assert_eq!(px(&right, w, 75, 50), blue, "right tile must not also contain the red half");

    writeln!(stdin, "{}", serde_json::json!({"op":"shutdown"})).unwrap();
    let _ = child.wait();
    let _ = std::fs::remove_file(&pdf_path);
    let _ = std::fs::remove_file(std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm")));
}
