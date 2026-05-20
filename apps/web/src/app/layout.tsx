import type { Metadata } from 'next';
import { Inter, Newsreader } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { resolveTheme } from '@/lib/theme/resolve-theme.ts';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-newsreader',
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
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
