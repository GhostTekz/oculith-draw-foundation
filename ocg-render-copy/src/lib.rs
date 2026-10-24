//! Restricted render-only OCG configuration copy. This module never writes a
//! PDF path; the original file remains the source of truth for saving.
use anyhow::{anyhow, bail, Context, Result};
use lopdf::{Document, Object, ObjectId};
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

/// One catalog OCG reference and its selected view state. An empty slice
/// means the source PDF's default optional-content configuration.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct LayerVisibility {
    pub object_number: u32,
    pub generation: u16,
    pub visible: bool,
}

const MAX_OVERRIDES: usize = 512;

pub fn canonical_visibility(requested: &[LayerVisibility]) -> Result<Vec<LayerVisibility>> {
    if requested.len() > MAX_OVERRIDES {
        bail!("too many OCG visibility overrides");
    }
    let mut sorted = requested.to_vec();
    sorted.sort_by_key(|item| (item.object_number, item.generation));
    if sorted.iter().any(|item| item.object_number == 0) {
        bail!("OCG object number must be nonzero");
    }
    if sorted.windows(2).any(|pair| {
        pair[0].object_number == pair[1].object_number && pair[0].generation == pair[1].generation
    }) {
        bail!("duplicate OCG visibility override");
    }
    Ok(sorted)
}

/// Serialize a separate, in-memory copy with selected groups in the default
/// /ON or /OFF arrays. Restricted to ordinary catalog OCGs and a direct
/// default configuration; unsupported structure returns an error rather than
/// rendering a possibly inconsistent mixture of states.
pub fn render_copy(source: &[u8], visibility: &[LayerVisibility]) -> Result<Vec<u8>> {
    if visibility.is_empty() {
        bail!("an empty selection should render the original bytes");
    }
    let mut pdf = Document::load_mem(source).context("parse PDF for OCG render copy")?;
    if pdf.trailer.get(b"Encrypt").is_ok() {
        bail!("encrypted PDFs do not support OCG render copies");
    }
    let root = pdf.trailer.get(b"Root")?.as_reference()?;
    let oc = pdf
        .get_dictionary(root)?
        .get(b"OCProperties")?
        .as_dict()
        .map_err(|_| anyhow!("indirect /OCProperties is not supported"))?;
    if oc.get(b"Configs").is_ok() {
        bail!("alternate OCG configurations are not supported");
    }
    let groups: HashSet<ObjectId> = oc
        .get(b"OCGs")?
        .as_array()?
        .iter()
        .map(|item| item.as_reference().map_err(anyhow::Error::from))
        .collect::<Result<_>>()?;
    let config = oc
        .get(b"D")?
        .as_dict()
        .map_err(|_| anyhow!("indirect default OCG configuration is not supported"))?;
    for key in [b"AS".as_slice(), b"RBGroups", b"Locked"] {
        if config.get(key).is_ok() {
            bail!("OCG configuration with AS, radio groups or locked groups is not supported");
        }
    }
    if let Ok(base) = config.get(b"BaseState") {
        if !matches!(base.as_name()?, b"ON" | b"OFF") {
            bail!("unsupported OCG BaseState");
        }
    }
    for key in [b"ON".as_slice(), b"OFF"] {
        if let Ok(list) = config.get(key) {
            list.as_array()?;
        }
    }
    for item in visibility {
        let id = (item.object_number, item.generation);
        if !groups.contains(&id) {
            bail!("OCG visibility override does not name a catalog group");
        }
        let group = pdf.get_dictionary(id)?;
        if group.get(b"Type")?.as_name()? != b"OCG" {
            bail!("OCG visibility override names a non-OCG object");
        }
    }

    let config = pdf
        .get_dictionary_mut(root)?
        .get_mut(b"OCProperties")?
        .as_dict_mut()?
        .get_mut(b"D")?
        .as_dict_mut()?;
    for item in visibility {
        let reference = Object::Reference((item.object_number, item.generation));
        for key in [b"ON".as_slice(), b"OFF"] {
            if let Ok(list) = config.get_mut(key) {
                list.as_array_mut()?.retain(|value| value != &reference);
            }
        }
        let key = if item.visible {
            b"ON".as_slice()
        } else {
            b"OFF".as_slice()
        };
        if let Ok(list) = config.get_mut(key) {
            list.as_array_mut()?.push(reference);
        } else {
            config.set(key, Object::Array(vec![reference]));
        }
    }
    let mut output = Vec::new();
    pdf.save_to(&mut output)
        .context("serialize OCG render copy")?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(object_number: u32, visible: bool) -> LayerVisibility {
        LayerVisibility {
            object_number,
            generation: 0,
            visible,
        }
    }

    #[test]
    fn canonical_selection_is_order_independent_and_rejects_duplicates() {
        assert_eq!(
            canonical_visibility(&[layer(6, false), layer(5, true)]).unwrap(),
            vec![layer(5, true), layer(6, false)]
        );
        assert!(canonical_visibility(&[layer(6, false), layer(6, true)]).is_err());
    }
}
