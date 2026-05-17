/**
 * Decides the note's next title from its first heading. Returns the new
 * title, or null when nothing should change: the title is manually pinned,
 * there is no heading, or the heading already matches the current title.
 */
export const nextAutoTitle = (
  firstHeading: string | undefined,
  currentTitle: string,
  titleManuallySet: boolean,
): string | null => {
  if (titleManuallySet) return null;
  const heading = firstHeading?.trim() ?? '';
  if (heading.length === 0) return null;
  if (heading === currentTitle) return null;
  return heading;
};
