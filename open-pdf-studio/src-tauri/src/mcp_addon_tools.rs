//! Add-on tools: MCP tools that an installed add-on registers at run time.
//!
//! The WebView owns the tools (handler, argument validation, the user's
//! approval for tools that change something, the audit log; see
//! `js/mcp/addon-tools.js`). It sends their descriptors here with
//! `mcp_addon_tools_set` whenever the set changes, so `tools/list` can offer
//! them, and a `tools/call` for one of them goes back to the WebView as the
//! `mcp:addon-call` bridge event.
//!
//! Names are namespaced: `addon_<id>_<tool>`, with `<id>` lowercase letters
//! and digits only (so the first `_` after `addon_` ends it) and the whole
//! name within the `^[a-zA-Z0-9_-]{1,64}$` that common model APIs accept for
//! a tool name. A name that collides with a built-in tool or with another
//! add-on tool is refused, and so is a set with an invalid descriptor: the
//! set is replaced as a whole or not at all.

use std::sync::{Arc, OnceLock, RwLock};

use serde_json::{json, Value};

/// The version of the descriptor format below. The WebView sends it along;
/// another version is refused rather than half understood.
pub const ADDON_TOOLS_API_VERSION: u32 = 1;

pub const PREFIX: &str = "addon_";
const MAX_NAAM: usize = 64;
const MAX_TOOLS: usize = 128;
const MAX_TITEL: usize = 80;
const MAX_BESCHRIJVING: usize = 4000;
const MAX_SCHEMA_BYTES: usize = 16 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct AddonTool {
    pub naam: String,
    pub titel: String,
    pub beschrijving: String,
    pub schema: Value,
    pub schrijft: bool,
}

impl AddonTool {
    /// The `tools/list` entry, annotated like the built-in tools: a tool
    /// that writes is never read-only and always destructive, so a client
    /// asks before it calls one (the app asks as well).
    pub fn descriptor(&self) -> Value {
        json!({
            "name": self.naam,
            "description": self.beschrijving,
            "inputSchema": self.schema,
            "annotations": {
                "title": self.titel,
                "readOnlyHint": !self.schrijft,
                "destructiveHint": self.schrijft,
                "openWorldHint": false,
            },
        })
    }
}

#[derive(Default)]
pub struct AddonRegister {
    tools: RwLock<Vec<AddonTool>>,
}

impl AddonRegister {
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the whole set. Every descriptor is checked first; one bad
    /// descriptor refuses the set and keeps the previous one.
    pub fn vervang(
        &self,
        api_version: u32,
        descriptors: &[Value],
        is_ingebouwd: impl Fn(&str) -> bool,
    ) -> Result<usize, String> {
        if api_version != ADDON_TOOLS_API_VERSION {
            return Err(format!(
                "add-on tools API version {api_version} is not supported (this app: {ADDON_TOOLS_API_VERSION})"
            ));
        }
        if descriptors.len() > MAX_TOOLS {
            return Err(format!("too many add-on tools ({} > {MAX_TOOLS})", descriptors.len()));
        }
        let mut nieuw: Vec<AddonTool> = Vec::with_capacity(descriptors.len());
        for d in descriptors {
            let tool = lees_descriptor(d)?;
            if is_ingebouwd(&tool.naam) {
                return Err(format!("add-on tool '{}' collides with a built-in tool", tool.naam));
            }
            if nieuw.iter().any(|t| t.naam == tool.naam) {
                return Err(format!("add-on tool '{}' is registered twice", tool.naam));
            }
            nieuw.push(tool);
        }
        let aantal = nieuw.len();
        *self.tools.write().map_err(|e| format!("add-on register lock: {e}"))? = nieuw;
        Ok(aantal)
    }

    pub fn tool(&self, naam: &str) -> Option<AddonTool> {
        self.tools.read().ok()?.iter().find(|t| t.naam == naam).cloned()
    }

    pub fn descriptors(&self) -> Vec<Value> {
        self.tools.read().map(|t| t.iter().map(AddonTool::descriptor).collect()).unwrap_or_default()
    }
}

/// The register the running app uses (the MCP server and the Tauri command).
pub fn globaal() -> Arc<AddonRegister> {
    static GLOBAAL: OnceLock<Arc<AddonRegister>> = OnceLock::new();
    GLOBAAL.get_or_init(|| Arc::new(AddonRegister::new())).clone()
}

/// `addon_<id>_<tool>`: id `[a-z][a-z0-9]{1,23}`, tool `[a-z][a-z0-9_]*`,
/// at most 64 characters in all.
pub fn geldige_naam(naam: &str) -> bool {
    if naam.len() > MAX_NAAM || !naam.is_ascii() {
        return false;
    }
    let Some(rest) = naam.strip_prefix(PREFIX) else { return false };
    let Some((id, tool)) = rest.split_once('_') else { return false };
    let klein_of_cijfer = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    let id_goed = (2..=24).contains(&id.len())
        && id.starts_with(|c: char| c.is_ascii_lowercase())
        && id.chars().all(klein_of_cijfer);
    let tool_goed = !tool.is_empty()
        && tool.starts_with(|c: char| c.is_ascii_lowercase())
        && tool.chars().all(|c| klein_of_cijfer(c) || c == '_')
        && !tool.ends_with('_');
    id_goed && tool_goed
}

fn tekst<'a>(d: &'a Value, veld: &str, max: usize, naam: &str) -> Result<&'a str, String> {
    let s = d.get(veld).and_then(Value::as_str).unwrap_or("").trim();
    if s.is_empty() || s.chars().count() > max {
        return Err(format!("add-on tool '{naam}': '{veld}' must be 1-{max} characters"));
    }
    Ok(s)
}

fn lees_descriptor(d: &Value) -> Result<AddonTool, String> {
    let naam = d.get("name").and_then(Value::as_str).unwrap_or("");
    if !geldige_naam(naam) {
        return Err(format!("invalid add-on tool name '{naam}' (expected addon_<id>_<tool>)"));
    }
    let titel = tekst(d, "title", MAX_TITEL, naam)?;
    let beschrijving = tekst(d, "description", MAX_BESCHRIJVING, naam)?;
    let schema = d.get("inputSchema").cloned().unwrap_or(Value::Null);
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(format!("add-on tool '{naam}': inputSchema must be a JSON schema of type 'object'"));
    }
    if let Some(p) = schema.get("properties") {
        if !p.is_object() {
            return Err(format!("add-on tool '{naam}': inputSchema.properties must be an object"));
        }
    }
    if schema.to_string().len() > MAX_SCHEMA_BYTES {
        return Err(format!("add-on tool '{naam}': inputSchema is larger than {MAX_SCHEMA_BYTES} bytes"));
    }
    let schrijft = match d.get("writes") {
        Some(Value::Bool(b)) => *b,
        _ => return Err(format!("add-on tool '{naam}': 'writes' must be true or false")),
    };
    Ok(AddonTool {
        naam: naam.to_string(),
        titel: titel.to_string(),
        beschrijving: beschrijving.to_string(),
        schema,
        schrijft,
    })
}

/// Called by the WebView with the complete set of add-on tools.
#[tauri::command]
pub fn mcp_addon_tools_set(api_version: u32, tools: Vec<Value>) -> Result<usize, String> {
    globaal().vervang(api_version, &tools, |n| crate::mcp_tool_meta::meta(n).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(naam: &str, schrijft: bool) -> Value {
        json!({
            "name": naam, "title": "A tool", "description": "Does a thing.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "writes": schrijft,
        })
    }

    #[test]
    fn namen_zijn_genamespaced() {
        for goed in ["addon_ab_x", "addon_acme2_list_things", "addon_xy_a1_b2"] {
            assert!(geldige_naam(goed), "{goed}");
        }
        for fout in ["app_x", "addon_", "addon_a_x", "addon_Ab_x", "addon_ab_", "addon_ab_X",
                     "addon_ab_x.y", "addon_ab_x_", "addon_1b_x", "addon_ab-c_x", "addon.ab.x"] {
            assert!(!geldige_naam(fout), "{fout}");
        }
        let lang = format!("addon_ab_{}", "x".repeat(60));
        assert!(!geldige_naam(&lang));
    }

    #[test]
    fn set_wordt_in_zijn_geheel_vervangen_of_geweigerd() {
        let r = AddonRegister::new();
        assert_eq!(r.vervang(1, &[tool("addon_ab_read", false), tool("addon_ab_write", true)], |_| false), Ok(2));
        assert!(r.tool("addon_ab_write").unwrap().schrijft);
        // A duplicate refuses the whole set; the previous set stays.
        let fout = r.vervang(1, &[tool("addon_ab_one", false), tool("addon_ab_one", false)], |_| false);
        assert!(fout.unwrap_err().contains("twice"));
        assert!(r.tool("addon_ab_read").is_some());
        assert!(r.tool("addon_ab_one").is_none());
        // Collision with a built-in name.
        let fout = r.vervang(1, &[tool("addon_ab_read", false)], |n| n == "addon_ab_read");
        assert!(fout.unwrap_err().contains("built-in"));
        // Unsupported API version.
        assert!(r.vervang(2, &[], |_| false).is_err());
        // Empty set clears.
        assert_eq!(r.vervang(1, &[], |_| false), Ok(0));
        assert!(r.descriptors().is_empty());
    }

    #[test]
    fn descriptor_wordt_gecontroleerd() {
        let r = AddonRegister::new();
        let mut zonder_writes = tool("addon_ab_x", false);
        zonder_writes.as_object_mut().unwrap().remove("writes");
        assert!(r.vervang(1, &[zonder_writes], |_| false).unwrap_err().contains("writes"));
        let mut geen_object = tool("addon_ab_x", false);
        geen_object["inputSchema"] = json!({ "type": "string" });
        assert!(r.vervang(1, &[geen_object], |_| false).unwrap_err().contains("type 'object'"));
        let mut geen_titel = tool("addon_ab_x", false);
        geen_titel["title"] = json!("  ");
        assert!(r.vervang(1, &[geen_titel], |_| false).unwrap_err().contains("'title'"));
        let mut groot = tool("addon_ab_x", false);
        groot["inputSchema"]["description"] = json!("x".repeat(MAX_SCHEMA_BYTES));
        assert!(r.vervang(1, &[groot], |_| false).unwrap_err().contains("larger"));
    }

    #[test]
    fn descriptor_draagt_de_hints() {
        let r = AddonRegister::new();
        r.vervang(1, &[tool("addon_ab_read", false), tool("addon_ab_write", true)], |_| false).unwrap();
        let d = r.descriptors();
        assert_eq!(d[0]["annotations"]["readOnlyHint"], true);
        assert_eq!(d[0]["annotations"]["destructiveHint"], false);
        assert_eq!(d[1]["annotations"]["readOnlyHint"], false);
        assert_eq!(d[1]["annotations"]["destructiveHint"], true);
        assert_eq!(d[1]["inputSchema"]["type"], "object");
        assert!(d[1].get("writes").is_none(), "the flag travels as annotations only");
    }
}
