import { hasRole } from '@app/auth/rbac';
import { env } from '@app/config/env';
import { auth } from '@/auth';

/**
 * Catch-all proxy: /admin/queues/* → worker's internal Bull Board.
 *
 * Auth + ops-role enforced here. The worker's HTTP port is reachable
 * only on the internal Compose network (net-app), so this route is the
 * single ingress to Bull Board for humans.
 *
 * This is a streaming, header-preserving reverse-proxy. We do NOT
 * rewrite HTML or assets — Bull Board uses the basePath we set on the
 * BunAdapter, so its links already point to /admin/queues/*.
 */

const PROXY_HEADERS_STRIP = new Set([
  // Hop-by-hop headers per RFC 7230
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  // Response-side
  'content-encoding',
  'content-length',
]);

const proxy = async (req: Request): Promise<Response> => {
  const session = await auth();
  if (!session?.user) {
    return new Response('Unauthorised', { status: 401 });
  }
  if (!hasRole(session.user, 'ops')) {
    return new Response('Forbidden — ops role required', { status: 403 });
  }

  const url = new URL(req.url);
  const target = new URL(`${url.pathname}${url.search}`, env.BULL_BOARD_INTERNAL_URL);

  // Forward the request, stripping hop-by-hop headers
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (!PROXY_HEADERS_STRIP.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set('host', target.host);

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body:
      req.method === 'GET' || req.method === 'HEAD'
        ? null
        : (req.body as ReadableStream<Uint8Array> | null),
    // @ts-expect-error -- duplex required for streaming bodies, not yet in lib types
    duplex: 'half',
    redirect: 'manual',
  });

  // Copy upstream headers, stripping hop-by-hop
  const responseHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (!PROXY_HEADERS_STRIP.has(k.toLowerCase())) responseHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
