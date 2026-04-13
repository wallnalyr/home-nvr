"use client";

import { useEffect } from "react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { SessionRestorer } from "@/components/auth/session-restorer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // Prevent iOS overscroll bounce on non-scrollable areas (header, nav)
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      // Allow touches inside scrollable content areas
      if (target.closest("main")) return;
      // Prevent viewport bounce on header, footer, etc.
      e.preventDefault();
    };
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => document.removeEventListener("touchmove", onTouchMove);
  }, []);

  return (
    <>
      <div className="h-screen h-[100dvh] flex flex-col overflow-hidden overscroll-none">
        <div
          className="flex-shrink-0 bg-background"
          style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
        />
        <main
          className="flex-1 min-h-0 overflow-y-auto ios-scroll bg-background relative pb-4"
          style={
            {
              touchAction: "pan-y",
              WebkitOverflowScrolling: "touch",
            } as React.CSSProperties
          }
        >
          {children}
        </main>
        <BottomNav />
      </div>
      <InstallPrompt />
      <SessionRestorer />
    </>
  );
}
