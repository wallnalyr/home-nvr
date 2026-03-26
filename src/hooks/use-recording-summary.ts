"use client";

import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";

export interface RecordingHour {
  hour: string;
  duration: number;
  events: number;
  motion: number;
}

export interface RecordingDay {
  day: string;
  events: number;
  hours: RecordingHour[];
}

export function useRecordingSummary(camera: string | null) {
  const { data, error, isLoading } = useSWR<RecordingDay[]>(
    camera ? `/api/frigate/recordings/${encodeURIComponent(camera)}/summary` : null,
    authFetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: true,
      errorRetryCount: 2,
    }
  );

  return {
    summary: data || [],
    isLoading,
    error,
  };
}
