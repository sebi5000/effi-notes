/**
 * Test-only helper. Builds a valid minimal single-page PDF containing the
 * given text, with a Helvetica text object so `pdfjs-dist` can both extract
 * the text and render the page. Object byte-offsets for the xref table are
 * computed as the body is assembled, so the output is always well-formed.
 */
export const makeSamplePdf = (text: string): Buffer => {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 24 Tf 40 120 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] ' +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(body, 'latin1');
};
