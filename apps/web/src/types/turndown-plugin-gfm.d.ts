// `turndown-plugin-gfm` ships no type declarations and there is no
// @types package. Declare the small surface we use: each export is a
// Turndown plugin (a function that mutates a TurndownService instance).
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export const gfm: TurndownService.Plugin;
  export const tables: TurndownService.Plugin;
  export const strikethrough: TurndownService.Plugin;
  export const taskListItems: TurndownService.Plugin;
}
