import type { Metadata } from "next";
import { Newsreader, Nanum_Myeongjo, Space_Mono } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-newsreader",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
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
        className={`${newsreader.variable} ${spaceMono.variable} ${NanumMyeongjo.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
