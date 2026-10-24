// Acceptance fixture for the Spaces tests (model, round trip, Markups List):
// three rooms and a closet nested in one of them, and ten markups. Page 1 is
// 800×600 app units; the kitchen and living room are floor-plan rooms (as
// app_floorplan or Dynamic Fill's Space output make them), the office and its
// closet are stored spaces.

export const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const room = (id, name, pts, extra = {}) => ({
  id, type: 'measureArea', page: 1, points: pts, opsRuimteNaam: name, measureName: name,
  opsRuimteZaad: { x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 }, ...extra,
});

/** The acceptance fixture: 3 rooms and a closet nested in one of them, 10 markups. */
export function fixture() {
  const annotations = [
    room('kitchen', 'Kitchen', rect(0, 0, 300, 300)),            // floor-plan room
    room('living', 'Living', rect(300, 0, 800, 300)),            // floor-plan room (e.g. Dynamic Fill Space)
    { id: 'm1', type: 'box', page: 1, x: 90, y: 90, width: 20, height: 20 },
    { id: 'm2', type: 'line', page: 1, startX: 350, startY: 50, endX: 450, endY: 50 },
    { id: 'm3', type: 'count', page: 1, x: 350, y: 550, width: 20, height: 20 },
    { id: 'm4', type: 'measureArea', page: 1, points: rect(50, 350, 150, 450) },
    { id: 'm5', type: 'cloud', page: 1, points: rect(600, 100, 700, 200) },
    { id: 'm6', type: 'stamp', page: 1, x: 690, y: 490, width: 40, height: 20 },
    { id: 'm7', type: 'polyline', page: 1, points: [{ x: 10, y: 10 }, { x: 50, y: 200 }, { x: 90, y: 10 }] },
    { id: 'm8', type: 'textbox', page: 1, x: 310, y: 510, width: 30, height: 30 },
    { id: 'm9', type: 'measureDistance', page: 1, startX: 20, startY: 320, endX: 120, endY: 320 },
    { id: 'm10', type: 'comment', page: 2, x: 100, y: 100, width: 20, height: 20 },
  ];
  const spaces = [
    { id: 'office', page: 1, name: 'Office', color: '#27ae60', parentId: null, points: rect(0, 300, 400, 600) },
    { id: 'closet', page: 1, name: 'Closet', color: '#eb5757', parentId: null, points: rect(300, 500, 400, 600) },
  ];
  return { id: 'spaces-fixture', currentPage: 1, annotations, spaces };
}
