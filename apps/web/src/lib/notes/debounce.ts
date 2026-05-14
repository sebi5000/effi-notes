/**
 * Tiny debounce helper. Returns a fn that delays calls until the input
 * settles for `ms` milliseconds. Pending calls can be cancelled via the
 * returned `.cancel()`.
 *
 * Why our own: avoid an external dep for a 12-line helper. The CommandBar
 * uses this for the search input.
 */
export type Debounced<Args extends unknown[]> = ((...args: Args) => void) & {
  cancel: () => void;
};

export const debounce = <Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): Debounced<Args> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = ((...args: Args) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as Debounced<Args>;
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
};
