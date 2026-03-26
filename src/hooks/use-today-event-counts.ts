"use client";

import useSWR from "swr";
import { useMemo } from "react";
import { startOfDay, getUnixTime } from "date-fns";
import { tzFromDate } from "@/lib/timezone";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export function useTodayEventCounts(): Record<string, number> {
  const after = useMemo(() => {
    return getUnixTime(startOfDay(tzFromDate(new Date())));
  }, []);

  const { data } = useSWR<Array<{ camera: string }>>(
    `/api/frigate/events?after=${after}&limit=100`,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  return useMemo(() => {
    if (!data) return {};
    const counts: Record<string, number> = {};
    for (const e of data) {
      counts[e.camera] = (counts[e.camera] || 0) + 1;
    }
    return counts;
  }, [data]);
}
