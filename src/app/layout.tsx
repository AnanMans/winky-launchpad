import "./globals.css";
import type { Metadata } from "next";
import ClientProviders from "@/components/ClientProviders";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Winky Launchpad",
  description: "Create a Solana memecoin with Linear / Degen / Random curves",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.className} min-h-dvh bg-black text-white`}>
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}

