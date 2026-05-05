import { env } from '@app/config/env';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, logs as sdkLogs, metrics as sdkMetrics } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { PrismaInstrumentation } from '@prisma/instrumentation';

/**
 * Programmatic OTel SDK init. Bun-required: the `--require` preload path
 * does not work, instrumentations must be loaded before the modules they
 * patch. Callers:
 *   - Next.js: `apps/web/instrumentation.ts` (Next runs this hook before
 *     any user code on each runtime — server, edge, node)
 *   - Worker: first import in `apps/worker/src/index.ts`, BEFORE bullmq,
 *     ioredis, prisma are imported anywhere
 *
 * Allow-list, not auto-instrumentations: per ADR 0016, we explicitly
 * curate which instrumentations load. Adding one here is a deliberate
 * choice — write it in the ADR before merging.
 *
 * Disabling export: set `OTEL_EXPORTER_OTLP_ENDPOINT` to empty in env.
 * The SDK still patches modules (cheap), it just does not ship anything.
 */
type InitOptions = {
  serviceName: string;
  serviceVersion?: string;
};

let started = false;

export const initOtel = ({ serviceName, serviceVersion }: InitOptions): NodeSDK | null => {
  if (started) return null;
  started = true;

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT.trim();
  const exportEnabled = endpoint.length > 0;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion ?? '0.0.0',
    'deployment.environment': env.APP_ENV,
  });

  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
    resource,
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';
          return url.startsWith('/_next/') || url === '/favicon.ico';
        },
      }),
      new UndiciInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new PinoInstrumentation(),
      new PrismaInstrumentation(),
    ],
  };

  if (exportEnabled) {
    sdkConfig.traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });
    sdkConfig.metricReaders = [
      new sdkMetrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: 30_000,
      }),
    ];
    sdkConfig.logRecordProcessors = [
      new sdkLogs.BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` })),
    ];
  }

  const sdk = new NodeSDK(sdkConfig);
  sdk.start();

  // Graceful shutdown — flush pending exports
  const shutdown = (): void => {
    sdk
      .shutdown()
      .catch((err: unknown) => {
        console.error('OTel SDK shutdown error:', err);
      })
      .finally(() => {
        process.exit(0);
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  return sdk;
};
