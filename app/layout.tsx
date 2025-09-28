import './globals.css';
import Providers from './providers';
import { DM_Sans } from 'next/font/google';

export const metadata = { title: 'Curve Launchpad', description: 'Create coins with curves' };

const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400','500','700'], display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
