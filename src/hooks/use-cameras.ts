"use client";

import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";
import type { Camera } from "@/types/camera";

export function useCameras(options?: { fallbackData?: Camera[] }) {
  const { data, error, isLoading, mutate } = useSWR<Camera[]>(
    "/api/cameras",
    authFetcher,
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
