"use client";

import useSWR from "swr";
import type { Camera } from "@/types/camera";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

export function useCameras(options?: { fallbackData?: Camera[] }) {
  const { data, error, isLoading, mutate } = useSWR<Camera[]>(
    "/api/cameras",
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      errorRetryCount: 3,
      fallbackData: options?.fallbackData,
    }
  );

  return {
    cameras: data || [],
    isLoading,
    error,
    mutate,
  };
}
