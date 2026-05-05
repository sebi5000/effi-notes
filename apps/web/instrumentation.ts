/**
 * Next.js instrumentation hook.
 *
 * Called once per runtime (server / edge / node) BEFORE user code runs.
 * Programmatic OTel SDK init is the Bun-required path — `--require`
 * preloading does not work under Bun. See ADR 0016.
 *
 * The Edge runtime does not support the Node SDK; we register only on
 * the `nodejs` runtime.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initOtel } = await import('@app/observability/otel');
  initOtel({ serviceName: 'app-web' });
};
