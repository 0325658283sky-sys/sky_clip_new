import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'SkyCut',
  description: '영상이나 블로그 글을 넣으면 바로 올릴 수 있는 쇼츠를 만들어 드려요.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            SkyCut
          </Link>
          <nav className="row" style={{ fontSize: 14 }}>
            <Link href="/" style={{ color: 'var(--accent-ink)', fontWeight: 500, textDecoration: 'none' }}>
              쇼츠 만들기
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
