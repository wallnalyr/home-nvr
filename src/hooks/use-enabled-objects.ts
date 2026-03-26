import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";
import { DEFAULT_ENABLED_OBJECTS } from "@/lib/objects";

export function useEnabledObjects() {
  const { data, error, mutate } = useSWR<{ enabledObjects: string[] }>(
    "/api/settings/objects",
    authFetcher
  );

  return {
    enabledObjects: data?.enabledObjects ?? DEFAULT_ENABLED_OBJECTS,
    isLoading: !data && !error,
    mutate,
  };
}
