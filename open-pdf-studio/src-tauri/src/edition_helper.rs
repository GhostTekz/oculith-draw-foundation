//! The optional add-on helper bridge: a published, generic part of the editor.
//!
//! A full edition may declare one helper. Independent native packages may
//! each declare a helper. The editor starts a verified helper on its first
//! call and passes JSON lines:
//!
//! - `edition_helper_call(method, params)` sends `{"id", "method", "params"}`
//!   and resolves with the helper's `result` or `error`;
//! - a line `{"event", "payload"}` from the helper is emitted to the page as
//!   the Tauri event `edition-helper` with that object.
//! - `addon_helper_call(package_id, method, params)` selects an enabled
//!   package; its events use `addon-helper` with that package ID.
//!
//! The editor knows nothing about the methods. A package without a verified
//! helper receives a "no helper" error.
//!
//! One writer task owns the helper's input and takes lines from a channel, so
//! a large request never holds up other calls behind a lock. The reader looks
//! only at a line's top-level keys: results and event lines are passed on as
//! the helper wrote them, without being parsed into a tree and written again.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Deserializer};
use serde_json::value::RawValue;
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex};

type Reply = Result<Box<RawValue>, String>;
type Pending = Arc<std::sync::Mutex<HashMap<u64, oneshot::Sender<Reply>>>>;

/// Request lines waiting for the writer; a full queue makes callers wait
/// (without any lock held) instead of growing without bound.
const QUEUE: usize = 64;
const STOPPED: &str = "The edition helper stopped.";
const EVENT: &str = "edition-helper";

/// One request line for the writer task, with the id it answers to.
struct Outgoing {
    id: u64,
    line: Vec<u8>,
}

struct Running {
    queue: mpsc::Sender<Outgoing>,
    child: Child,
    pending: Pending,
}

#[derive(Default)]
pub struct EditionHelper {
    running: Mutex<HashMap<String, Running>>,
    next: AtomicU64,
}

const NO_HELPER: &str = "This edition has no helper.";
const NO_PACKAGE_HELPER: &str = "This package has no enabled, verified helper.";

/// The top-level keys of a helper line, borrowed from it unparsed. A key that
/// is present (even as `null`) is `Some`.
#[derive(Deserialize)]
struct Line<'a> {
    #[serde(borrow, default, deserialize_with = "present")]
    id: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present")]
    event: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present")]
    payload: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present")]
    result: Option<&'a RawValue>,
    #[serde(borrow, default, deserialize_with = "present")]
    error: Option<&'a RawValue>,
}

fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<&'de RawValue>, D::Error> {
    <&RawValue>::deserialize(d).map(Some)
}

/// Whether the selected add-on ships a helper.
#[tauri::command]
pub fn edition_helper_available(app: tauri::AppHandle) -> bool {
    crate::selected_helper_available(&app)
}

fn fail(pending: &Pending, id: u64) {
    if let Some(tx) = pending.lock().unwrap().remove(&id) {
        let _ = tx.send(Err(STOPPED.into()));
    }
}

/// Pass one helper line on: an event to the page, a reply to its caller.
fn dispatch(app: &tauri::AppHandle, pending: &Pending, line: String, package_id: Option<&str>) {
    let Ok(message) = serde_json::from_str::<Line>(&line) else { return };
    if let Some(event) = message.event {
        // Checked as JSON above, so it can go to the page as written.
        if let Some(package_id) = package_id {
            if serde_json::from_str::<String>(event.get()).is_ok() {
                let wrapped = format!(r#"{{"packageId":{},"event":{},"payload":{}}}"#,
                    serde_json::to_string(package_id).expect("package id is serializable"),
                    event.get(), message.payload.map_or("null", RawValue::get));
                let _ = app.emit_str("addon-helper", wrapped);
            }
        } else { let _ = app.emit_str(EVENT, line); }
        return;
    }
    let Some(id) = message.id.and_then(|id| serde_json::from_str::<u64>(id.get()).ok()) else {
        // An error the helper could not tie to a call (a line it could
        // not read): passed on, not dropped, so the page can show it.
        if message.error.is_some() {
            if let Some(package_id) = package_id {
                let _ = app.emit_str("addon-helper", json!({"packageId": package_id, "event": "helper-error", "payload": line}).to_string());
            } else {
                let _ = app.emit_str(EVENT, format!(r#"{{"event":"helper-error","payload":{line}}}"#));
            }
        }
        return;
    };
    let reply = match message.error {
        Some(error) => Err(serde_json::from_str::<String>(error.get()).unwrap_or_else(|_| error.get().to_owned())),
        None => Ok(message.result.map_or_else(|| RawValue::NULL.to_owned(), |r| r.to_owned())),
    };
    if let Some(tx) = pending.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

async fn start(app: &tauri::AppHandle, path: std::path::PathBuf, package_id: Option<String>) -> Result<Running, String> {
    let data_dir = crate::datamap::tauri_map(app, crate::datamap::TauriMap::Data).map_err(|e| e.to_string())?;
    let mut child = Command::new(path)
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("The edition helper could not start: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("The edition helper has no input.")?;
    let stdout = child.stdout.take().ok_or("The edition helper has no output.")?;
    let pending: Pending = Default::default();

    // The writer: the only owner of the helper's input.
    let (queue, mut lines_out) = mpsc::channel::<Outgoing>(QUEUE);
    let writer_pending = pending.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(out) = lines_out.recv().await {
            let sent = async {
                stdin.write_all(&out.line).await?;
                stdin.flush().await
            }
            .await;
            if sent.is_err() {
                // The helper no longer reads: this call and every queued one
                // fail, and the closed queue makes the next call restart it.
                fail(&writer_pending, out.id);
                lines_out.close();
                while let Some(out) = lines_out.recv().await {
                    fail(&writer_pending, out.id);
                }
                break;
            }
        }
    });

    let reader_pending = pending.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            dispatch(&app, &reader_pending, line, package_id.as_deref());
        }
        // The helper ended: every call still waiting fails, and the page is
        // told, so work the helper had accepted (and would have answered
        // with events) fails too instead of waiting forever.
        for (_, tx) in reader_pending.lock().unwrap().drain() {
            let _ = tx.send(Err(STOPPED.into()));
        }
        if let Some(package_id) = package_id {
            let _ = app.emit_str("addon-helper", json!({"packageId": package_id, "event": "helper-exit", "payload": null}).to_string());
        } else {
            let _ = app.emit_str(EVENT, r#"{"event":"helper-exit"}"#.to_owned());
        }
    });
    Ok(Running { queue, child, pending })
}

/// Send one call to the edition helper and wait for its answer. Methods
/// under `host.` are the editor's own and cannot be called from the page.
#[tauri::command]
pub async fn edition_helper_call(
    app: tauri::AppHandle,
    state: tauri::State<'_, EditionHelper>,
    method: String,
    params: Option<Value>,
) -> Result<Box<RawValue>, String> {
    if method.starts_with("host.") {
        return Err(format!("Unknown helper method: {method}"));
    }
    send(&app, &state, None, &method, params.unwrap_or(Value::Null)).await
}

/// Call the verified helper belonging to one enabled add-on package.
#[tauri::command]
pub fn addon_helper_available(app: tauri::AppHandle, package_id: String) -> bool {
    crate::package_helper_path(&app, &package_id).is_some()
}

#[tauri::command]
pub async fn addon_helper_call(
    app: tauri::AppHandle,
    state: tauri::State<'_, EditionHelper>,
    package_id: String,
    method: String,
    params: Option<Value>,
) -> Reply {
    if method.starts_with("host.") { return Err(format!("Unknown helper method: {method}")); }
    send(&app, &state, Some(&package_id), &method, params.unwrap_or(Value::Null)).await
}

/// Share a file the page may open (one in the editor's file scope) with the
/// helper, so an edition can read it there, for example to upload it.
#[tauri::command]
pub async fn edition_helper_share_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, EditionHelper>,
    path: String,
) -> Result<bool, String> {
    use tauri_plugin_fs::FsExt;
    if !std::path::Path::new(&path).is_absolute() || !app.fs_scope().is_allowed(std::path::Path::new(&path)) {
        return Err("This file is not open in the editor.".into());
    }
    send(&app, &state, None, "host.shareFile", json!({ "path": path })).await?;
    Ok(true)
}

async fn send(app: &tauri::AppHandle, state: &EditionHelper, package_id: Option<&str>, method: &str, params: Value) -> Reply {
    if let Some(package_id) = package_id {
        if !crate::package_helper_enabled(app, package_id) {
            let mut running = state.running.lock().await;
            if let Some(mut old) = running.remove(package_id) { let _ = old.child.start_kill(); }
            return Err(NO_PACKAGE_HELPER.into());
        }
    }
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    let mut line = serde_json::to_vec(&json!({ "id": id, "method": method, "params": params })).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let (tx, rx) = oneshot::channel();
    // The lock covers only the liveness check and the registration; the
    // write itself happens in the writer task.
    let (queue, pending) = {
        let mut running = state.running.lock().await;
        let key = package_id.unwrap_or("").to_owned();
        // Start (or restart, after it stopped) the helper.
        let alive = running
            .get_mut(&key)
            .is_some_and(|r| !r.queue.is_closed() && r.child.try_wait().ok().flatten().is_none());
        if !alive {
            let path = match package_id {
                Some(id) => crate::package_helper_path(app, id).ok_or(NO_PACKAGE_HELPER)?,
                None => crate::selected_helper_path(app).ok_or(NO_HELPER)?,
            };
            running.insert(key.clone(), start(app, path, package_id.map(str::to_owned)).await?);
        }
        let helper = running.get(&key).expect("started above");
        helper.pending.lock().unwrap().insert(id, tx);
        (helper.queue.clone(), helper.pending.clone())
    };
    if queue.send(Outgoing { id, line }).await.is_err() {
        pending.lock().unwrap().remove(&id);
        return Err(STOPPED.into());
    }
    rx.await.map_err(|_| STOPPED.to_string())?
}

const FILE_CAP: u64 = 250 * 1024 * 1024;
const NOT_A_DRAWING: &str = "This is not a downloaded drawing.";

/// Let the page open a drawing the helper downloaded: an existing, direct
/// PDF in the app's own `drawings` folder, nothing else. Saved links are
/// data, so they cannot authorize a path somewhere else.
#[tauri::command]
pub fn edition_allow_drawing(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    use tauri_plugin_fs::FsExt;
    let root = crate::datamap::tauri_map(&app, crate::datamap::TauriMap::Data)
        .map_err(|_| NOT_A_DRAWING.to_string())?
        .join("drawings");
    let pdf = std::path::Path::new(&path);
    check_drawing(&root, pdf)?;
    app.fs_scope().allow_file(pdf).map_err(|_| NOT_A_DRAWING.to_string())?;
    Ok(true)
}

fn check_drawing(root: &std::path::Path, pdf: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    let fail = || NOT_A_DRAWING.to_string();
    let is_pdf = pdf.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("pdf"));
    if pdf.parent() != Some(root) || !is_pdf {
        return Err(fail());
    }
    let metadata = pdf.symlink_metadata().map_err(|_| fail())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > FILE_CAP {
        return Err(fail());
    }
    let real_root = dunce::canonicalize(root).map_err(|_| fail())?;
    let real_pdf = dunce::canonicalize(pdf).map_err(|_| fail())?;
    if real_pdf.parent() != Some(real_root.as_path()) {
        return Err(fail());
    }
    let mut magic = [0; 5];
    std::fs::File::open(pdf).and_then(|mut f| f.read_exact(&mut magic)).map_err(|_| fail())?;
    if &magic != b"%PDF-" {
        return Err(fail());
    }
    Ok(())
}
