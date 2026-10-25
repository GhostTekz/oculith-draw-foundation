//! Byte ranges of an open PDF, read on demand.
//!
//! A large file is not read into the page at open. `file_range_open` opens
//! the file once and keeps the handle; PDF.js and the other readers then ask
//! for the ranges they need with `file_range_read`. Every range comes from
//! that one handle, so they all belong to the version that was opened:
//!
//! - a file replaced on disk (an atomic save renames a new file over it)
//!   keeps the opened version readable through the handle where the system
//!   allows it (POSIX). The editor's own save releases the handle first and
//!   keeps the old bytes in memory (see the loader's range source).
//! - a file written in place changes its length or modification time; each
//!   read checks both on the handle and fails instead of mixing versions.
//!
//! Only files inside the editor's filesystem scope can be opened.

use std::collections::HashMap;
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde::Serialize;
use tauri_plugin_fs::FsExt;

/// The longest range one read returns.
const MAX_RANGE: u64 = 64 * 1024 * 1024;

pub const CHANGED_ON_DISK: &str = "file-changed-on-disk";

struct Source {
    file: File,
    length: u64,
    modified: Option<SystemTime>,
}

#[derive(Default)]
pub struct FileRanges {
    next: AtomicU64,
    open: Mutex<HashMap<u64, Arc<Source>>>,
}

#[derive(Serialize)]
pub struct OpenedRange {
    id: u64,
    length: u64,
}

fn unchanged(source: &Source) -> Result<(), String> {
    let meta = source.file.metadata().map_err(|e| e.to_string())?;
    if meta.len() != source.length || meta.modified().ok() != source.modified {
        return Err(CHANGED_ON_DISK.to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn read_at(file: &File, buf: &mut [u8], offset: u64) -> std::io::Result<()> {
    use std::os::unix::fs::FileExt;
    file.read_exact_at(buf, offset)
}

#[cfg(windows)]
fn read_at(file: &File, mut buf: &mut [u8], mut offset: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    while !buf.is_empty() {
        let n = file.seek_read(buf, offset)?;
        if n == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        buf = &mut buf[n..];
        offset += n as u64;
    }
    Ok(())
}

fn read_range(source: &Source, begin: u64, end: u64) -> Result<Vec<u8>, String> {
    if begin > end || end > source.length {
        return Err(format!("Range {begin}-{end} outside the file ({} bytes)", source.length));
    }
    if end - begin > MAX_RANGE {
        return Err(format!("Range of {} bytes is too long", end - begin));
    }
    unchanged(source)?;
    let mut out = vec![0u8; (end - begin) as usize];
    read_at(&source.file, &mut out, begin).map_err(|e| e.to_string())?;
    // A write while reading: the bytes may mix two versions.
    unchanged(source)?;
    Ok(out)
}

fn open_source(path: &Path) -> Result<Source, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".to_string());
    }
    Ok(Source { length: meta.len(), modified: meta.modified().ok(), file })
}

/// Open `path` for range reads: `{ id, length }`.
#[tauri::command(async)]
pub fn file_range_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, FileRanges>,
    path: String,
) -> Result<OpenedRange, String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !app.fs_scope().is_allowed(p) {
        return Err("Path is outside the authorized filesystem scope".to_string());
    }
    let source = open_source(p)?;
    let length = source.length;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.open.lock().map_err(|e| e.to_string())?.insert(id, Arc::new(source));
    Ok(OpenedRange { id, length })
}

/// Bytes `begin..end` of the opened version, raw. Fails with
/// `file-changed-on-disk` once the file was written in place.
#[tauri::command(async)]
pub fn file_range_read(
    state: tauri::State<'_, FileRanges>,
    id: u64,
    begin: u64,
    end: u64,
) -> Result<tauri::ipc::Response, String> {
    let source = state.open.lock().map_err(|e| e.to_string())?
        .get(&id).cloned().ok_or("Range source is closed")?;
    Ok(tauri::ipc::Response::new(read_range(&source, begin, end)?))
}

/// Release the handle. A read already running finishes on its own copy.
#[tauri::command(async)]
pub fn file_range_close(state: tauri::State<'_, FileRanges>, id: u64) -> Result<bool, String> {
    Ok(state.open.lock().map_err(|e| e.to_string())?.remove(&id).is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reads_ranges_and_refuses_a_file_written_in_place() {
        let dir = std::env::temp_dir().join(format!("file-range-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.pdf");
        std::fs::write(&path, b"0123456789").unwrap();
        let source = open_source(&path).unwrap();
        assert_eq!(read_range(&source, 2, 5).unwrap(), b"234");
        assert!(read_range(&source, 5, 11).is_err());
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(b"x").unwrap();
        drop(f);
        assert_eq!(read_range(&source, 0, 1).unwrap_err(), CHANGED_ON_DISK);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
