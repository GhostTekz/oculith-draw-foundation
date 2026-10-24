import { createSignal, For, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getAppVersion, openExternal } from '../../../core/platform.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { edition } from '../../../editions/active.js';

// Notices for works this program uses. The desktop package ships the full
// texts under notices/. The sentences required by those licenses stay in English.
const CREDITS = [
  {
    name: 'GEOS 3.14.1',
    text: 'Geometry Engine Open Source. Copyright (C) 2005 Refractions Research Inc. and the GEOS contributors. LGPL-2.1-only. A desktop build that includes GEOS calls the shared libraries libgeos_c and libgeos for polygon area, offset, and polygonize. Those libraries can be replaced with compatible ones built from the same source. The license text is installed as notices/third-party/LGPL-2.1.txt.',
    href: 'https://github.com/libgeos/geos/releases/tag/3.14.1',
    link: 'GEOS 3.14.1 source',
  },
  {
    name: 'PDFium',
    text: 'Copyright 2014 The PDFium Authors. BSD-3-Clause. Draws each page. The binary notice is installed under notices/pdfium/.',
    href: 'https://pdfium.googlesource.com/pdfium/',
    link: 'PDFium source',
  },
  {
    name: 'FreeType',
    text: 'Inside PDFium. Copyright 1996-2002, 2006 David Turner, Robert Wilhelm, and Werner Lemberg. This software uses the FreeType font engine. Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.',
    href: 'https://freetype.org',
    link: 'FreeType Project',
  },
  {
    name: 'libjpeg-turbo',
    text: 'Inside PDFium, and the desktop build also uses the system TurboJPEG library. This software is based in part on the work of the Independent JPEG Group. libjpeg-turbo is covered by the Independent JPEG Group License and the Modified BSD License.',
    href: 'https://libjpeg-turbo.org',
    link: 'libjpeg-turbo',
  },
  {
    name: 'PDFium components',
    text: 'libpng, copyright The PNG Reference Library Authors, Cosmin Truta, Glenn Randers-Pehrson, Andreas Dilger, and Guy Eric Schalnat, Group 42, Inc. libtiff, copyright Sam Leffler and Silicon Graphics, Inc. OpenJPEG, copyright Herve Drolon of the FreeImage Team, Centre National d\'Etudes Spatiales (CNES), and CS Systemes d\'Information. Little CMS, copyright Marti Maria Saguer. ICU, copyright Unicode, Inc. Their notices are installed under notices/pdfium/licenses/.',
  },
  {
    name: 'PDF.js',
    text: 'Mozilla Foundation. Apache-2.0. Reads text and document structure. Notices are installed under notices/pdfjs/.',
    href: 'https://github.com/mozilla/pdf.js',
    link: 'PDF.js source',
  },
  {
    name: 'Tesseract tessdata_fast',
    text: 'Apache-2.0. OCR models. The notice is installed as notices/third-party/tessdata_fast-LICENSE.',
    href: 'https://github.com/tesseract-ocr/tessdata_fast',
    link: 'tessdata_fast',
  },
  {
    name: 'Noto Sans CJK',
    text: 'SIL Open Font License. Used for OCR text. The notice is installed as notices/third-party/noto-cjk-Sans-LICENSE.',
    href: 'https://github.com/notofonts/noto-cjk',
    link: 'Noto CJK',
  },
  {
    name: 'Geist and Instrument Serif',
    text: 'SIL Open Font License. The notices are installed under notices/fonts/.',
  },
  {
    name: 'Lucide',
    text: 'ISC License. Some icons are derived from Feather, which is MIT. The notice is installed as notices/third-party/lucide-LICENSE.',
    href: 'https://lucide.dev',
    link: 'Lucide',
  },
  {
    name: 'GTK 3 and WebKitGTK',
    text: 'On Linux the window is drawn by GTK 3 and WebKitGTK from the operating system. Both are available under the LGPL from the distribution that installed them.',
  },
  {
    name: 'RBush',
    text: 'MIT. Copyright (c) 2024 Volodymyr Agafonkin. Spatial index for snap and hit-testing. Notice: notices/third-party/rbush-LICENSE.',
    href: 'https://github.com/mourner/rbush',
    link: 'RBush',
  },
  {
    name: 'quickselect',
    text: 'ISC. Copyright (c) 2024 Vladimir Agafonkin. Used by RBush. Notice: notices/third-party/quickselect-LICENSE.',
  },
];

export default function AboutDialog() {
  const { t } = useTranslation('appMenu');
  const [version, setVersion] = createSignal(t('aboutPanel.version'));

  onMount(async () => {
    const v = await getAppVersion();
    if (v) setVersion(`${t('aboutPanel.version')} ${v}`);
  });

  const close = () => closeDialog('about');

  return (
    <Dialog
      title={t('aboutPanel.title')}
      dialogClass="about-dialog"
      bodyClass="about-body"
      onClose={close}
    >
      <div class="bs-about-panel">
        <div class="bs-about-app">
          <div class="bs-about-logo">
            <img src={edition.logoPath} alt={edition.productName} />
          </div>
          <div class="bs-about-app-info">
            <h1 class="bs-about-app-name">{edition.productName}</h1>
            <p class="bs-about-version">{version()}</p>
            <p class="bs-about-tagline">{t('aboutPanel.tagline')}</p>
          </div>
        </div>

        <p class="bs-about-description">
          {edition.about.description || t('aboutPanel.description')}
        </p>

        <div class="bs-about-company">
          <h3 class="bs-about-company-name">{edition.about.companyName || t('aboutPanel.companyName')}</h3>
          <p class="bs-about-company-desc">
            {edition.about.companyDescription || t('aboutPanel.companyDescription')}
          </p>
        </div>

        <div class="bs-about-links">
          <a href="#" class="bs-about-link" onClick={(e) => { e.preventDefault(); openExternal('https://github.com/OpenAEC-Foundation/open-pdf-studio'); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Open PDF Studio source
          </a>
        </div>

        <p class="bs-about-source-note"><strong>{edition.about.sourceLabel}.</strong> {edition.about.sourceNote}</p>

        <div class="bs-about-footer">
          <p class="bs-about-copyright">{edition.about.copyright || t('aboutPanel.copyright')}</p>
          <p class="bs-about-license">{edition.about.license}</p>
        </div>

        <div class="bs-about-credits">
          <h3>Third-party notices</h3>
          <p>{edition.about.license} Full license texts for the works below ship with the desktop application under notices/.</p>
          <ul>
            <For each={CREDITS}>
              {(item) => (
                <li>
                  <strong>{item.name}.</strong> {item.text}
                  {item.href && (
                    <>
                      {' '}
                      <a href={item.href} onClick={(e) => { e.preventDefault(); openExternal(item.href); }}>{item.link}</a>
                    </>
                  )}
                </li>
              )}
            </For>
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
