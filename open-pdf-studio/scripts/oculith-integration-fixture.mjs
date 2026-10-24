import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

// Kept in code so the same rights-free drawing can be used by browser and
// native acceptance without committing a generated binary.
export async function constructionReviewFixture({ revised = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sheets = ['A-101 Ground floor', 'A-102 First floor', 'E-201 Lighting', 'M-301 Mechanical'];
  for (const [index, title] of sheets.entries()) {
    const page = pdf.addPage([612, 792]);
    page.drawText(title, { x: 48, y: 744, size: 17, font });
    page.drawText(`ISSUED FOR REVIEW  |  REV ${revised ? 'B' : 'A'}`, { x: 48, y: 722, size: 10, font });
    page.drawRectangle({ x: 48, y: 82, width: 516, height: 620, borderWidth: 1, borderColor: rgb(0, 0, 0), color: rgb(1, 1, 1) });
    for (let bay = 0; bay < 4; bay++) {
      const x = 96 + bay * 120;
      page.drawLine({ start: { x, y: 154 }, end: { x, y: 616 }, thickness: 1 });
      page.drawText(String(bay + 1), { x: x - 3, y: 635, size: 9, font });
    }
    page.drawLine({ start: { x: 96, y: 350 }, end: { x: 456, y: 350 }, thickness: 1 });
    page.drawLine({ start: { x: 96, y: 506 }, end: { x: 456, y: 506 }, thickness: 1 });
    if (revised && index === 1) {
      page.drawRectangle({ x: 262, y: 392, width: 80, height: 56, color: rgb(0.14, 0.37, 0.62) });
      page.drawText('REV B PANEL', { x: 268, y: 418, size: 9, font, color: rgb(1, 1, 1) });
    }
    // M-301 exercises a visible, nonzero CropBox origin under page rotation.
    if (index === 3) {
      page.setCropBox(36, 40, 540, 720);
      page.setRotation(degrees(90));
    }
  }
  return new Uint8Array(await pdf.save());
}
