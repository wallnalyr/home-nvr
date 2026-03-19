"use client";

import useSWR from "swr";

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

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

export function useRecordingSummary(camera: string | null) {
  const { data, error, isLoading } = useSWR<RecordingDay[]>(
    camera ? `/api/frigate/recordings/${encodeURIComponent(camera)}/summary` : null,
    fetcher,
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
