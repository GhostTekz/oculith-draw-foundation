# Built on open source

Oculith Draw Foundation stands on the work of many open-source projects. Thank you to everyone who builds and maintains them.

## Open PDF Studio

**[Open PDF Studio](https://github.com/OpenAEC-Foundation/open-pdf-studio)** by the **[OpenAEC Foundation](https://github.com/OpenAEC-Foundation)** is the upstream PDF editor this application grew from. Oculith Draw began as a fork of its source, and the application directory, `open-pdf-studio/`, still carries its name. Its history and attribution are kept in the repository and in the About window.

- Used for: the editor this app is built on.
- Licence: LGPL-3.0.

Oculith Draw Foundation is licensed under the LGPL-3.0 as well.

## Projects

| Project | Used for | Licence |
|---|---|---|
| [Tauri](https://tauri.app) | Desktop shell, windows, file system, dialogs | Apache-2.0 / MIT |
| [SolidJS](https://www.solidjs.com) | Reactive interface | MIT |
| [PDFium](https://pdfium.googlesource.com/pdfium/) | Page rendering in the worker process | BSD-3-Clause |
| [pdfium-render](https://github.com/ajrcarey/pdfium-render) | Rust bindings to PDFium | MIT / Apache-2.0 |
| [@embedpdf/pdfium](https://github.com/embedpdf/embed-pdf-viewer) | PDFium as WebAssembly for the browser preview | MIT |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Reading text, structure and annotations | Apache-2.0 |
| [pdf-lib](https://pdf-lib.js.org) | Writing saved PDFs | MIT |
| [fontkit](https://github.com/Hopding/fontkit) | Embedding fonts in saved PDFs | MIT |
| [lopdf](https://github.com/J-F-Liu/lopdf) | PDF object access in Rust | MIT |
| [tiny-skia](https://github.com/RazrFalcon/tiny-skia) | 2D rasterising in the Rust renderer | BSD-3-Clause |
| [libjpeg-turbo](https://libjpeg-turbo.org), via [turbojpeg](https://github.com/honzasp/rust-turbojpeg) | JPEG decoding in the Rust renderer | BSD-3-Clause / IJG / zlib |
| [ttf-parser](https://github.com/RazrFalcon/ttf-parser) | Font parsing in the Rust renderer | MIT / Apache-2.0 |
| [hayro-font](https://github.com/LaurenzV/hayro) | Font parsing in the Rust renderer | MIT / Apache-2.0 |
| [GEOS](https://libgeos.org) | Polygon unions, holes, offsets and crossings (optional) | LGPL-2.1 |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) | OCR of scanned sheets | Apache-2.0 |
| [Leptonica](http://www.leptonica.org) | Image handling for Tesseract | BSD-2-Clause |
| [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | Trained OCR data for English and Traditional Chinese | Apache-2.0 |
| [acadrust](https://crates.io/crates/acadrust) | DWG and DXF import and export | MPL-2.0 |
| [i18next](https://www.i18next.com) | Translations | MIT |
| [Lucide](https://lucide.dev) | Icons (vendored) | ISC |
| [RBush](https://github.com/mourner/rbush) | Spatial index for snapping and hit testing (vendored) | MIT |
| [quickselect](https://github.com/mourner/quickselect) | Selection algorithm used by RBush (vendored) | ISC |
| [image](https://github.com/image-rs/image) | Image decoding and encoding in Rust | MIT / Apache-2.0 |
| [serde](https://serde.rs) | Data serialisation in Rust | MIT / Apache-2.0 |
| [reqwest](https://github.com/seanmonstar/reqwest) | HTTPS downloads, such as opening a PDF from a URL | MIT / Apache-2.0 |
| [RustCrypto](https://github.com/RustCrypto) | Cryptography for digital signature checks | MIT / Apache-2.0 |
| [Geist](https://vercel.com/font) | Interface typeface | SIL OFL 1.1 |
| [Instrument Serif](https://github.com/Instrument/instrument-serif) | Display typeface | SIL OFL 1.1 |
| [Noto Sans CJK](https://github.com/notofonts/noto-cjk) | Font for the OCR text layer | SIL OFL 1.1 |

The desktop app on Linux also uses the system's GTK 3 and WebKit through Tauri.

## Full notices

- The full third-party notices ship with the app under `notices/`. Their source is `open-pdf-studio/src-tauri/package-notices/`, which holds the Rust and npm notice inventories, the GEOS notice with the LGPL-2.1 text, and the licences of Lucide, RBush, quickselect, Noto Sans CJK and tessdata_fast.
- The font licences are in `open-pdf-studio/public/fonts/` (`OFL-Geist.txt`, `OFL-InstrumentSerif.txt`).
- `SBOM.cdx.json`, a CycloneDX bill of materials, lists every locked Cargo and npm dependency, including platform alternatives.

The About window names the main components and their licences.

Oculith Draw Foundation is made by [Oculith](https://oculith.io).
