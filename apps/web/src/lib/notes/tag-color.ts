const TAG_PALETTE = [
  '#C26A20',
  '#7C3F00',
  '#4B5066',
  '#2F6F4F',
  '#A03A2B',
  '#5A4B8A',
  '#9B6A2F',
  '#356680',
] as const;

/** Deterministic chip colour for a tag name — stable across renders/sessions. */
export const tagColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length] ?? TAG_PALETTE[0];
};
