// Test voor de catalogus-gedreven staalprofiel-templates (steel-catalog.js).
//
// Controleert dat gedownloade steel-sections-catalogi zich IDENTIEK gedragen
// aan de ingebouwde NL staalprofielen: doorsnede op vaste echte b×h,
// boven-/zijaanzicht als line-form met vergrendelde hoogte en vrije lengte,
// maat-keuze via params, niet grafisch verschaalbaar (fixedSize).
//
// Draait ZONDER netwerk tegen een lokale checkout van de content-repo:
//   node scripts/test-steel-catalog.mjs [pad-naar-library-checkout]

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const libDir = process.argv[2] || join(appRoot, '..', '..', '..', '..', 'open-pdf-studio-library');

if (!existsSync(join(libDir, 'index.json'))) {
  console.error(`Bibliotheek-checkout niet gevonden op: ${libDir}`);
  console.error('Geef het pad mee: node scripts/test-steel-catalog.mjs <pad>');
  process.exit(2);
}

// ESM-bronnen via temp-.mjs met behouden mappenstructuur (package is CJS).
const tmp = mkdtempSync(join(tmpdir(), 'opds-steelcat-'));
function stageMjs(relPath) {
  const src = readFileSync(join(appRoot, relPath), 'utf8')
    .replace(/(from\s*['"])(\.{1,2}\/[^'"]+)\.js(['"])/g, '$1$2.mjs$3');
  const target = join(tmp, relPath).replace(/\.js$/, '.mjs');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, src);
  return target;
}
stageMjs('js/symbols/templates/staalprofiel.js');
const steel = await import(pathToFileURL(stageMjs('js/symbols/steel-catalog.js')).href);

let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  FOUT: ${msg}`);
  }
}
function loadCatalog(collectionId) {
  const raw = JSON.parse(readFileSync(join(libDir, 'collections', collectionId, 'parametric.json'), 'utf8'));
  return steel.parseSteelSectionCatalog(raw);
}
function templateFor(collectionId, catalog, familyId) {
  const templates = steel.steelCatalogTemplates(collectionId, catalog);
  return templates.find(t => t.id === steel.steelTemplateId(collectionId, familyId));
}
const BBOX = { x: 10, y: 20, width: 200, height: 120 };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// --- 1. Bekende maten stromen door naar realSizeMm (doorsnede = vaste b×h) ---
console.log('1. bekende maten: doorsnede vast, echte h/b');
const cases = [
  ['aisc-steel-shapes', 'w-shapes', 'W12x26', 310, 165],
  ['uk-steel-sections', 'ub', 'UB 305x165x40', 303.4, 165],
  ['jis-steel-shapes', 'h-wide', 'H 300x300x10x15', 300, 300],
  ['is-steel-shapes', 'ismb', 'ISMB 300', 300, 140],
];
for (const [cid, famId, maat, h, b] of cases) {
  const catalog = loadCatalog(cid);
  assert(catalog, `${cid}: catalogus parsebaar`);
  const tpl = templateFor(cid, catalog, famId);
  assert(tpl, `${cid}/${famId}: template bestaat`);
  if (!tpl) continue;
  assert(tpl.fixedSize === true, `${cid}/${famId}: fixedSize (niet grafisch verschaalbaar)`);
  const maatParam = tpl.params.find(p => p.key === 'maat');
  assert(maatParam && maatParam.options.includes(maat), `${cid}/${famId}: maat '${maat}' in opties`);
  const az = tpl.params.find(p => p.key === 'aanzicht');
  assert(az && az.options.map(o => o.value).join(',') === 'doorsnede,boven,zij',
    `${cid}/${famId}: aanzicht-opties doorsnede/boven/zij`);
  const mm = tpl.realSizeMm({ maat });
  assert(mm && near(mm.width, b) && near(mm.height, h),
    `${cid}/${famId} ${maat}: doorsnede ${b}×${h} mm, kreeg ${mm && mm.width}×${mm && mm.height}`);
  assert(tpl.freeAxis({ maat }) === null, `${cid}/${famId}: doorsnede geen vrije as`);
}

// --- 2. Boven-/zijaanzicht: hoogte vergrendeld, lengte vrij (as x) ---
console.log('2. line-form aanzichten: hoogte vergrendeld, lengte vrij');
{
  const catalog = loadCatalog('aisc-steel-shapes');
  const tpl = templateFor('aisc-steel-shapes', catalog, 'w-shapes');
  const boven = tpl.realSizeMm({ maat: 'W12x26', aanzicht: 'boven' });
  assert(boven.width === null && near(boven.height, 165), `boven: width vrij, height = b (165), kreeg ${boven.width}×${boven.height}`);
  const zij = tpl.realSizeMm({ maat: 'W12x26', aanzicht: 'zij' });
  assert(zij.width === null && near(zij.height, 310), `zij: width vrij, height = h (310), kreeg ${zij.width}×${zij.height}`);
  assert(tpl.freeAxis({ aanzicht: 'boven' }) === 'x', 'boven: vrije as x');
  assert(tpl.freeAxis({ aanzicht: 'zij' }) === 'x', 'zij: vrije as x');
  // schaal-param werkt door (CAD-blokschaal) net als bij NL
  const s2 = tpl.realSizeMm({ maat: 'W12x26', schaal: 2 });
  assert(near(s2.width, 330) && near(s2.height, 620), 'schaal ×2 werkt door');
}

// --- 3. Rendercommando's per vorm ---
console.log('3. render: doorsnede gevuld, aanzichten met binnenlijnen');
const shapeChecks = [
  ['en-steel-profiles', 'hea', 1],    // i: 1 loop
  ['en-steel-profiles', 'upn', 1],    // u: 1 loop
  ['en-steel-profiles', 'hollow', 2], // box: buiten+binnen (evenodd)
  ['en-steel-profiles', 'chs', 2],    // pipe: 2 cirkels
  ['en-steel-profiles', 'angle', 1],  // angle: 1 loop
  ['en-steel-profiles', 'tee', 1],    // tee: 1 loop
];
{
  const catalog = loadCatalog('en-steel-profiles');
  for (const [cid, famId, loops] of shapeChecks) {
    const tpl = templateFor(cid, catalog, famId);
    assert(tpl, `${famId}: template bestaat`);
    if (!tpl) continue;
    const cmds = tpl.render({}, BBOX);
    const rings = cmds.find(c => c.kind === 'rings');
    assert(rings && rings.fill === true && rings.loops.length === loops,
      `${famId}: doorsnede rings/fill met ${loops} loop(s)`);
    // hartlijnen standaard aan
    assert(cmds.filter(c => c.kind === 'line' && c.dash).length >= 2, `${famId}: hartlijnen aanwezig`);
    // aanzichten: outline-polyline + minstens één binnenlijn, geen fill
    for (const az of ['boven', 'zij']) {
      const vc = tpl.render({ aanzicht: az, hartlijn: false }, BBOX);
      const outline = vc.find(c => c.kind === 'polyline' && c.close);
      assert(outline, `${famId}/${az}: outline-polyline`);
      assert(vc.some(c => c.kind === 'line'), `${famId}/${az}: binnenlijn(en)`);
      assert(!vc.some(c => c.kind === 'rings'), `${famId}/${az}: geen gevulde doorsnede`);
    }
    // toonLabel voegt tekstcommando toe
    const withLabel = tpl.render({ toonLabel: true }, BBOX);
    assert(withLabel.some(c => c.kind === 'text'), `${famId}: label-commando bij toonLabel`);
  }
  // doorsnede-geometrie past in de bbox en respecteert de verhouding b:h
  const heaTpl = templateFor('en-steel-profiles', catalog, 'hea');
  const cmds = heaTpl.render({ maat: 'HEA 200', hartlijn: false }, BBOX);
  const pts = cmds[0].loops[0];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  // HEA 200: b=200, h=190 → in bbox 200×120 wordt hoogte maatgevend
  assert(Math.abs(h - 120) < 0.5, `HEA 200 vult bbox-hoogte (${h.toFixed(1)})`);
  assert(Math.abs(w / h - 200 / 190) < 0.02, `HEA 200 verhouding b/h klopt (${(w / h).toFixed(3)})`);
}

// --- 4. Snap-punten en NL-pariteit van het parameterschema ---
console.log('4. snap-punten + parameterschema identiek aan NL');
{
  const catalog = loadCatalog('gost-steel-shapes');
  const tpl = templateFor('gost-steel-shapes', catalog, 'i-beams');
  const snaps = tpl.snapPoints({}, BBOX);
  assert(snaps.some(s => s.kind === 'center') && snaps.filter(s => s.kind === 'endpoint').length === 4
    && snaps.filter(s => s.kind === 'midpoint').length === 4, 'snap-punten: center+4 hoeken+4 middens');
  const keys = tpl.params.map(p => p.key).join(',');
  assert(keys === 'maat,aanzicht,schaal,hartlijn,toonLabel', `parameterschema: ${keys}`);
  const defaults = Object.fromEntries(tpl.params.map(p => [p.key, p.default]));
  assert(defaults.aanzicht === 'doorsnede' && defaults.schaal === 1 && defaults.hartlijn === true
    && defaults.toonLabel === false, 'parameter-defaults gelijk aan NL');
}

// --- 5. Onbekende maat valt terug op default; previews geldig ---
console.log('5. fallback + previews');
{
  const catalog = loadCatalog('gb-steel-shapes');
  const tpl = templateFor('gb-steel-shapes', catalog, 'i-beams');
  const mm = tpl.realSizeMm({ maat: 'BESTAAT-NIET' });
  const def = tpl.realSizeMm({ maat: tpl.params[0].default });
  assert(mm && near(mm.width, def.width) && near(mm.height, def.height), 'onbekende maat → default-maat');
  for (const fam of catalog.families) {
    const svg = steel.steelFamilyPreviewSvg(fam);
    assert(svg.startsWith('<svg viewBox="0 0 64 64"') && svg.includes('<path'), `${fam.id}: preview-svg vorm`);
    assert(!/on[a-z]+=|<script|href/.test(svg), `${fam.id}: preview-svg schoon`);
  }
}

console.log(`\n${checks} checks, ${failures} fouten`);
process.exit(failures ? 1 : 0);
