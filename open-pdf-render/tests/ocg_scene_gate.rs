#[path = "../../pdfium-worker/tests/support/ocg_fixture.rs"]
mod ocg_fixture;

use open_pdf_render::DocumentHandle;

#[test]
fn optional_content_is_detected_before_scene_cache_use() {
    let source = ocg_fixture::ocg_fixture();
    let handle = DocumentHandle::load(&source).unwrap();
    assert!(handle.has_optional_content());

    let mut plain = lopdf::Document::load_mem(&source).unwrap();
    let root = plain.trailer.get(b"Root").unwrap().as_reference().unwrap();
    plain.get_dictionary_mut(root).unwrap().remove(b"OCProperties");
    let mut plain_bytes = Vec::new();
    plain.save_to(&mut plain_bytes).unwrap();
    assert!(!DocumentHandle::load(&plain_bytes).unwrap().has_optional_content());
}
