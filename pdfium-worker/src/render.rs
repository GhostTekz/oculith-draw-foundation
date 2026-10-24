use crate::shm;
use anyhow::{anyhow, Context, Result};
use pdfium_render::prelude::*;
use std::sync::OnceLock;
use crate::protocol::LayerVisibility;

pub struct RenderResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

// Eén Pdfium-instantie voor de levensduur van de worker. Nodig om geladen
// documenten te kunnen CACHEN: PdfDocument leent van Pdfium, en via een
// 'static Pdfium krijgt de handle een 'static levensduur (zelfde patroon als
// pdfium_renderer.rs in de app). NB: pdfium-render staat maar ÉÉN binding per
// proces toe (PdfiumLibraryBindingsAlreadyInitialized) — alles loopt dus via
// deze ene instantie.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

/// Directories under `<exe_dir>/../lib/` that hold a libpdfium.so: the
/// resource folder of a Linux bundle (`usr/lib/<product name>/`).
fn linux_resource_dirs(exe_dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(exe_dir.join("../lib")) else { return Vec::new() };
    let mut dirs: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("libpdfium.so").is_file())
        .collect();
    dirs.sort();
    dirs
}

fn pdfium() -> Result<&'static Pdfium> {
    if PDFIUM.get().is_none() {
        // Zoekvolgorde voor de PDFium-bibliotheek:
        //   1. systeem-zoekpad (Windows vindt pdfium.dll naast de exe);
        //   2. naast de sidecar-binary zelf;
        //   3. ../Resources t.o.v. de binary — op macOS draait de sidecar in
        //      Contents/MacOS terwijl de gebundelde libpdfium.dylib als resource
        //      in Contents/Resources staat;
        //   4. de huidige werkdirectory (dev / handmatige runs).
        // Zonder 2/3 zou de worker op macOS geen dylib vinden en elke render
        // laten terugvallen op in-proc PDFium in de hoofd-app.
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let res_dir = exe_dir.join("../Resources");
        // Linux bundles (AppImage, .deb) put Tauri's resources in
        // usr/lib/<product name>/ next to usr/bin/<app>, so the bundled
        // libpdfium.so is there; OCUDRAW_PDFIUM_DIR overrides everything.
        let mut dirs: Vec<std::path::PathBuf> = Vec::new();
        if let Some(d) = std::env::var_os("OCUDRAW_PDFIUM_DIR") {
            dirs.push(std::path::PathBuf::from(d));
        }
        dirs.extend(linux_resource_dirs(&exe_dir));
        let bound = dirs.iter().find_map(|d| {
            Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(d)).ok()
        });
        let bindings = match bound {
            Some(b) => Ok(b),
            None => Pdfium::bind_to_system_library()
                .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&exe_dir)))
                .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(&res_dir)))
                .or_else(|_| Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path("./"))),
        }
        .context("PDFium library not found (OCUDRAW_PDFIUM_DIR, ../lib/<app>, system, exe-dir, ../Resources, or ./)")?;
        let _ = PDFIUM.set(Pdfium::new(bindings));
    }
    Ok(PDFIUM.get().expect("PDFIUM set above"))
}

/// Gecachet geladen document + open pagina-handle. Houdt de bytes levend voor
/// de document-levensduur; VELDVOLGORDE = DROP-VOLGORDE: `page` leent uit
/// `document`, `document` leent uit `_bytes`.
///
/// Safety: `document` leent uit `_bytes` (heap-buffer verplaatst niet, ook
/// niet als de struct move't) en uit PDFIUM ('static, nooit gedropt). `page`
/// leent uit `document`; de entry zit in een Box zodat het document-adres
/// stabiel is, ook als de cache-Vec verplaatst. De bytes leven per
/// constructie langer dan document en pagina binnen deze struct.
struct CachedDoc {
    path: String,
    mtime: Option<std::time::SystemTime>,
    len: u64,
    visibility: Vec<LayerVisibility>,
    /// (pagina-index, parse-duur in ms, open handle). De handle van de pagina
    /// die net getekend is blijft open, zodat een zoom- of tegelreeks niet
    /// opnieuw parset. Goedkope handles van andere documenten gaan dicht.
    page: Option<(u32, u32, PdfPage<'static>)>,
    /// Pagina-index plus keuze-hash van de laatste annotatievlag-pass.
    /// Een volgende tegel van dezelfde pagina met dezelfde keuze slaat de
    /// wandeling over. Dicht de handle, dan is deze keuze weg: een nieuwe
    /// handle heeft verse vlaggen.
    annot_applied: Option<(u32, u64)>,
    document: PdfDocument<'static>,
    _bytes: Vec<u8>,
}

impl CachedDoc {
    fn close_page(&mut self) {
        self.page = None;
        self.annot_applied = None;
    }
}

/// Max gecachete documenten per worker. Zware CAD-documenten kunnen honderden
/// MB's parse-state dragen; 2 dekt "actief document + vergelijk-/vorig doc"
/// zonder het werkgeheugen te laten ontsporen.
const DOC_CACHE_CAP: usize = 2;

pub struct Renderer {
    cache: Vec<Box<CachedDoc>>,
}

impl Renderer {
    pub fn new() -> Result<Self> {
        // Bind PDFium meteen zodat een ontbrekende DLL bij worker-start faalt
        // (Ready wordt dan nooit gemeld) i.p.v. pas bij de eerste render.
        pdfium()?;
        Ok(Self { cache: Vec::new() })
    }

    /// Cache-lookup met verversing: hit alleen als pad + mtime + lengte +
    /// gekozen OCG-stand
    /// overeenkomen (het bestand kan herschreven zijn door opslaan van
    /// annotaties). Miss → lees + parse en evict de oudste boven de cap.
    /// De parse van een zwaar CAD-document kost seconden — deze cache is
    /// wat regio-tegels goedkoop maakt.
    fn get_or_load(&mut self, path: &str, requested: &[LayerVisibility]) -> Result<usize> {
        let visibility = ocg_render_copy::canonical_visibility(requested)?;
        let meta = std::fs::metadata(path).with_context(|| format!("stat {}", path))?;
        let mtime = meta.modified().ok();
        let len = meta.len();

        if let Some(i) = self.cache.iter().position(|c| c.path == path && c.mtime == mtime && c.len == len && c.visibility == visibility) {
            return Ok(i);
        }
        // Verouderde versie van hetzelfde pad weggooien.
        self.cache.retain(|c| c.path != path);

        let source = std::fs::read(path).with_context(|| format!("read {}", path))?;
        let bytes = if visibility.is_empty() {
            source
        } else {
            ocg_render_copy::render_copy(&source, &visibility)?
        };
        // Safety: zie CachedDoc — buffer-adres is stabiel en de bytes blijven
        // in dezelfde struct levend zolang het document bestaat.
        let bytes_ref: &'static [u8] = unsafe { std::slice::from_raw_parts(bytes.as_ptr(), bytes.len()) };
        let document = pdfium()?
            .load_pdf_from_byte_slice(bytes_ref, None)
            .map_err(|e| anyhow!("PDFium parse: {}", e))?;

        if self.cache.len() >= DOC_CACHE_CAP {
            self.cache.remove(0);
        }
        self.cache.push(Box::new(CachedDoc {
            path: path.to_string(),
            mtime,
            len,
            visibility,
            page: None,
            annot_applied: None,
            document,
            _bytes: bytes,
        }));
        Ok(self.cache.len() - 1)
    }

    /// Sluit alle open pagina-handles (de dure parse-state); documenten en
    /// bytes blijven. De volgende render op die pagina betaalt eenmalig de
    /// her-parse. Aangeroepen bij pool-inactiviteit om het werkgeheugen van
    /// zware CAD-pagina's (ruim 1 GB per open handle) terug te geven.
    pub fn trim(&mut self) {
        for e in self.cache.iter_mut() {
            e.close_page();
        }
    }

    /// Do not rely on mtime/length after an atomic rewrite: either can match
    /// the previous file even when the bytes differ.
    pub fn invalidate_path(&mut self, path: &str) {
        self.cache.retain(|entry| entry.path != path);
    }

    /// Open (of hergebruik) de pagina-handle. FPDF_LoadPage parset de volledige
    /// content-stream — op zware CAD-pagina's SECONDEN per keer, en dat gebeurde
    /// voorheen bij ÉLKE regio-render opnieuw. Met een open handle betaalt
    /// alleen de eerste render die parse; daarna is een tegel puur rasterwerk.
    fn get_or_load_page(&mut self, doc_idx: usize, page_index: u32) -> Result<&PdfPage<'static>> {
        let entry = &mut self.cache[doc_idx];
        let reuse = matches!(&entry.page, Some((idx, _, _)) if *idx == page_index);
        if !reuse {
            entry.close_page(); // oude handle expliciet sluiten vóór de nieuwe opent
            // Safety: het document zit in een Box (stabiel heap-adres, ook als de
            // cache-Vec verplaatst) en leeft zolang deze entry bestaat; `page`
            // staat vóór `document` in de struct en dropt dus altijd eerder.
            let doc_ref: &'static PdfDocument<'static> =
                unsafe { &*(&entry.document as *const PdfDocument<'static>) };
            let t0 = std::time::Instant::now();
            let page = doc_ref
                .pages()
                .get(page_index as i32)
                .map_err(|e| anyhow!("page {}: {}", page_index, e))?;
            let load_ms = t0.elapsed().as_millis() as u32;
            entry.page = Some((page_index, load_ms, page));
        }
        Ok(&self.cache[doc_idx].page.as_ref().expect("zojuist gezet").2)
    }

    /// Houd de pagina die net getekend is open. Een zoom of een rij tegels
    /// raakt dezelfde parse anders bij elke bitmap opnieuw. Goedkope handles
    /// van de andere gecachete documenten gaan dicht, zodat een tweede tab
    /// geen parse-state laat liggen. Zware bladen blijven hoe dan ook open.
    fn release_other_cheap_pages(&mut self, keep_idx: usize) {
        const KEEP_HANDLE_MS: u32 = 250;
        for (i, entry) in self.cache.iter_mut().enumerate() {
            if i == keep_idx {
                continue;
            }
            let cheap = matches!(&entry.page, Some((_, load_ms, _)) if *load_ms < KEEP_HANDLE_MS);
            if cheap {
                entry.close_page();
            }
        }
    }

    pub fn render(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        visibility: &[LayerVisibility],
        annot_appearance: Option<AnnotShow>,
    ) -> Result<RenderResult> {
        let idx = self.get_or_load(path, visibility)?;
        // Laad (of hergebruik) de pagina vóór de keuze-check: een verse handle
        // wist annot_applied, anders zou een tegel de vlaggen van een dichte
        // pagina overslaan.
        {
            let _page = self.get_or_load_page(idx, page_index)?;
        }
        let annot = annot_appearance.map(|show| annot_signature(page_index, show.names, show.indices));
        let annot_ready = annot.is_some() && self.cache[idx].annot_applied == annot;
        let result = {
            let page = self.get_or_load_page(idx, page_index)?;

            let w_pt = page.width().value;
            let h_pt = page.height().value;
            let target_w = (w_pt * scale).ceil() as i32;
            let target_h = (h_pt * scale).ceil() as i32;

            // Past de bitmap niet in de SHM-regio, dan meteen een nette fout i.p.v.
            // eerst volledig rasteren en de uitkomst weggooien. De uitvoer van
            // set_target_width + set_maximum_height is in elke rotatie
            // <= target_w x target_h, dus dit is een strakke bovengrens.
            if let Err(e) = shm::ensure_bitmap_fits(target_w, target_h) {
                self.release_other_cheap_pages(idx);
                return Err(e);
            }

            let rot = match rotation.rem_euclid(360) {
                0 => PdfPageRenderRotation::None,
                90 => PdfPageRenderRotation::Degrees90,
                180 => PdfPageRenderRotation::Degrees180,
                270 => PdfPageRenderRotation::Degrees270,
                other => return Err(anyhow!("unsupported rotation {}", other)),
            };

            let config = PdfRenderConfig::new()
                .set_target_width(target_w)
                .set_maximum_height(target_h)
                .rotate(rot, true)
                .render_form_data(true)
                .render_annotations(annot_appearance.is_some())
                .use_lcd_text_rendering(true)
                .set_format(PdfBitmapFormat::BGRA);

            if let Some(show) = annot_appearance {
                if !annot_ready {
                    apply_annotation_appearance(page, show.names, show.indices)?;
                }
            }
            let bitmap = page.render_with_config(&config)
                .map_err(|e| anyhow!("PDFium render: {}", e))?;

            RenderResult {
                width: bitmap.width() as u32,
                height: bitmap.height() as u32,
                rgba: bitmap.as_rgba_bytes(),
            }
        };
        // De getekende pagina blijft open voor de volgende tegel of zoom.
        // Andere documenten met een goedkope parse laten hun handle los.
        if annot.is_some() && !annot_ready {
            self.cache[idx].annot_applied = annot;
        }
        self.release_other_cheap_pages(idx);
        Ok(result)
    }

    /// Render a sub-region of a page at `scale` into an output bitmap of
    /// (region_w_pt*scale × region_h_pt*scale) px. `rotation` (extra
    /// gebruikersrotatie) must be 0.
    ///
    /// De regio-coördinaten komen uit de viewer in WEERGAVE-ruimte (na de
    /// intrinsieke /Rotate van de pagina). De matrix-API van PDFium werkt
    /// in RUWE paginaruimte, dus voor /Rotate-pagina's wordt de rotatie in
    /// de matrix meegebakken.
    pub fn render_region(
        &mut self,
        path: &str,
        page_index: u32,
        scale: f32,
        rotation: i32,
        region_x_pt: f32,
        region_y_pt: f32,
        region_w_pt: f32,
        region_h_pt: f32,
        visibility: &[LayerVisibility],
        annot_appearance: Option<AnnotShow>,
    ) -> Result<RenderResult> {
        if rotation != 0 {
            return Err(anyhow!("render_region: rotation {} not supported", rotation));
        }
        if region_w_pt <= 0.0 || region_h_pt <= 0.0 {
            return Err(anyhow!("render_region: region must be positive"));
        }
        // Bitmap-afmetingen hangen alleen van regio + schaal af: valideer ze
        // (incl. de SHM-grens) voordat het document/de pagina geladen wordt.
        let bitmap_w = (region_w_pt * scale).ceil() as i32;
        let bitmap_h = (region_h_pt * scale).ceil() as i32;
        if bitmap_w <= 0 || bitmap_h <= 0 {
            return Err(anyhow!("render_region: invalid bitmap {}x{}", bitmap_w, bitmap_h));
        }
        shm::ensure_bitmap_fits(bitmap_w, bitmap_h)?;
        let idx = self.get_or_load(path, visibility)?;
        {
            let _page = self.get_or_load_page(idx, page_index)?;
        }
        let annot = annot_appearance.map(|show| annot_signature(page_index, show.names, show.indices));
        let annot_ready = annot.is_some() && self.cache[idx].annot_applied == annot;
        let result = {
            let page = self.get_or_load_page(idx, page_index)?;

            // De matrix van FPDF_RenderPageBitmapWithMatrix werkt in WEERGAVE-ruimte
            // (ná de intrinsieke /Rotate van de pagina), y-omlaag vanaf linksboven —
            // exact de ruimte waarin de viewer regio's aanlevert. Empirisch
            // vastgesteld met hoek-probes op /Rotate=0- én /Rotate=90-pagina's
            // (titelblok/logo-ankers): een plain schaal+translatie-matrix levert
            // voor élke paginarotatie de juiste tegel. Geen rotatie-mapping nodig.
            //
            // render_form_data(true) hierna zet die matrix uit: PDFium valt dan
            // terug op FPDF_RenderPageBitmap en past de hele pagina in deze
            // tegel. Elke tegel wordt een verkleinde kopie van het blad, en de
            // markeringen (paginaruimte) vallen er niet meer op. Formuliervelden
            // blijven op de volledige-pagina-render.
            let config = PdfRenderConfig::new()
                .set_fixed_size(bitmap_w, bitmap_h)
                .transform(scale, 0.0, 0.0, scale, -region_x_pt * scale, -region_y_pt * scale)
                .map_err(|e2| anyhow!("invalid transform: {}", e2))?
                .render_annotations(annot_appearance.is_some())
                .use_lcd_text_rendering(true)
                .set_format(PdfBitmapFormat::BGRA);

            if let Some(show) = annot_appearance {
                if !annot_ready {
                    apply_annotation_appearance(page, show.names, show.indices)?;
                }
            }
            let bitmap = page.render_with_config(&config)
                .map_err(|e| anyhow!("PDFium region render: {}", e))?;

            RenderResult {
                width: bitmap.width() as u32,
                height: bitmap.height() as u32,
                rgba: bitmap.as_rgba_bytes(),
            }
        };
        if annot.is_some() && !annot_ready {
            self.cache[idx].annot_applied = annot;
        }
        self.release_other_cheap_pages(idx);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn renders_a4_at_scale_1() {
        let _r = Renderer::new();
    }

    #[test]
    fn annotation_choice_signature_ignores_order() {
        let a = annot_signature(3, &["b".into(), "a".into()], &[2, 1]);
        let b = annot_signature(3, &["a".into(), "b".into(), "a".into()], &[1, 2]);
        let c = annot_signature(3, &["a".into()], &[1, 2]);
        let d = annot_signature(4, &["a".into(), "b".into()], &[1, 2]);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_ne!(a, d);
    }
}

/// Welke annotaties met hun eigen uiterlijk meegerasterd worden: op /NM of
/// op positie in de /Annots-rij van de pagina (markeringen zonder unieke
/// /NM). Afwezig = geen annotaties.
#[derive(Clone, Copy)]
pub struct AnnotShow<'a> {
    pub names: &'a [String],
    pub indices: &'a [u32],
}

impl<'a> AnnotShow<'a> {
    pub fn from_request(names: Option<&'a [String]>, indices: Option<&'a [u32]>) -> Option<Self> {
        if names.is_none() && indices.is_none() {
            return None;
        }
        Some(Self { names: names.unwrap_or(&[]), indices: indices.unwrap_or(&[]) })
    }
}

/// Laat alleen de annotaties met een /NM uit `names`, of op een positie uit
/// `indices` in de /Annots-rij (FPDFPage_GetAnnot telt die rij letterlijk),
/// met hun eigen uiterlijk (/AP) meerasteren; alle andere niet-widget-
/// annotaties krijgen de Hidden-vlag. De app tekent die zelf (bewerkt, eigen
/// markeringen, links). Widgets (formuliervelden) blijven zoals ze waren: die
/// tekent PDFium via de formulierlaag. Dezelfde keuze op dezelfde open pagina
/// wordt niet opnieuw gelopen: een tegelreeks zou anders elk merk opnieuw
/// aanraken. Een andere keuze, of een nieuwe pagina-handle, zet de vlaggen
/// opnieuw. Zonder annotaties (`render_annotations(false)`) tellen ze niet.
/// Een ongeldige plek in de rij wordt overgeslagen, de rest telt gewoon door.

/// Zelfde keuze in een andere volgorde is dezelfde pass.
fn annot_signature(page_index: u32, names: &[String], indices: &[u32]) -> (u32, u64) {
    let mut names: Vec<&str> = names.iter().map(String::as_str).collect();
    names.sort_unstable();
    names.dedup();
    let mut indices = indices.to_vec();
    indices.sort_unstable();
    indices.dedup();
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
    };
    feed(&names.len().to_le_bytes());
    for name in names {
        feed(name.as_bytes());
    }
    feed(&indices.len().to_le_bytes());
    for index in indices {
        feed(&index.to_le_bytes());
    }
    (page_index, hash)
}
pub fn apply_annotation_appearance(page: &PdfPage, names: &[String], indices: &[u32]) -> Result<()> {
    let names: std::collections::HashSet<&str> = names.iter().map(String::as_str).collect();
    let indices: std::collections::HashSet<u32> = indices.iter().copied().collect();
    let annotations = page.annotations();
    for index in annotations.as_range() {
        let Ok(annotation) = annotations.get(index) else { continue };
        if annotation.annotation_type() == PdfPageAnnotationType::Widget {
            continue;
        }
        let keep = indices.contains(&(index as u32))
            || annotation.name().is_some_and(|nm| names.contains(nm.as_str()));
        if annotation.is_hidden() != !keep {
            let mut annotation = annotation;
            annotation
                .set_is_hidden(!keep)
                .map_err(|e| anyhow!("annotation flag: {}", e))?;
        }
    }
    Ok(())
}
