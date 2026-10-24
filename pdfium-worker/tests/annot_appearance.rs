//! The worker rasters only the annotations the app hands over by /NM, with
//! their own appearance (/AP), and hides every other markup. Run with:
//! `cargo test -p pdfium-worker --test annot_appearance -- --nocapture`

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::process::{Command, Stdio};

/// 100 pt page, no page content. Two Square markups whose appearance fills
/// their /Rect: "keep" red on the left, "drop" blue on the right.
fn fixture() -> Vec<u8> {
    let red = "1 0 0 rg 0 0 30 30 re f\n";
    let blue = "0 0 1 rg 0 0 30 30 re f\n";
    let empty = "";
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Annots [5 0 R 6 0 R] >>".to_string(),
        format!("<< /Length {} >>\nstream\n{}endstream", empty.len(), empty),
        "<< /Type /Annot /Subtype /Square /NM (keep) /Rect [10 10 40 40] /F 4 /AP << /N 7 0 R >> >>".to_string(),
        "<< /Type /Annot /Subtype /Square /NM (drop) /Rect [60 10 90 40] /F 4 /AP << /N 8 0 R >> >>".to_string(),
        format!("<< /Type /XObject /Subtype /Form /BBox [0 0 30 30] /Length {} >>\nstream\n{}endstream", red.len(), red),
        format!("<< /Type /XObject /Subtype /Form /BBox [0 0 30 30] /Length {} >>\nstream\n{}endstream", blue.len(), blue),
    ];
    let mut pdf = b"%PDF-1.5\n".to_vec();
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
fn worker_rasters_only_the_requested_annotation_appearances() {
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
        "annot-ap-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    );
    let pdf_path = std::env::temp_dir().join(format!("{unique}.pdf"));
    std::fs::write(&pdf_path, fixture()).unwrap();
    let slot = 96;
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
    assert_eq!(ready["annot_appearance"], true, "worker announces the capability: {line}");
    let shm = std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm"));

    let mut render = |request: serde_json::Value| -> (u64, Vec<u8>) {
        writeln!(stdin, "{request}").unwrap();
        line.clear();
        stdout.read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        let mut file = std::fs::File::open(&shm).unwrap();
        file.seek(SeekFrom::Start(32)).unwrap();
        let mut rgba = vec![0; response["shm_bytes"].as_u64().unwrap() as usize];
        file.read_exact(&mut rgba).unwrap();
        (response["w"].as_u64().unwrap(), rgba)
    };
    let page = |id: u64, show: Option<&[&str]>| {
        let mut r = serde_json::json!({"op":"render", "id":id, "path":pdf_path,
            "page_index":0, "scale":1.0, "rotation":0});
        if let Some(show) = show { r["annot_appearance"] = serde_json::json!(show); }
        r
    };
    let px = |rgba: &[u8], w: u64, x: u64, y: u64| -> [u8; 3] {
        let i = ((y * w + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2]]
    };
    let white = [255, 255, 255];
    let red = [255, 0, 0];
    let blue = [0, 0, 255];

    // Without the option nothing changes: no annotations in the bitmap.
    let (w, rgba) = render(page(1, None));
    assert_eq!(px(&rgba, w, 25, 75), white);
    assert_eq!(px(&rgba, w, 75, 75), white);

    // Only "keep" from its appearance.
    let (w, rgba) = render(page(2, Some(&["keep"])));
    assert_eq!(px(&rgba, w, 25, 75), red);
    assert_eq!(px(&rgba, w, 75, 75), white);

    // The next render decides afresh (flags from the previous call do not leak).
    let (w, rgba) = render(page(3, Some(&["drop"])));
    assert_eq!(px(&rgba, w, 25, 75), white);
    assert_eq!(px(&rgba, w, 75, 75), blue);

    // An empty list: annotations on, every markup hidden.
    let (w, rgba) = render(page(4, Some(&[])));
    assert_eq!(px(&rgba, w, 25, 75), white);
    assert_eq!(px(&rgba, w, 75, 75), white);

    // Region tiles follow the same rule.
    let (w, rgba) = render(serde_json::json!({"op":"render_region", "id":5, "path":pdf_path,
        "page_index":0, "scale":2.0, "rotation":0, "region_x_pt":0.0, "region_y_pt":50.0,
        "region_w_pt":100.0, "region_h_pt":50.0, "annot_appearance":["keep"]}));
    assert_eq!(w, 200);
    assert_eq!(px(&rgba, w, 50, 50), red);
    assert_eq!(px(&rgba, w, 150, 50), white);

    writeln!(stdin, "{}", serde_json::json!({"op":"shutdown"})).unwrap();
    let _ = child.wait();
    let _ = std::fs::remove_file(&pdf_path);
    let _ = std::fs::remove_file(&shm);
}

/// Three Squares: red without /NM, blue and green sharing one /NM.
fn fixture_without_unique_names() -> Vec<u8> {
    let fill = |c: &str| format!("{c} rg 0 0 20 20 re f\n");
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [4 0 R 5 0 R 6 0 R] >>".to_string(),
        "<< /Type /Annot /Subtype /Square /Rect [10 10 30 30] /F 4 /AP << /N 7 0 R >> >>".to_string(),
        "<< /Type /Annot /Subtype /Square /NM (twin) /Rect [40 10 60 30] /F 4 /AP << /N 8 0 R >> >>".to_string(),
        "<< /Type /Annot /Subtype /Square /NM (twin) /Rect [70 10 90 30] /F 4 /AP << /N 9 0 R >> >>".to_string(),
        { let c = fill("1 0 0"); format!("<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length {} >>\nstream\n{}endstream", c.len(), c) },
        { let c = fill("0 0 1"); format!("<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length {} >>\nstream\n{}endstream", c.len(), c) },
        { let c = fill("0 1 0"); format!("<< /Type /XObject /Subtype /Form /BBox [0 0 20 20] /Length {} >>\nstream\n{}endstream", c.len(), c) },
    ];
    let mut pdf = b"%PDF-1.5\n".to_vec();
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
fn worker_selects_markups_by_annots_position_when_names_are_missing_or_shared() {
    if !cfg!(target_os = "linux") {
        return;
    }
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping: Linux PDFium runtime unavailable");
        return;
    }
    let unique = format!(
        "annot-idx-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    );
    let pdf_path = std::env::temp_dir().join(format!("{unique}.pdf"));
    std::fs::write(&pdf_path, fixture_without_unique_names()).unwrap();
    let slot = 94;
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
    assert_eq!(ready["annot_appearance_index"], true, "{line}");
    let shm = std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm"));
    let mut render = |request: serde_json::Value| -> (u64, Vec<u8>) {
        writeln!(stdin, "{request}").unwrap();
        line.clear();
        stdout.read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        let mut file = std::fs::File::open(&shm).unwrap();
        file.seek(SeekFrom::Start(32)).unwrap();
        let mut rgba = vec![0; response["shm_bytes"].as_u64().unwrap() as usize];
        file.read_exact(&mut rgba).unwrap();
        (response["w"].as_u64().unwrap(), rgba)
    };
    let px = |rgba: &[u8], w: u64, x: u64, y: u64| -> [u8; 3] {
        let i = ((y * w + x) * 4) as usize;
        [rgba[i], rgba[i + 1], rgba[i + 2]]
    };
    let page = |id: u64, extra: serde_json::Value| {
        let mut r = serde_json::json!({"op":"render", "id":id, "path":pdf_path,
            "page_index":0, "scale":1.0, "rotation":0});
        for (k, v) in extra.as_object().unwrap() { r[k] = v.clone(); }
        r
    };
    let white = [255, 255, 255];
    // Positions 0 (no /NM) and 2 (second of the twins): only those two.
    let (w, rgba) = render(page(1, serde_json::json!({"annot_appearance_index": [0, 2]})));
    assert_eq!(px(&rgba, w, 20, 80), [255, 0, 0]);
    assert_eq!(px(&rgba, w, 50, 80), white);
    assert_eq!(px(&rgba, w, 80, 80), [0, 255, 0]);
    // Names and positions together; an out-of-range position is ignored.
    let (w, rgba) = render(page(2, serde_json::json!({"annot_appearance": ["nobody"], "annot_appearance_index": [1, 99]})));
    assert_eq!(px(&rgba, w, 20, 80), white);
    assert_eq!(px(&rgba, w, 50, 80), [0, 0, 255]);
    assert_eq!(px(&rgba, w, 80, 80), white);

    writeln!(stdin, "{}", serde_json::json!({"op":"shutdown"})).unwrap();
    let _ = child.wait();
    let _ = std::fs::remove_file(&pdf_path);
    let _ = std::fs::remove_file(&shm);
}
