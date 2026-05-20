import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { resolveTheme } from '@/lib/theme/resolve-theme.ts';
import './globals.css';

// Fonts are vendored under `src/fonts/` (axis-encoded variable woff2 from
// @fontsource-variable) so the build doesn't fetch Google Fonts — required
// for air-gapped / proxy-restricted customer installs. See
// `src/fonts/README.md` for the upstream source + SIL OFL attribution.
// (QA review 2026-05-20, P2.)
const inter = localFont({
  src: '../fonts/inter-variable.woff2',
  display: 'swap',
  variable: '--font-inter',
  weight: '100 900',
});

const newsreader = localFont({
  src: [
    { path: '../fonts/newsreader-variable.woff2', style: 'normal', weight: '100 900' },
    { path: '../fonts/newsreader-italic-variable.woff2', style: 'italic', weight: '100 900' },
  ],
  display: 'swap',
  variable: '--font-newsreader',
});

export const metadata: Metadata = {
  title: 'effi-notes',
  description: 'A markdown knowledge base for consulting teams.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Resolved before HTML streams → `data-theme` is correct on first paint, no
  // flash. See ADR 0029.
  const theme = await resolveTheme();
  return (
    <html lang={locale} data-theme={theme} className={`${inter.variable} ${newsreader.variable}`}>
      <body className="bg-paper text-foreground font-body min-h-screen antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
