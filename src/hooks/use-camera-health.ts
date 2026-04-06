"use client";

import useSWR from "swr";
import type { CameraHealth } from "@/lib/stream-warmer";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) return {};
  return res.json();
};

export function useCameraHealth(): Record<string, CameraHealth> {
  const { data } = useSWR<Record<string, CameraHealth>>(
    "/api/system/camera-health",
    fetcher,
    { refreshInterval: 10000, revalidateOnFocus: true }
  );

  return data || {};
}
