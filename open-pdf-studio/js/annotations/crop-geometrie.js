// Geometrie van het bijsnijden van een afbeelding.
//
// Een afbeeldings-annotatie bewaart het bijsnijden als fracties per zijde
// (cropLeft/Top/Right/Bottom, 0-1 van de BRON) plus een rechthoek op de
// pagina. Bijsnijden knipt een stuk van de afbeelding af: de rechthoek wordt
// kleiner, de schaal van de pixels blijft gelijk. De weggesneden rand blijft
// in de bron bestaan, zodat een latere bijsnijding hem weer kan tonen.
//
// Het "volledige vak" is waar de complete bron op de pagina zou staan; de
// rechthoek van de annotatie is daar het venster op. Alle functies werken in
// het lokale, ongedraaide frame van de annotatie; alleen `rectNaBijsnijden`
// weet van rotatie, omdat de rechthoek om zijn eigen middelpunt draait en dat
// middelpunt verschuift bij bijsnijden.

export const MIN_ZICHTBAAR = 0.1; // per as blijft minstens 10% van de bron over

export function klemFractie(v) {
  return Math.max(0, Math.min(0.9, Number(v) || 0));
}

export function fracties(ann) {
  return {
    l: klemFractie(ann.cropLeft), t: klemFractie(ann.cropTop),
    r: klemFractie(ann.cropRight), b: klemFractie(ann.cropBottom),
  };
}

/** Het vak waar de volledige bron op de pagina staat, uit rechthoek + fracties. */
export function volledigVak(rect, f) {
  const zichtW = Math.max(MIN_ZICHTBAAR, 1 - f.l - f.r);
  const zichtH = Math.max(MIN_ZICHTBAAR, 1 - f.t - f.b);
  const w = rect.width / zichtW;
  const h = rect.height / zichtH;
  return { x: rect.x - w * f.l, y: rect.y - h * f.t, w, h };
}

/** Het venster (zichtbare deel) op een volledig vak bij gegeven fracties. */
export function vensterOpVak(vak, f) {
  return {
    x: vak.x + vak.w * f.l,
    y: vak.y + vak.h * f.t,
    w: vak.w * (1 - f.l - f.r),
    h: vak.h * (1 - f.t - f.b),
  };
}

/**
 * Nieuwe fracties wanneer één greep (l/r/t/b of een hoek) naar `p` gesleept
 * wordt, met `p` in het lokale frame van het volledige vak. Tegenoverliggende
 * zijden blijven staan; per as blijft MIN_ZICHTBAAR over.
 */
export function fractiesNaSleep(vak, f, greep, p) {
  const uit = { ...f };
  const fx = (p.x - vak.x) / vak.w;
  const fy = (p.y - vak.y) / vak.h;
  if (greep.includes('l')) uit.l = Math.max(0, Math.min(fx, 1 - f.r - MIN_ZICHTBAAR));
  if (greep.includes('r')) uit.r = Math.max(0, Math.min(1 - fx, 1 - f.l - MIN_ZICHTBAAR));
  if (greep.includes('t')) uit.t = Math.max(0, Math.min(fy, 1 - f.b - MIN_ZICHTBAAR));
  if (greep.includes('b')) uit.b = Math.max(0, Math.min(1 - fy, 1 - f.t - MIN_ZICHTBAAR));
  return uit;
}

/**
 * De rechthoek op de pagina nadat het venster (lokaal frame van de oude
 * rechthoek) is gewijzigd. De pixels blijven op hun plek: het nieuwe
 * middelpunt is het oude middelpunt plus de (meegedraaide) verschuiving van
 * het venster-middelpunt.
 */
export function rectNaBijsnijden(oudRect, venster, rotatieGraden = 0) {
  const c0x = oudRect.x + oudRect.width / 2;
  const c0y = oudRect.y + oudRect.height / 2;
  const dx = venster.x + venster.w / 2 - c0x;
  const dy = venster.y + venster.h / 2 - c0y;
  const a = (rotatieGraden || 0) * Math.PI / 180;
  const c1x = c0x + dx * Math.cos(a) - dy * Math.sin(a);
  const c1y = c0y + dx * Math.sin(a) + dy * Math.cos(a);
  return { x: c1x - venster.w / 2, y: c1y - venster.h / 2, width: venster.w, height: venster.h };
}
