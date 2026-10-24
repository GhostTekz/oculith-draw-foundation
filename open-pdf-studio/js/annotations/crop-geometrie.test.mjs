import assert from 'node:assert/strict';
import test from 'node:test';

import {
  volledigVak, vensterOpVak, fractiesNaSleep, rectNaBijsnijden, MIN_ZICHTBAAR,
} from './crop-geometrie.js';

const bijna = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const GEEN = { l: 0, t: 0, r: 0, b: 0 };

test('zonder bijsnijden is het volledige vak de rechthoek zelf', () => {
  const vak = volledigVak({ x: 10, y: 20, width: 200, height: 100 }, GEEN);
  assert.deepEqual(vak, { x: 10, y: 20, w: 200, h: 100 });
});

test('20% onderaan afsnijden: rechthoek wordt 20% lager, pixels blijven staan', () => {
  // 100 pt hoog, 20 pt van de onderkant af → 80 pt hoog op dezelfde plek.
  const oud = { x: 10, y: 20, width: 200, height: 100 };
  const vak = volledigVak(oud, GEEN);
  const f = fractiesNaSleep(vak, GEEN, 'b', { x: 0, y: 100 }); // greep onder naar y=100 (=20 boven onderrand)
  bijna(f.b, 0.2, 'fractie onder');
  const nieuw = rectNaBijsnijden(oud, vensterOpVak(vak, f), 0);
  bijna(nieuw.x, 10, 'x'); bijna(nieuw.y, 20, 'y');
  bijna(nieuw.width, 200, 'breedte ongewijzigd'); bijna(nieuw.height, 80, 'hoogte 80');
});

test('volledig vak is terug te vinden uit een bijgesneden rechthoek', () => {
  // Rechthoek 80 hoog met 20% onder weggesneden hoort bij een bron van 100.
  const vak = volledigVak({ x: 10, y: 20, width: 200, height: 80 }, { l: 0, t: 0, r: 0, b: 0.2 });
  bijna(vak.h, 100, 'bronhoogte'); bijna(vak.y, 20, 'bron-y');
  // en het venster daarop is weer de rechthoek zelf
  const v = vensterOpVak(vak, { l: 0, t: 0, r: 0, b: 0.2 });
  bijna(v.h, 80, 'venster-hoogte'); bijna(v.y, 20, 'venster-y');
});

test('terugslepen maakt de weggesneden rand weer zichtbaar', () => {
  const f0 = { l: 0, t: 0, r: 0, b: 0.2 };
  const rect = { x: 10, y: 20, width: 200, height: 80 };
  const vak = volledigVak(rect, f0);
  const f = fractiesNaSleep(vak, f0, 'b', { x: 0, y: 120 }); // greep terug naar de bronrand
  bijna(f.b, 0, 'fractie onder terug naar 0');
  const nieuw = rectNaBijsnijden(rect, vensterOpVak(vak, f), 0);
  bijna(nieuw.height, 100, 'volle hoogte terug');
});

test('per as blijft minstens de minimale zichtbaarheid over', () => {
  const vak = { x: 0, y: 0, w: 100, h: 100 };
  const f = fractiesNaSleep(vak, { l: 0.5, t: 0, r: 0, b: 0 }, 'r', { x: 0, y: 0 });
  bijna(f.r, 1 - 0.5 - MIN_ZICHTBAAR, 'rechts geklemd');
});

test('gedraaide afbeelding: het middelpunt verschuift mee met de rotatie', () => {
  // 90° gedraaid; venster schuift lokaal 10 naar rechts → op de pagina 10 omlaag.
  const oud = { x: 0, y: 0, width: 100, height: 100 };
  const venster = { x: 20, y: 0, w: 80, h: 100 }; // links 20 af
  const nieuw = rectNaBijsnijden(oud, venster, 90);
  const cx = nieuw.x + nieuw.width / 2, cy = nieuw.y + nieuw.height / 2;
  bijna(cx, 50, 'middelpunt-x blijft'); bijna(cy, 60, 'middelpunt-y +10');
  bijna(nieuw.width, 80, 'breedte'); bijna(nieuw.height, 100, 'hoogte');
});
