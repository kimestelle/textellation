import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Mono, Nanum_Myeongjo } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-newsreader",
});

const IBMPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-ibm-plex-mono",
});

const NanumMyeongjo = Nanum_Myeongjo({
  subsets: ["latin"],
  weight: ["400", "700", "800"],
  variable: "--font-nanum-myeongjo",
});

export const metadata: Metadata = {
  title: "textellation",
  description: "create typographic constellations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${newsreader.variable} ${IBMPlexMono.variable} ${NanumMyeongjo.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
