import useSWR from "swr";
import { authFetcher } from "@/lib/fetcher";
import { DEFAULT_ENABLED_AUDIO } from "@/lib/objects";

export function useEnabledAudio() {
  const { data, error, mutate } = useSWR<{ enabledAudio: string[] }>(
    "/api/settings/audio",
    authFetcher
  );

  return {
    enabledAudio: data?.enabledAudio ?? DEFAULT_ENABLED_AUDIO,
    isLoading: !data && !error,
    mutate,
  };
}
