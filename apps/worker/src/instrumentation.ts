// MUST be imported first in the worker entry — OTel instrumentations
// patch modules at import time, so any import that happens before this
// runs will not be traced. See ADR 0016 and CLAUDE.md "Observability".
import { initOtel } from '@app/observability/otel';

initOtel({ serviceName: 'app-worker' });
