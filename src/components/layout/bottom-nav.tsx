"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, CircleDot, Clock, Film, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useUnseenCount } from "@/hooks/use-unseen-count";

const NAV_ITEMS = [
  { href: "/", label: "Live", icon: CircleDot },
  { href: "/events", label: "Events", icon: Clock },
  { href: "/recordings", label: "Recordings", icon: Film },
  { href: "/cameras", label: "Cameras", icon: Camera },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const unseenCount = useUnseenCount();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="app-bottom-nav flex-shrink-0 bg-card/95 nav-blur border-t border-border relative z-10 overscroll-none"
      style={{
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
        touchAction: "none",
      }}
    >
      <div className="flex items-center justify-around h-12">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const showBadge = item.href === "/events" && unseenCount > 0 && !active;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "tap-target flex flex-col items-center gap-0.5 px-3 py-1 transition-colors relative",
                active ? "text-ios-blue" : "text-ios-gray"
              )}
            >
              <motion.div
                whileTap={{ scale: 0.85 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="relative"
              >
                <item.icon
                  className="h-6 w-6"
                  strokeWidth={active ? 2 : 1.5}
                />
                {showBadge && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
                    {unseenCount > 99 ? "99+" : unseenCount}
                  </span>
                )}
              </motion.div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
