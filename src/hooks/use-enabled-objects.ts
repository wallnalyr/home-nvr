import useSWR from "swr";
import { DEFAULT_ENABLED_OBJECTS } from "@/lib/objects";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useEnabledObjects() {
  const { data, error, mutate } = useSWR<{ enabledObjects: string[] }>(
    "/api/settings/objects",
    fetcher
  );

  return {
    enabledObjects: data?.enabledObjects ?? DEFAULT_ENABLED_OBJECTS,
    isLoading: !data && !error,
    mutate,
  };
}
