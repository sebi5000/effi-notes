import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // `typedRoutes` moved out of `experimental` — flagging it here silences
  // the build warning Next emits since 16.0.
  typedRoutes: true,
  // The account-less public note viewer must never be search-indexed
  // (ADR 0028). The baseline security headers / CSP stay with Caddy.
  headers: async () => [
    {
      source: '/p/:path*',
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    },
  ],
};

export default withNextIntl(config);
