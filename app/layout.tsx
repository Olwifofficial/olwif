import type { Metadata } from "next";
import "./globals.css";
import "./typography.css";
import "./verdict.css";
import "./account/account.css";
import "./celebration.css";

export const metadata: Metadata = {
  title: "OLWIF — Look What I Found",
  description: "Independent token research, linked evidence and honest unknowns, with O the owl.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
