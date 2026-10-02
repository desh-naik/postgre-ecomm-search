import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bazaar · Postgres search demo",
  description: "Hybrid keyword + semantic product search inside Postgres",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
