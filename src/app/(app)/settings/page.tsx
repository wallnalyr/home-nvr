"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SystemInfo } from "@/components/settings/system-info";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { FrigateSettings } from "@/components/settings/frigate-settings";
import { ObjectsSettings } from "@/components/settings/objects-settings";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = ["System", "Objects", "Notifications", "Frigate"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("System");
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    try {
      localStorage.removeItem("auth-token-backup");
    } catch {}
    router.push("/login");
    router.refresh();
  };

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 px-4 py-2 overflow-x-auto bg-card mx-4 mt-2 rounded-xl shadow-sm">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors tap-target",
              activeTab === tab
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "System" && <SystemInfo />}
      {activeTab === "Objects" && <ObjectsSettings />}
      {activeTab === "Notifications" && <NotificationSettings />}
      {activeTab === "Frigate" && <FrigateSettings />}

      {/* Logout */}
      <div className="p-4 mt-2">
        <Button
          variant="destructive"
          className="w-full h-11 gap-2 rounded-xl"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
