// Passieve weergave-engine-indicator voor de statusbalk: de render-paden
// melden per (bestand, pagina) welke engine daadwerkelijk pixels leverde.
// De statusbalk toont de waarde van het ACTIEVE document — een melding van
// een achtergrond-tab (prewarm, sessie-herstel) kan de chip dus nooit meer
// vervuilen. Geen keuze-UI; PDFium blijft de vaste basis-engine.
import { createSignal } from 'solid-js';

const _map = new Map(); // `${filePath}|${pageNum}` -> 'pdfium' | 'scene' | 'vector'
const [tick, setTick] = createSignal(0);

/** Gemeld door de render-paden zodra ze daadwerkelijk pixels leveren. */
export function reportActiveEngine(engine, filePath, pageNum) {
  if (!filePath) return;
  const key = `${filePath}|${pageNum || 1}`;
  if (_map.get(key) !== engine) {
    _map.set(key, engine);
    setTick((t) => t + 1);
  }
}

/** Reactief: engine voor een specifiek (bestand, pagina) — '' als onbekend. */
export function engineFor(filePath, pageNum) {
  tick();
  if (!filePath) return '';
  return _map.get(`${filePath}|${pageNum || 1}`) || '';
}
