import type { DocumentState } from '../../types/document.js';
import { attachUndoHistory } from '../undo-stacks.js';

/**
 * Creates a new document state object
 */
export function createDocument(filePath: string | null = null): DocumentState {
  // The undo/redo arrays move out of the object into undo-stacks.js before
  // the document enters the store; doc.undoStack/redoStack stay readable.
  return attachUndoHistory({
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    filePath: filePath,
    fileName: filePath ? filePath.split(/[\\/]/).pop()! : 'Untitled',
    pdfDoc: null,
    currentPage: 1,
    scale: 1.5,
    viewMode: 'single',
    annotations: [],
    textEdits: [],
    watermarks: [],
    ocrResults: {},
    bookmarks: [],
    undoStack: [],
    redoStack: [],
    savedUndoStackLength: 0,
    selectedAnnotation: null,
    selectedAnnotations: [],
    modified: false,
    scrollPosition: { x: 0, y: 0 },
    readerModeActive: false,
    pageRotations: {},
    // Weergave draaien (#200): alleen hoe de pagina's op het scherm staan;
    // geen documentbewerking, niet in ongedaan maken, niet opgeslagen.
    viewRotation: 0,
    pdfaCompliance: null,
    pdfADismissed: false,
    measureScale: null,
    // Scale found in the page text at load: a suggestion only, never applied
    // without the user confirming it in Set Scale. Not persisted.
    detectedScale: null,
    stylePresets: [],
    // Annotatielagen (#468): leeg = alleen de standaardlaag, zodat een
    // document zonder lagen werkt en bewaard wordt zoals voorheen.
    annotationLayers: [],
    currentLayerId: null,
    _loadedAnnotationPages: new Set(),
    // Pagina's waarvan de annotaties ECHT in het model staan (pas na
    // conversie gezet). _loadedAnnotationPages markeert al bij de start
    // van het laden (dedupe); de saver mag alleen op deze set vertrouwen.
    _annotationPagesReady: new Set(),
    _sharedPdfLibDoc: null,
    _sharedPdfLibDocPromise: null,
    _pdfLibSource: null,
    _pagesNeedingColorUpdate: new Set(),
    _annotationLoadId: 0,
    _isLoading: false,
  });
}

let untitledCounter = 0;

/**
 * Get the next untitled document name
 */
export function getNextUntitledName(): string {
  untitledCounter++;
  if (untitledCounter === 1) return 'Untitled.pdf';
  return `Untitled ${untitledCounter}.pdf`;
}
