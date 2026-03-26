"use client";

import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";
import { useTheme } from "next-themes";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, HardDrive, Monitor, Wifi, Sun, Moon, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number) {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Smartphone },
] as const;

export function SystemInfo() {
  const { theme, setTheme } = useTheme();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading } = useSWR<any>("/api/system/hardware", authFetcher, {
    refreshInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Failed to load system info
      </div>
    );
  }

  const items = [
    {
      icon: Cpu,
      label: "CPU",
      value: `${data.cpu.cores} cores`,
      detail: data.cpu.model,
      meter: data.cpu.loadAvg[0] / data.cpu.cores,
    },
    {
      icon: HardDrive,
      label: "Memory",
      value: `${data.memory.usagePercent}%`,
      detail: `${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`,
      meter: data.memory.usagePercent / 100,
    },
    {
      icon: Monitor,
      label: "Detector",
      value: data.detector?.label || "CPU",
      detail: `Up to ${data.detector?.maxRecommendedCameras || "?"} cameras recommended`,
      meter: null,
    },
    {
      icon: Wifi,
      label: "Frigate",
      value:
        data.frigate.status === "connected"
          ? "Connected"
          : data.frigate.status === "disconnected"
            ? "Disconnected"
            : "Error",
      detail: data.frigate.url,
      meter: null,
    },
  ];

  return (
    <div className="space-y-2 p-4">
      {/* Theme selector */}
      <div className="flex items-center justify-between rounded-xl bg-card shadow-sm p-3">
        <span className="text-sm font-medium">Appearance</span>
        <div className="flex bg-secondary/60 rounded-lg p-0.5">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150",
                theme === opt.value
                  ? "bg-ios-blue text-white shadow-sm"
                  : "text-muted-foreground"
              )}
            >
              <opt.icon className="h-3.5 w-3.5" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-3 rounded-xl bg-card shadow-sm p-3"
        >
          <div className="rounded-lg bg-secondary p-2">
            <item.icon className="h-4 w-4 text-foreground/60" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{item.label}</span>
              <span className="text-sm text-muted-foreground">
                {item.value}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {item.detail}
            </p>
            {item.meter !== null && (
              <div className="mt-1.5 h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(item.meter * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
