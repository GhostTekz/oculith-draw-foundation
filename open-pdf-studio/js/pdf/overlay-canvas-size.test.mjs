import assert from 'node:assert/strict';
import test from 'node:test';

import {
  overlayVolgtViewport,
  bepaalOverlayMaat,
  pasOverlayMaatToe,
} from './overlay-canvas-size.js';

// Venster uit de melding: container 855×697 CSS-px op dpr 1,5. #pdf-canvas
// krijgt dan backing round(855·1,5)×round(697·1,5) = 1283×1046; de viewport
// in CSS-px is backing / dpr (fractioneel).
const DPR = 1.5;
const VP_W = 1283 / DPR; // 855,333…
const VP_H = 1046 / DPR; // 697,333…

// NKE2D2_opm_aw.pdf: p1 staand, p2–p4 liggend.
const P1 = { w: 1191, h: 1684 };
const P2 = { w: 5156, h: 2384 };
const P3 = { w: 5156, h: 2384 };

function fitZoom(p) {
  return Math.min(VP_W / p.w, VP_H / p.h);
}

// Canvas-nabootsing: width/height worden afgerond zoals een <canvas> doet
// (unsigned long) en elke toewijzing telt als wis van de backing store.
function nepCanvas(width = 300, height = 150, cssWidth = '', cssHeight = '') {
  let w = width;
  let h = height;
  return {
    wissen: 0,
    get width() { return w; },
    set width(v) { w = Math.trunc(v); this.wissen++; },
    get height() { return h; },
    set height(v) { h = Math.trunc(v); this.wissen++; },
    style: { width: cssWidth, height: cssHeight },
  };
}

const VIEWPORT_MAAT = { bron: 'viewport', width: 855, height: 697, cssWidth: '', cssHeight: '' };
// Op dpr 1,5: backing = die van #pdf-canvas (1283×1046), CSS = containermaat.
const VIEWPORT_MAAT_DPR = { bron: 'viewport', width: 1283, height: 1046, cssWidth: '855px', cssHeight: '697px', backingScale: DPR };

test('overlay volgt de viewport alleen met actieve viewport én bestandspad', () => {
  assert.equal(overlayVolgtViewport({ viewportActief: true, heeftBestandspad: true }), true);
  assert.equal(overlayVolgtViewport({ viewportActief: true, heeftBestandspad: false }), false);
  assert.equal(overlayVolgtViewport({ viewportActief: false, heeftBestandspad: true }), false);
  assert.equal(overlayVolgtViewport({ viewportActief: false, heeftBestandspad: false }), false);
});

test('viewport bezit de pagina: overlay = viewportmaat, ongeacht de paginamaat', () => {
  for (const p of [P1, P2, P3]) {
    for (const scale of [fitZoom(P1), fitZoom(P2), 1, 3.5]) {
      const maat = bepaalOverlayMaat({
        viewportActief: true,
        heeftBestandspad: true,
        viewportCssW: VP_W,
        viewportCssH: VP_H,
        paginaCssW: p.w * scale,
        paginaCssH: p.h * scale,
        dpr: DPR,
      });
      assert.deepEqual(maat, VIEWPORT_MAAT_DPR);
    }
  }
});

test('oude beslissing reproduceert de gemeten foute overlay (1283×593, CSS 855×395)', () => {
  // renderPage() op p3 met doc.scale = fit-zoom van p2 (gelijk aan die van p3)
  // zette de overlay op de paginamaat. Dit is precies die paginamaat-tak.
  const s = fitZoom(P2);
  const paginaMaat = bepaalOverlayMaat({
    viewportActief: false,
    heeftBestandspad: true,
    paginaCssW: P3.w * s,
    paginaCssH: P3.h * s,
    dpr: DPR,
  });
  assert.deepEqual(paginaMaat, {
    bron: 'pagina', width: 1283, height: 593, cssWidth: '855px', cssHeight: '395px',
  });
});

test('regressie p1 → p2 → p3: overlay staat na elke navigatie op de viewportmaat', () => {
  const ann = nepCanvas();
  const hl = nepCanvas();
  let scale = fitZoom(P1); // document geopend op p1, fit-page
  for (const p of [P1, P2, P3]) {
    // Einde van renderPage(): één beslissing voor beide overlay-canvassen.
    const maat = bepaalOverlayMaat({
      viewportActief: true,
      heeftBestandspad: true,
      viewportCssW: VP_W,
      viewportCssH: VP_H,
      paginaCssW: p.w * scale,
      paginaCssH: p.h * scale,
      dpr: DPR,
    });
    pasOverlayMaatToe(ann, maat);
    pasOverlayMaatToe(hl, maat);
    for (const c of [ann, hl]) {
      assert.equal(c.width, 1283);
      assert.equal(c.height, 1046);
      assert.equal(c.style.width, '855px');
      assert.equal(c.style.height, '697px');
    }
    // Fit-page na de navigatie; op p3 is dit exact de zoom van p2, dus er
    // volgt geen _render()-frame meer. De overlay mag daar niet op leunen.
    scale = fitZoom(p);
  }
  assert.equal(fitZoom(P2), fitZoom(P3));
});

test('een op paginamaat blijven hangende overlay wordt hersteld', () => {
  const ann = nepCanvas(1283, 593, '855px', '395px');
  assert.equal(pasOverlayMaatToe(ann, VIEWPORT_MAAT), true);
  assert.equal(ann.width, 855);
  assert.equal(ann.height, 697);
  assert.equal(ann.style.width, '');
  assert.equal(ann.style.height, '');
});

test('alleen een achtergebleven inline CSS-maat telt ook als afwijking', () => {
  const ann = nepCanvas(855, 697, '855px', '395px');
  assert.equal(pasOverlayMaatToe(ann, VIEWPORT_MAAT), true);
  assert.equal(ann.wissen, 0, 'backing store ongemoeid als alleen CSS afwijkt');
  assert.equal(ann.style.height, '');
});

test('fractionele viewportmaat: herhaald toepassen wist het canvas niet opnieuw', () => {
  const ann = nepCanvas();
  const maat = bepaalOverlayMaat({
    viewportActief: true, heeftBestandspad: true, viewportCssW: VP_W, viewportCssH: VP_H,
  });
  assert.equal(pasOverlayMaatToe(ann, maat), true);
  const na1 = ann.wissen;
  for (let frame = 0; frame < 5; frame++) {
    assert.equal(pasOverlayMaatToe(ann, maat), false);
  }
  assert.equal(ann.wissen, na1);
});

test('geen viewport (leeg document of webversie): paginamaat × dpr zoals voorheen', () => {
  const blanco = bepaalOverlayMaat({
    viewportActief: true, // achtergebleven van een eerder echt PDF
    heeftBestandspad: false,
    viewportCssW: VP_W,
    viewportCssH: VP_H,
    paginaCssW: 595.5,
    paginaCssH: 842.25,
    dpr: 2,
  });
  assert.deepEqual(blanco, {
    bron: 'pagina', width: 1191, height: 1684, cssWidth: '595px', cssHeight: '842px',
  });
  const web = bepaalOverlayMaat({
    viewportActief: false,
    heeftBestandspad: true,
    paginaCssW: 600,
    paginaCssH: 800,
    dpr: DPR,
  });
  assert.equal(web.bron, 'pagina');
  assert.equal(web.width, 900);
  assert.equal(web.height, 1200);
});

test('viewport bezit de overlay maar maat onbekend: nooit terugvallen op paginamaat', () => {
  const maat = bepaalOverlayMaat({
    viewportActief: true,
    heeftBestandspad: true,
    viewportCssW: 0,
    viewportCssH: VP_H,
    paginaCssW: 855.33,
    paginaCssH: 395.48,
    dpr: DPR,
  });
  assert.equal(maat, null);
  const ann = nepCanvas(855, 697);
  assert.equal(pasOverlayMaatToe(ann, maat), false);
  assert.equal(ann.width, 855);
  assert.equal(ann.height, 697);
  assert.equal(pasOverlayMaatToe(null, VIEWPORT_MAAT), false);
});

test('ongeldige dpr valt in paginamodus terug op 1', () => {
  for (const dpr of [0, -1, NaN, undefined]) {
    const maat = bepaalOverlayMaat({
      viewportActief: false, heeftBestandspad: false, paginaCssW: 400.7, paginaCssH: 300.2, dpr,
    });
    assert.deepEqual(maat, { bron: 'pagina', width: 400, height: 300, cssWidth: '400px', cssHeight: '300px' });
  }
});

test('deep zoom: a page-sized overlay is capped at OVERLAY_MAX_AXIS_PX and tells its ratio', async () => {
  const { OVERLAY_MAX_AXIS_PX, pasOverlayMaatToe: toe } = await import('./overlay-canvas-size.js');
  const maat = bepaalOverlayMaat({ viewportActief: false, heeftBestandspad: true, paginaCssW: 8640, paginaCssH: 5760, dpr: 2 });
  assert.equal(maat.width, OVERLAY_MAX_AXIS_PX);
  assert.equal(maat.cssWidth, '8640px');
  const canvas = { width: 0, height: 0, style: {}, dataset: {} };
  toe(canvas, maat);
  assert.ok(Math.abs(Number(canvas.dataset.backingScale) - OVERLAY_MAX_AXIS_PX / 8640) < 1e-9);
  // Viewport-sized overlay: no page ratio.
  toe(canvas, bepaalOverlayMaat({ viewportActief: true, heeftBestandspad: true, viewportCssW: 800, viewportCssH: 600 }));
  assert.equal(canvas.dataset.backingScale, undefined);
});

test('diepe zoom met bekend zichtbaar deel: overlay is een scherpe uitsnede op volle dpr', async () => {
  const { bepaalOverlayMaat, pasOverlayMaatToe, OVERLAY_CLIP_MARGE_PX } = await import('./overlay-canvas-size.js');
  // 3024 x 2160 pt op 800 %: 24192 x 17280 CSS-px, dpr 2.
  const maat = bepaalOverlayMaat({ viewportActief: false, heeftBestandspad: true, paginaCssW: 24192, paginaCssH: 17280, dpr: 2,
    zichtbaar: { minX: 10000, minY: 8000, maxX: 11200, maxY: 8600 } });
  assert.equal(maat.clipX, 10000 - OVERLAY_CLIP_MARGE_PX);
  assert.equal(maat.clipY, 8000 - OVERLAY_CLIP_MARGE_PX);
  const cssW = parseFloat(maat.cssWidth);
  assert.equal(maat.width, cssW * 2, 'volle dpr, niet afgetopt');
  const canvas = { width: 0, height: 0, style: {}, dataset: {} };
  pasOverlayMaatToe(canvas, maat);
  assert.equal(canvas.style.left, `${maat.clipX}px`);
  assert.equal(canvas.dataset.clipX, String(maat.clipX));
  assert.equal(canvas.dataset.paginaCssW, '24192');
  // Terug naar een gewone zoom: positie en uitsnede-gegevens weg.
  pasOverlayMaatToe(canvas, bepaalOverlayMaat({ viewportActief: false, heeftBestandspad: true, paginaCssW: 3024, paginaCssH: 2160, dpr: 1,
    zichtbaar: { minX: 0, minY: 0, maxX: 1000, maxY: 600 } }));
  assert.equal(canvas.style.left, '');
  assert.equal(canvas.dataset.clipX, undefined);
  assert.equal(canvas.style.width, '3024px');
});

test('viewport overlay at device resolution: backing = #pdf-canvas backing for dpr 1, 1.25, 1.5, 2', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const [w, h] of [[855, 697], [1223, 600], [1917, 1003]]) {
      const backingW = Math.round(w * dpr); // #pdf-canvas (pdf-viewport.js _resizeCanvas)
      const backingH = Math.round(h * dpr);
      const maat = bepaalOverlayMaat({
        viewportActief: true, heeftBestandspad: true,
        viewportCssW: backingW / dpr, viewportCssH: backingH / dpr, dpr,
      });
      assert.equal(maat.width, backingW, `width @${dpr}`);
      assert.equal(maat.height, backingH, `height @${dpr}`);
      if (dpr === 1) {
        assert.equal(maat.cssWidth, '');
      } else {
        assert.equal(maat.cssWidth, `${w}px`);
        assert.equal(maat.cssHeight, `${h}px`);
      }
      const canvas = { width: 0, height: 0, style: { width: '', height: '' }, dataset: {} };
      pasOverlayMaatToe(canvas, maat);
      const k = Number(canvas.dataset.backingScale || 1);
      assert.equal(k, dpr, 'tool previews and the markup pass scale by the dpr');
    }
  }
});

test('viewport overlay keeps the #pdf-canvas CSS size when the device box was snapped', () => {
  // 855 CSS px at 125 %: the compositor reported 1068 device px (not 1069).
  const maat = bepaalOverlayMaat({
    viewportActief: true, heeftBestandspad: true,
    viewportCssW: 1068 / 1.25, viewportCssH: 871 / 1.25, dpr: 1.25,
    viewportStijlW: 855, viewportStijlH: 697,
  });
  assert.equal(maat.width, 1068);
  assert.equal(maat.cssWidth, '855px');
  assert.equal(maat.cssHeight, '697px');
});
