"use client";

import useSWR from "swr";
import { useLastSeenEventTime, countUnseenEvents } from "./use-unseen-events";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

/**
 * Returns the number of unseen events.
 * Polls recent events and compares against the last time the user viewed the events tab.
 */
export function useUnseenCount(): number {
  const { lastSeenTime } = useLastSeenEventTime();

  // Fetch a small number of recent events to count unseen
  const { data: events } = useSWR<Array<{ start_time: number }>>(
    lastSeenTime > 0 ? `/api/frigate/events?limit=50&after=${lastSeenTime}` : null,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  );

  if (!events || lastSeenTime === 0) return 0;
  return countUnseenEvents(events, lastSeenTime);
}
