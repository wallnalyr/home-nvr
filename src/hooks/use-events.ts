"use client";

import useSWR from "swr";
import type { FrigateEvent, FrigateEventFilters } from "@/types/event";

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Invalid response");
  return data;
};

export function useEvents(filters: FrigateEventFilters = {}) {
  const params = new URLSearchParams();
  if (filters.camera) params.set("camera", filters.camera);
  if (filters.label) params.set("label", filters.label);
  if (filters.zone) params.set("zone", filters.zone);
  if (filters.after) params.set("after", String(filters.after));
  if (filters.before) params.set("before", String(filters.before));
  if (filters.has_clip !== undefined)
    params.set("has_clip", String(filters.has_clip ? 1 : 0));
  if (filters.has_snapshot !== undefined)
    params.set("has_snapshot", String(filters.has_snapshot ? 1 : 0));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.favorites) params.set("favorites", "1");

  const query = params.toString();
  const url = `/api/frigate/events${query ? `?${query}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<FrigateEvent[]>(
    url,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      errorRetryCount: 3,
    }
  );

  return {
    events: data || [],
    isLoading,
    error,
    mutate,
  };
}
