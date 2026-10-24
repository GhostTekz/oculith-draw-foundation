//! Tauri-commando's voor de export van een PDF-pagina naar DXF of DWG (#400).
//!
//! Dunne schil om de crate `open-pdf-cad`: alle logica — ook het lezen van de
//! argumenten — zit daar en is zonder de app te bouwen en te testen. Hier
//! gebeurt alleen wat de app zelf weet:
//! waar de PDFium-bibliotheek staat, welk slot de renderer gebruikt, en hoe
//! voortgang en afbreken naar de webview gaan.
//!
//! Verloop van één export:
//! 1. `export_page_to_cad` registreert een afbreekvlag onder `jobId` en zet het
//!    werk op een blokkerende werkdraad; de IPC-draad blijft vrij.
//! 2. Uitlezen gebeurt achter het in-proc-slot van de renderer, want PDFium is
//!    niet thread-safe. Het slot gaat los zodra de pagina is uitgelezen;
//!    opbouwen en schrijven van het CAD-bestand houden de renderer niet op.
//! 3. Voortgang gaat als event `cad-export-progress` naar de webview, hooguit
//!    tien keer per seconde plus bij elke fasewissel.
//! 4. `cancel_cad_export` zet de vlag, of bewaart het verzoek als het
//!    startcommando nog niet is geregistreerd. De export stopt tussen twee objecten,
//!    ook tijdens het opbouwen en schrijven van het CAD-bestand, en laat geen
//!    half bestand achter: het deelbestand komt pas op de plek van het doel als
//!    de vlag vlak vóór het hernoemen nog niet gezet is. Komt de export met een
//!    verslag terug, dan stáát het bestand er, ook als de vlag daarna nog gezet
//!    wordt.
//!
//! `scan_page_for_cad` telt vooraf per laag wat de export zou maken (voor de
//! lagenlijst en de omvanggrens in het exportvenster); ook die is af te breken.

use open_pdf_cad::{ExportArgs, ExportPhase, ExportProgress, ExportReport, PageScan, PdfiumLibrary};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Lopende exports en afbreekverzoeken die hun startcommando hebben ingehaald.
#[derive(Default)]
pub struct CadExportJobs(Mutex<CadExportJobState>);

#[derive(Default)]
struct CadExportJobState {
    running: HashMap<String, Arc<AtomicBool>>,
    pending_cancel: VecDeque<String>,
    cancel_capacity_exceeded: bool,
}

impl CadExportJobs {
    fn register(&self, job_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut state = self.0.lock().map_err(|e| format!("CAD export jobs lock: {e}"))?;
        if state.running.contains_key(job_id) {
            return Err(format!("CAD job is already running: {job_id}"));
        }
        if state.cancel_capacity_exceeded {
            return Err("CAD cancellation capacity exceeded; restart OcuDraw before exporting again".to_string());
        }
        // Tauri commands may reach Rust in a different order than the webview
        // invoked them. A cancellation before registration must still win.
        let cancelled = state.pending_cancel.iter().any(|id| id == job_id);
        state.pending_cancel.retain(|id| id != job_id);
        let flag = Arc::new(AtomicBool::new(cancelled));
        state.running.insert(job_id.to_owned(), Arc::clone(&flag));
        Ok(flag)
    }

    fn finish(&self, job_id: &str) {
        if let Ok(mut state) = self.0.lock() {
            state.running.remove(job_id);
        }
    }

    fn cancel(&self, job_id: &str) -> bool {
        let Ok(mut state) = self.0.lock() else { return false };
        if let Some(flag) = state.running.get(job_id) {
            flag.store(true, Ordering::Relaxed);
            return true;
        }
        // A completed/unknown job is indistinguishable from one whose start
        // command has not arrived. Keep a bounded tombstone for the latter.
        // If the bound is exceeded, reject all later starts rather than evict
        // a cancellation that might still be waiting for its start command.
        if !state.pending_cancel.iter().any(|id| id == job_id) {
            const MAX_PENDING_CANCELS: usize = 256;
            if state.pending_cancel.len() == MAX_PENDING_CANCELS {
                state.cancel_capacity_exceeded = true;
            } else if !state.cancel_capacity_exceeded {
                state.pending_cancel.push_back(job_id.to_owned());
            }
        }
        false
    }
}

/// Eén keer gebonden; het is hetzelfde bibliotheekbestand dat de renderer laadt.
static LIBRARY: OnceLock<PdfiumLibrary> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    job_id: &'a str,
    phase: ExportPhase,
    done: u64,
    total: u64,
}

fn library(app: &tauri::AppHandle) -> Result<&'static PdfiumLibrary, String> {
    // Binding calls FPDF_InitLibrary too; serialize it with the renderer.
    let _pdfium = crate::pdfium_renderer::inproc_guard();
    if let Some(library) = LIBRARY.get() {
        return Ok(library);
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resource_dir: {e}"))?;
    let loaded = PdfiumLibrary::load(&open_pdf_cad::pdfium_library_in(&resource_dir)).map_err(|e| e.to_string())?;
    Ok(LIBRARY.get_or_init(|| loaded))
}

/// Exporteert één pagina naar DXF of DWG en geeft het exportverslag terug.
/// De argumenten (camelCase) staan beschreven bij `open_pdf_cad::ExportArgs`.
#[tauri::command]
pub async fn export_page_to_cad(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, CadExportJobs>,
    job_id: String,
    args: ExportArgs,
) -> Result<ExportReport, String> {
    let mut request = args
        .request()
        .ok_or_else(|| "Uitvoerbestand moet op .dxf of .dwg eindigen".to_string())?;

    let cancel = jobs.register(&job_id)?;

    let task = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let job_id = job_id.clone();
        let cancel = Arc::clone(&cancel);
        move || -> Result<ExportReport, String> {
            // De terugweg naar CAD staat op de pagina zelf; de crate leest
            // niets van schijf zonder dat de schil het vraagt. Geeft
            // `NO_MODEL_SPACE` of `MODEL_SPACE_AMBIGUOUS:<n>` als de oorsprong
            // van het model gevraagd is en de pagina hem niet (eenduidig) draagt.
            open_pdf_cad::resolve_model_space(&request.pdf_path, request.page_index, &mut request.options, Some(&cancel))
                .map_err(|e| e.to_string())?;
            let library = library(&app)?;
            let mut last_emit = Instant::now() - Duration::from_secs(1);
            let mut last_phase: Option<ExportPhase> = None;
            let mut on_progress = |p: ExportProgress| {
                let phase_changed = last_phase != Some(p.phase);
                if phase_changed || last_emit.elapsed() >= Duration::from_millis(100) {
                    last_phase = Some(p.phase);
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "cad-export-progress",
                        ProgressEvent { job_id: &job_id, phase: p.phase, done: p.done, total: p.total },
                    );
                }
            };

            let page = {
                // Alleen het uitlezen gebruikt PDFium: daarna is het slot weer vrij.
                let _pdfium = crate::pdfium_renderer::inproc_guard();
                open_pdf_cad::extract_page(
                    library,
                    &request.pdf_path,
                    request.page_index,
                    &request.options,
                    Some(&cancel),
                    Some(&mut on_progress),
                )
                .map_err(|e| e.to_string())?
            };
            open_pdf_cad::check_size(&page, request.max_entities).map_err(|e| e.to_string())?;
            open_pdf_cad::write_page(
                page,
                &request.output_path,
                request.format,
                request.version,
                Some(&cancel),
                Some(&mut on_progress),
            )
            .map_err(|e| e.to_string())
        }
    });

    let result = task.await.map_err(|e| format!("CAD export task panicked: {e}"));
    jobs.finish(&job_id);
    result?
}

/// Telt per laag wat de export van een pagina zou maken. Alleen `pdfPath`,
/// `pageIndex` en de opties die de laagindeling bepalen doen ertoe; het
/// uitvoerpad wordt genegeerd.
#[tauri::command]
pub async fn scan_page_for_cad(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, CadExportJobs>,
    job_id: String,
    args: ExportArgs,
) -> Result<PageScan, String> {
    let options = args.options();
    let pdf_path = std::path::PathBuf::from(&args.pdf_path);
    let page_index = args.page_index;
    let cancel = jobs.register(&job_id)?;
    let task = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let cancel = Arc::clone(&cancel);
        move || -> Result<PageScan, String> {
            let library = library(&app)?;
            let _pdfium = crate::pdfium_renderer::inproc_guard();
            open_pdf_cad::scan_page(library, &pdf_path, page_index, &options, Some(&cancel)).map_err(|e| e.to_string())
        }
    });
    let result = task.await.map_err(|e| format!("CAD scan task panicked: {e}"));
    jobs.finish(&job_id);
    result?
}

/// Vraagt een lopende export of telronde om te stoppen. Geeft `false` als de
/// start nog niet geregistreerd is; het verzoek blijft dan wel bewaard.
#[tauri::command]
pub fn cancel_cad_export(jobs: tauri::State<'_, CadExportJobs>, job_id: String) -> bool {
    jobs.cancel(&job_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use open_pdf_cad::{model::Drawing, writer::{build_document, write_document}, CadFormat, CadVersion, ExportError};

    #[test]
    fn cancellation_before_registration_prevents_output() {
        let jobs = Arc::new(CadExportJobs::default());
        let (release_start, held_start) = std::sync::mpsc::channel();
        let target = std::env::temp_dir().join(format!(
            "ocudraw-cad-cancel-before-register-{}-{}.dxf",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let worker_jobs = Arc::clone(&jobs);
        let worker_target = target.clone();
        let worker = std::thread::spawn(move || {
            held_start.recv().unwrap();
            let flag = worker_jobs.register("held-before-register").unwrap();
            assert!(flag.load(Ordering::Relaxed));
            let document = build_document(Drawing::default(), CadVersion::R2013, None).unwrap();
            let result = write_document(&document, CadFormat::Dxf, &worker_target, Some(&flag));
            worker_jobs.finish("held-before-register");
            result
        });

        assert!(!jobs.cancel("held-before-register"));
        release_start.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err(ExportError::Cancelled));
        assert!(!target.exists(), "cancelled CAD export must not commit an output file");
        assert!(!target.with_extension("dxf.deel").exists(), "cancelled CAD export must not leave a part file");
    }

    #[test]
    fn cancellation_capacity_rejects_late_starts_instead_of_eviction() {
        let jobs = CadExportJobs::default();
        let running = jobs.register("running").unwrap();
        for i in 0..257 {
            assert!(!jobs.cancel(&format!("held-{i}")));
        }
        let state = jobs.0.lock().unwrap();
        assert_eq!(state.pending_cancel.len(), 256);
        assert!(state.cancel_capacity_exceeded);
        drop(state);
        assert!(jobs.cancel("running"), "already-running exports must remain cancellable");
        assert!(running.load(Ordering::Relaxed));
        jobs.finish("running");
        assert!(jobs.register("held-0").is_err(), "oldest cancellation must not be evicted into a successful export");
        assert!(jobs.register("held-256").is_err(), "overflowing cancellation must not start an export");
    }
}
