import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdf.js renders against DOM APIs that do not exist in a non-browser runtime.
// `@napi-rs/canvas` ships compatible implementations; install them once at
// module load. `??=` so an existing global (e.g. a future Bun built-in) wins.
const globals = globalThis as typeof globalThis & {
  DOMMatrix?: unknown;
  Path2D?: unknown;
  ImageData?: unknown;
};
globals.DOMMatrix ??= DOMMatrix;
globals.Path2D ??= Path2D;
globals.ImageData ??= ImageData;

/** Result of parsing + rendering a PDF. */
export type PdfRenderResult = {
  /** Concatenated text of every page. */
  text: string;
  /** Total page count. */
  pageCount: number;
  /** Page 1 rendered to a PNG. */
  previewPng: Buffer;
};

/** Target width (px) of the rendered page-1 preview. Height keeps the aspect. */
const PREVIEW_WIDTH = 600;

/**
 * Parse a PDF: extract all text, count pages, and render page 1 to a PNG.
 * Used by the `pdf.extract` worker processor.
 */
export const processPdf = async (data: Uint8Array): Promise<PdfRenderResult> => {
  const doc = await getDocument({ data }).promise;
  try {
    const pageCount = doc.numPages;
    const firstPage = await doc.getPage(1);

    const parts: string[] = [];
    for (let n = 1; n <= pageCount; n += 1) {
      const page = n === 1 ? firstPage : await doc.getPage(n);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    const text = parts.join('\n').trim();

    const unit = firstPage.getViewport({ scale: 1 });
    const viewport = firstPage.getViewport({ scale: PREVIEW_WIDTH / unit.width });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    // `@napi-rs/canvas` types are structurally compatible with the DOM canvas
    // pdf.js expects, but are nominally distinct. `canvas: null` selects the
    // backwards-compatible `canvasContext` render path. The param type is taken
    // from `render` itself so no internal pdf.js type path is depended upon.
    type RenderParams = Parameters<typeof firstPage.render>[0];
    const renderParams = {
      canvasContext: context,
      viewport,
      canvas: null,
    } as unknown as RenderParams;
    await firstPage.render(renderParams).promise;
    const previewPng = canvas.toBuffer('image/png');

    return { text, pageCount, previewPng };
  } finally {
    // `destroy()` terminates the pdfjs worker and subsumes `cleanup()`. Runs on
    // every path so a failed parse never leaks a document in the long-lived
    // worker process.
    await doc.destroy();
  }
};
