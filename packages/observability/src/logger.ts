import { env } from '@app/config/env';
import pino, { type Logger, type LoggerOptions } from 'pino';

/**
 * Pino logger factory. One root logger per process; child loggers via
 * `createLogger().child({ ... })` for module-scoped context.
 *
 * Trace-context injection is automatic — the OTel
 * `@opentelemetry/instrumentation-pino` we register in `./otel.ts` adds
 * `trace_id` and `span_id` fields to every log record.
 *
 * Transport choice:
 *   - When OTEL_EXPORTER_OTLP_ENDPOINT is set: ship logs via OTLP using
 *     pino-opentelemetry-transport so they correlate with traces in
 *     Tempo/Loki via trace_id
 *   - When OTEL is disabled (local dev without obs): pretty-print to
 *     stdout via pino-pretty
 *   - Always: structured JSON to stdout as the base channel, so Compose
 *     log drivers and operators can grep
 */

const isProduction = env.NODE_ENV === 'production';
const otelEnabled = env.OTEL_EXPORTER_OTLP_ENDPOINT.trim().length > 0;

const otelTransportTarget = (): pino.TransportTargetOptions => ({
  target: 'pino-opentelemetry-transport',
  level: env.LOG_LEVEL,
  options: {
    loggerName: env.OTEL_SERVICE_NAME,
    resourceAttributes: {
      'service.name': env.OTEL_SERVICE_NAME,
      'deployment.environment': env.APP_ENV,
    },
  },
});

/**
 * pino `transport` targets (pino-pretty, pino-opentelemetry-transport) run
 * in a worker thread spawned by `thread-stream`. Next.js bundles the server
 * code and that worker cannot resolve the transport module — it throws
 * "unable to determine transport target for …" at logger construction,
 * which 500s any route whose module-load creates a logger.
 *
 * So inside the Next.js runtime we never attach a transport: pino writes
 * structured JSON straight to stdout (no worker), which the Compose log
 * driver still picks up. The standalone worker process (plain Bun, no
 * bundler) keeps the pretty/OTLP transports.
 */
const inNextRuntime = typeof process.env.NEXT_RUNTIME === 'string';

const buildOptions = (): LoggerOptions => {
  const base: LoggerOptions = {
    level: env.LOG_LEVEL,
    // null drops pid/hostname; service identity comes from OTel resource
    base: null,
  };

  // Next.js server runtime: plain JSON to stdout, no worker-thread transport.
  if (inNextRuntime) return base;

  // Production (worker): structured JSON to stdout, plus OTLP if enabled
  if (isProduction) {
    if (!otelEnabled) return base;
    return { ...base, transport: otelTransportTarget() };
  }

  // Dev (worker): pretty stdout, plus OTLP if enabled
  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino-pretty',
      level: env.LOG_LEVEL,
      options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
    },
  ];
  if (otelEnabled) targets.push(otelTransportTarget());
  return { ...base, transport: { targets } };
};

let cached: Logger | undefined;

export const getLogger = (): Logger => {
  if (cached) return cached;
  cached = pino(buildOptions());
  return cached;
};

export const createLogger = (bindings: Record<string, unknown>): Logger =>
  getLogger().child(bindings);
