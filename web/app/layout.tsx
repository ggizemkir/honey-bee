import './globals.css';
import { Fraunces, Space_Grotesk } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const fraunces = Fraunces({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600', '700'],
  variable: '--font-fraunces'
});

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-space'
});

export const metadata: Metadata = {
  title: 'HornetSavunma - Akustik Tespit Arayüzü',
  description:
    'INMP441 mikrofonu ve ESP32 ile 100-1000 Hz aralığında bal arısı / eşek arısı ses tespiti yapan akustik izleme paneli.'
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="tr" className={`${fraunces.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
