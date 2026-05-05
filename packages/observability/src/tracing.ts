import { type Attributes, SpanStatusCode, type Tracer, trace } from '@opentelemetry/api';

/**
 * Manual span wrapper for code paths the auto-instrumentations do not
 * cover — most importantly BullMQ job processors.
 *
 * Usage in a worker processor:
 *
 *   export const processDemo = (job: Job<DemoJobPayload>) =>
 *     withSpan('demo.process', { 'job.id': job.id }, async (span) => {
 *       span.addEvent('starting');
 *       // … do work …
 *       return result;
 *     });
 *
 * The span:
 *   - Is recorded on the OTel SDK's tracer for the calling service
 *   - Inherits the active context, so child spans (DB, HTTP) attach to it
 *   - On thrown errors, status is set to ERROR and the exception is recorded
 */
const getTracer = (name = 'app'): Tracer => trace.getTracer(name);

export const withSpan = async <T>(
  name: string,
  attributes: Attributes,
  fn: (span: import('@opentelemetry/api').Span) => Promise<T>,
): Promise<T> =>
  getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) span.recordException(err);
      throw err;
    } finally {
      span.end();
    }
  });
