import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebP to GIF Converter",
  description: "Analyze, convert, and verify static or animated WebP files.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
