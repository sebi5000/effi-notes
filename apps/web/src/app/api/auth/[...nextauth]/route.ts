// Catch-all auth.js endpoint: callbacks, sign-in / sign-out, CSRF token,
// session JSON. Do not add other handlers here — auth.js owns the path.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
