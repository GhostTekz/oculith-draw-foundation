//! Isolated K-001 feasibility probe. This never feeds transformed bytes to
//! the app's file-path worker, document cache, or save pipeline.

#[path = "support/ocg_fixture.rs"]
mod ocg_fixture;

use lopdf::{Document, Object, ObjectId};
use pdfium_render::prelude::*;

/// Only supports this fixture's direct /OCProperties and /D dictionaries.
/// The source slice is immutable; serialization returns a distinct render copy.
fn fixture_render_copy(source: &[u8], group: ObjectId, visible: bool) -> Vec<u8> {
    let mut pdf = Document::load_mem(source).unwrap();
    assert!(
        pdf.trailer.get(b"Encrypt").is_err(),
        "encrypted PDFs are outside this probe"
    );
    let root = pdf.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let oc = pdf
        .get_dictionary(root)
        .unwrap()
        .get(b"OCProperties")
        .unwrap()
        .as_dict()
        .unwrap();
    assert!(
        oc.get(b"OCGs")
            .unwrap()
            .as_array()
            .unwrap()
            .contains(&Object::Reference(group)),
        "visibility selection must name a catalog OCG reference"
    );
    let config = pdf
        .get_dictionary_mut(root)
        .unwrap()
        .get_mut(b"OCProperties")
        .unwrap()
        .as_dict_mut()
        .unwrap()
        .get_mut(b"D")
        .unwrap()
        .as_dict_mut()
        .unwrap();
    assert_eq!(config.get(b"BaseState").unwrap().as_name().unwrap(), b"ON");
    for key in [b"ON".as_slice(), b"OFF".as_slice()] {
        if let Ok(list) = config.get_mut(key) {
            list.as_array_mut()
                .unwrap()
                .retain(|entry| entry != &Object::Reference(group));
        }
    }
    let key = if visible {
        b"ON".as_slice()
    } else {
        b"OFF".as_slice()
    };
    if let Ok(list) = config.get_mut(key) {
        list.as_array_mut().unwrap().push(Object::Reference(group));
    } else {
        config.set(key, Object::Array(vec![Object::Reference(group)]));
    }
    let mut output = Vec::new();
    pdf.save_to(&mut output).unwrap();
    output
}

fn render_probes(pdfium: &Pdfium, bytes: &[u8]) -> ([u8; 3], [u8; 3], [u8; 3]) {
    let document = pdfium.load_pdf_from_byte_slice(bytes, None).unwrap();
    let page = document.pages().get(0).unwrap();
    let full = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_target_width(100)
                .set_maximum_height(100)
                .render_annotations(false)
                .set_format(PdfBitmapFormat::BGRA),
        )
        .unwrap();
    assert_eq!((full.width(), full.height()), (100, 100));
    let full = full.as_rgba_bytes();
    let pixel = |x: usize| {
        let offset = (75 * 100 + x) * 4;
        [full[offset], full[offset + 1], full[offset + 2]]
    };
    let region = page
        .render_with_config(
            &PdfRenderConfig::new()
                .set_fixed_size(50, 50)
                .transform(1.0, 0.0, 0.0, 1.0, -50.0, -50.0)
                .unwrap()
                .render_annotations(false)
                .set_format(PdfBitmapFormat::BGRA),
        )
        .unwrap();
    assert_eq!((region.width(), region.height()), (50, 50));
    let region = region.as_rgba_bytes();
    let offset = (25 * 50 + 25) * 4;
    (
        pixel(25),
        pixel(75),
        [region[offset], region[offset + 1], region[offset + 2]],
    )
}

#[test]
fn render_copy_can_toggle_hidden_ocg_on_and_off_in_full_and_region_pixels() {
    if !cfg!(target_os = "linux") {
        eprintln!("Skipping: only bundled Linux PDFium has been characterized");
        return;
    }
    let lib_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../open-pdf-studio/src-tauri/binaries/linux-x64");
    if !lib_dir.join("libpdfium.so").exists() {
        eprintln!("Skipping: bundled Linux PDFium unavailable");
        return;
    }
    let bindings =
        Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&lib_dir)).unwrap();
    let pdfium = Pdfium::new(bindings);
    let original = ocg_fixture::ocg_fixture();
    let source_snapshot = original.clone();
    let on = fixture_render_copy(&original, (6, 0), true);
    let off = fixture_render_copy(&original, (6, 0), false);
    assert_eq!(
        original, source_snapshot,
        "source bytes must remain unchanged"
    );
    assert_ne!(on, original, "render copy must be a distinct byte buffer");

    for (label, bytes, expect_blue) in [
        ("source", original.as_slice(), false),
        ("ON", on.as_slice(), true),
        ("OFF", off.as_slice(), false),
    ] {
        let (red, blue_full, blue_region) = render_probes(&pdfium, bytes);
        assert!(
            red[0] > 200 && red[1] < 50 && red[2] < 50,
            "{label}: visible OCG={red:?}"
        );
        for (path, pixel) in [("full", blue_full), ("region", blue_region)] {
            if expect_blue {
                assert!(
                    pixel[2] > 200 && pixel[0] < 50 && pixel[1] < 50,
                    "{label} {path}={pixel:?}"
                );
            } else {
                assert!(
                    pixel.iter().all(|channel| *channel > 200),
                    "{label} {path}={pixel:?}"
                );
            }
        }
        eprintln!(
            "K-001 {label}: red={red:?}, blue full={blue_full:?}, blue region={blue_region:?}"
        );
    }
}

#[test]
#[should_panic(expected = "visibility selection must name a catalog OCG reference")]
fn render_copy_rejects_unknown_ocg_reference() {
    fixture_render_copy(&ocg_fixture::ocg_fixture(), (99, 0), true);
}
