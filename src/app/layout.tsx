import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SWRegistrar } from "@/components/pwa/sw-registrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Camera Monitor",
  description: "Home camera monitoring NVR",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cameras",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#F2F2F7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const serverTz =
    process.env.TZ ||
    Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__SERVER_TZ__=${JSON.stringify(serverTz)};`,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <Toaster position="top-center" theme="light" />
          </TooltipProvider>
        </ThemeProvider>
        <SWRegistrar />
      </body>
    </html>
  );
}
