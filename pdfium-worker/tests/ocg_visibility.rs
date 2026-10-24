//! Native OCG render characterization. Run with:
//! `cargo test -p pdfium-worker --test ocg_visibility -- --nocapture`
//!
//! This guards PDFium's default visibility and the worker's selected render
//! copy. The app does not yet pass selected state into all display paths, so
//! the UI toggle remains disabled (K-001).

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::process::{Command, Stdio};
use pdfium_render::prelude::*;

#[path = "support/ocg_fixture.rs"]
mod ocg_fixture;
use ocg_fixture::ocg_fixture;

#[test]
fn worker_render_applies_default_and_selected_ocg_visibility() {
    if !cfg!(target_os = "linux") {
        eprintln!(
            "Skipping native OCG pixel check: only the bundled Linux runtime is characterized"
        );
        return;
    }
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping native OCG pixel check: Linux PDFium runtime unavailable");
        return;
    }
    let unique = format!(
        "ocg-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let pdf_path = std::env::temp_dir().join(format!("{unique}.pdf"));
    let source = ocg_fixture();
    std::fs::write(&pdf_path, &source).unwrap();
    let slot = 97;
    let mut command = Command::new(env!("CARGO_BIN_EXE_pdfium-worker"));
    command
        .arg(slot.to_string())
        .arg(&unique)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    command.current_dir(&lib_dir);
    let mut child = command.spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    assert!(line.contains("\"op\":\"ready\""), "{line}");
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"op":"render", "id":1, "path":pdf_path,
        "page_index":0, "scale":1.0, "rotation":0})
    )
    .unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let response: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(response["ok"], true, "{response}");
    assert_eq!(response["w"], 100);
    assert_eq!(response["h"], 100);
    let shm = std::env::temp_dir().join(format!("pdfium-worker-{unique}-{slot}.shm"));
    let mut file = std::fs::File::open(&shm).unwrap();
    file.seek(SeekFrom::Start(32)).unwrap();
    let mut rgba = vec![0; response["shm_bytes"].as_u64().unwrap() as usize];
    file.read_exact(&mut rgba).unwrap();
    let pixel = |x: usize, y: usize| -> &[u8] { &rgba[(y * 100 + x) * 4..(y * 100 + x) * 4 + 4] };
    let visible = pixel(25, 75);
    let hidden = pixel(75, 75);
    assert!(
        visible[0] > 200 && visible[1] < 50 && visible[2] < 50,
        "visible OCG should be red, got {visible:?}"
    );
    eprintln!("K-001 native OCG: visible red={visible:?}, default-hidden blue={hidden:?}; default visibility honored, interactive switching unavailable");
    assert!(
        hidden[0] > 200 && hidden[1] > 200 && hidden[2] > 200,
        "default-OFF OCG should leave the white page visible, got {hidden:?}"
    );
    writeln!(
        stdin,
        "{}",
        serde_json::json!({"op":"render_region", "id":2, "path":pdf_path,
        "page_index":0, "scale":1.0, "rotation":0,
        "region_x_pt":50.0, "region_y_pt":50.0,
        "region_w_pt":50.0, "region_h_pt":50.0})
    )
    .unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let region: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(region["ok"], true, "{region}");
    assert_eq!((region["w"].as_u64(), region["h"].as_u64()), (Some(50), Some(50)));
    file.seek(SeekFrom::Start(32 + ((25 * 50 + 25) * 4) as u64)).unwrap();
    let mut hidden_region_pixel = [0u8; 4];
    file.read_exact(&mut hidden_region_pixel).unwrap();
    assert!(
        hidden_region_pixel[0..3].iter().all(|channel| *channel > 200),
        "default-OFF OCG should also leave a white region tile, got {hidden_region_pixel:?}"
    );
    // One worker process reuses its document cache. ON -> OFF must replace
    // the render-only copy for both full pages and region tiles, while the
    // original PDF file remains byte-for-byte unchanged.
    for (id, op, visible) in [
        (3, "render", true),
        (4, "render_region", true),
        (5, "render", false),
        (6, "render_region", false),
    ] {
        let mut request = serde_json::json!({
            "op": op, "id": id, "path": pdf_path,
            "page_index": 0, "scale": 1.0, "rotation": 0,
            "ocg_visibility": [{ "object_number": 6, "generation": 0, "visible": visible }],
        });
        if op == "render_region" {
            request["region_x_pt"] = 50.0.into();
            request["region_y_pt"] = 50.0.into();
            request["region_w_pt"] = 50.0.into();
            request["region_h_pt"] = 50.0.into();
        }
        writeln!(stdin, "{request}").unwrap();
        line.clear();
        stdout.read_line(&mut line).unwrap();
        let response: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(response["ok"], true, "{response}");
        let width = response["w"].as_u64().unwrap();
        if op == "render" {
            file.seek(SeekFrom::Start(32 + ((75 * width + 25) * 4))).unwrap();
            let mut red = [0u8; 4];
            file.read_exact(&mut red).unwrap();
            assert!(red[0] > 200 && red[1] < 50 && red[2] < 50,
                "unselected visible OCG changed during {op}: {red:?}");
        }
        let x = if op == "render" { 75 } else { 25 };
        let y = x;
        file.seek(SeekFrom::Start(32 + ((y * width + x) * 4))).unwrap();
        let mut pixel = [0u8; 4];
        file.read_exact(&mut pixel).unwrap();
        if visible {
            assert!(pixel[2] > 200 && pixel[0] < 50 && pixel[1] < 50,
                "selected ON {op} should be blue, got {pixel:?}");
        } else {
            assert!(pixel[0..3].iter().all(|channel| *channel > 200),
                "selected OFF {op} should be white, got {pixel:?}");
        }
    }
    assert_eq!(std::fs::read(&pdf_path).unwrap(), source,
        "selected visibility must never rewrite the source PDF");
    writeln!(stdin, "{}", serde_json::json!({
        "op": "render", "id": 7, "path": pdf_path,
        "page_index": 0, "scale": 1.0, "rotation": 0,
        "ocg_visibility": [{ "object_number": 99, "generation": 0, "visible": true }],
    })).unwrap();
    line.clear();
    stdout.read_line(&mut line).unwrap();
    let unknown: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(unknown["ok"], false, "unknown OCG must fail closed: {unknown}");
    writeln!(stdin, "{{\"op\":\"shutdown\"}}").unwrap();
    drop(stdin);
    assert!(child.wait().unwrap().success());
    std::fs::remove_file(pdf_path).unwrap();
    std::fs::remove_file(shm).unwrap();
}

/// PDFium exposes FPDFPageObj_SetIsActive, but that flag is distinct from
/// optional-content visibility. Keep this probe until a native OCG API or a
/// verified in-memory configuration path can turn a default-OFF group ON.
#[test]
fn activating_a_page_object_does_not_turn_its_ocg_on() {
    if !cfg!(target_os = "linux") {
        eprintln!("Skipping native OCG activation probe: Linux runtime only");
        return;
    }
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping native OCG activation probe: Linux PDFium runtime unavailable");
        return;
    }

    let bindings = Pdfium::bind_to_library(
        Pdfium::pdfium_platform_library_name_at_path(&lib_dir),
    ).unwrap();
    let pdfium = Pdfium::new(bindings);
    let bytes = ocg_fixture();
    let doc = pdfium.load_pdf_from_byte_slice(&bytes, None).unwrap();
    let page = doc.pages().get(0).unwrap();
    let render = || page.render_with_config(
        &PdfRenderConfig::new().set_target_width(100).set_maximum_height(100),
    ).unwrap().as_rgba_bytes();
    let pixel = |rgba: &[u8], x: usize| -> [u8; 3] {
        let offset = (75 * 100 + x) * 4;
        [rgba[offset], rgba[offset + 1], rgba[offset + 2]]
    };

    let before = render();
    assert!(pixel(&before, 75).iter().all(|channel| *channel > 200));
    assert_eq!(page.objects().len(), 2, "fixture should expose both page objects");
    let mut hidden = page.objects().get(1).unwrap();
    assert!(hidden.is_active().unwrap(), "default-OFF object starts active");
    hidden.set_inactive().unwrap();
    assert!(!hidden.is_active().unwrap());
    hidden.set_active().unwrap();
    assert!(hidden.is_active().unwrap());
    let after_activation = render();
    assert!(
        pixel(&after_activation, 75).iter().all(|channel| *channel > 200),
        "FPDFPageObj_SetIsActive(true) cannot reveal a default-OFF OCG; got {:?}",
        pixel(&after_activation, 75)
    );

    let mut visible = page.objects().get(0).unwrap();
    visible.set_inactive().unwrap();
    let after_deactivation = render();
    assert!(
        pixel(&after_deactivation, 25).iter().all(|channel| *channel > 200),
        "page-object activation should suppress the visible red object; got {:?}",
        pixel(&after_deactivation, 25)
    );
}
