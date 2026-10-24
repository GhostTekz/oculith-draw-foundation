import { PDFName, PDFNumber } from 'pdf-lib';

/** PDF.js scale-one page-view coordinates include /UserUnit; pdf-lib boxes do not. */
export function pageUserUnit(page) {
  const raw = page?.node?.lookup(PDFName.of('UserUnit'));
  const value = raw instanceof PDFNumber ? raw.asNumber() : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}
