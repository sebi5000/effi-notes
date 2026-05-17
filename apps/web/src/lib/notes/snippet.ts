const SNIPPET_LEN = 140;

/**
 * A short, single-line preview of a note's body for the sidebar list.
 * Collapses all whitespace, trims, and caps the length. The full body is
 * never sent to the client — only this snippet.
 */
export const toSnippet = (body: string): string =>
  body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LEN);
