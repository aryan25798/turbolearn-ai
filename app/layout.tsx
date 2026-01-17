import type { Metadata, Viewport } from "next";
import { Inter, Fira_Code } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const fira = Fira_Code({ subsets: ["latin"], variable: "--font-code" });

export const metadata: Metadata = {
  title: "TurboLearn AI",
  description: "The fastest dual-core AI for students.",
  manifest: "/manifest.json", 
  // ✅ This section controls the tab icon and iPhone icon
  icons: {
    icon: '/icon.png', 
    shortcut: '/icon.png',
    apple: '/icon.png', 
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TurboLearn",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#131314",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${fira.variable} bg-[#131314] text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}