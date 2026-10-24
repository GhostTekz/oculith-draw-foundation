// The tile-scene engine must refuse pages whose drawing it would get wrong
// (ExtGState alpha/blend/soft mask, shadings, patterns, Type3, Separation
// colour) so they render through PDFium. Plain line work stays accepted.
use lopdf::{dictionary, Document, Object, Stream};
use open_pdf_render::DocumentHandle;

fn page_pdf(content: &[u8], resources: lopdf::Dictionary) -> Vec<u8> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut stream = Stream::new(dictionary! {}, content.to_vec());
    stream.compress().unwrap();
    let content_id = doc.add_object(stream);
    let res_id = doc.add_object(resources);
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 200.into(), 200.into()],
        "Contents" => content_id,
        "Resources" => res_id,
    });
    doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1,
    }));
    let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
    doc.trailer.set("Root", catalog_id);
    let mut out = Vec::new();
    doc.save_to(&mut out).unwrap();
    out
}

fn reason(content: &[u8], resources: lopdf::Dictionary) -> Option<String> {
    DocumentHandle::load(&page_pdf(content, resources)).unwrap().scene_unsupported_reason(0).unwrap()
}

#[test]
fn plain_linework_is_accepted() {
    assert_eq!(reason(b"0.24 w 0 0 0 RG 10 10 m 190 190 l S", dictionary! {}), None);
    // An opaque Normal ExtGState is harmless.
    let gs = dictionary! { "ExtGState" => dictionary! { "G0" => dictionary! { "CA" => 1, "ca" => 1, "BM" => "Normal" } } };
    assert_eq!(reason(b"/G0 gs 10 10 m 190 190 l S", gs), None);
    // "sh" inside a longer token is not the shading operator.
    assert_eq!(reason(b"/shx gs", dictionary! {}), None);
}

#[test]
fn transparency_and_special_painting_are_refused() {
    let alpha = dictionary! { "ExtGState" => dictionary! { "G0" => dictionary! { "ca" => 0.5 } } };
    assert!(reason(b"/G0 gs 0 0 50 50 re f", alpha).unwrap().contains("alpha"));
    let blend = dictionary! { "ExtGState" => dictionary! { "G0" => dictionary! { "BM" => "Multiply" } } };
    assert!(reason(b"/G0 gs", blend).unwrap().contains("blend"));
    let smask = dictionary! { "ExtGState" => dictionary! { "G0" => dictionary! { "SMask" => dictionary! { "S" => "Luminosity" } } } };
    assert!(reason(b"/G0 gs", smask).unwrap().contains("soft mask"));
    assert!(reason(b"/Sh0 sh", dictionary! {}).unwrap().contains("sh"));
    let pattern = dictionary! { "Pattern" => dictionary! { "P0" => dictionary! { "PatternType" => 2 } } };
    assert!(reason(b"", pattern).unwrap().contains("pattern"));
    let sep = dictionary! { "ColorSpace" => dictionary! { "CS0" => vec![Object::Name(b"Separation".to_vec()), Object::Name(b"Spot".to_vec()), Object::Name(b"DeviceCMYK".to_vec()), Object::Null] } };
    assert!(reason(b"/CS0 cs 1 scn", sep).unwrap().contains("Separation"));
    let t3 = dictionary! { "Font" => dictionary! { "F0" => dictionary! { "Type" => "Font", "Subtype" => "Type3" } } };
    assert!(reason(b"", t3).unwrap().contains("Type3"));
}

#[test]
fn a_form_xobject_is_scanned_too() {
    let mut form = Stream::new(dictionary! {
        "Type" => "XObject", "Subtype" => "Form",
        "BBox" => vec![0.into(), 0.into(), 10.into(), 10.into()],
        "Resources" => dictionary! { "ExtGState" => dictionary! { "G0" => dictionary! { "CA" => 0.3 } } },
    }, b"/G0 gs 0 0 m 10 10 l S".to_vec());
    form.compress().unwrap();
    let mut doc_bytes = page_pdf(b"/Fm0 Do", dictionary! {});
    // Rebuild with the form attached (page_pdf takes inline resources only).
    let mut doc = Document::load_mem(&doc_bytes).unwrap();
    let form_id = doc.add_object(form);
    let page_id = *doc.get_pages().get(&1).unwrap();
    let res_id = doc.get_dictionary(page_id).unwrap().get(b"Resources").unwrap().as_reference().unwrap();
    doc.get_dictionary_mut(res_id).unwrap().set("XObject", dictionary! { "Fm0" => form_id });
    doc_bytes.clear();
    doc.save_to(&mut doc_bytes).unwrap();
    let r = DocumentHandle::load(&doc_bytes).unwrap().scene_unsupported_reason(0).unwrap();
    assert!(r.unwrap().contains("alpha"));
}
