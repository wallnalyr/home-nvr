import useSWR from "swr";
import { DEFAULT_ENABLED_AUDIO } from "@/lib/objects";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useEnabledAudio() {
  const { data, error, mutate } = useSWR<{ enabledAudio: string[] }>(
    "/api/settings/audio",
    fetcher
  );

  return {
    enabledAudio: data?.enabledAudio ?? DEFAULT_ENABLED_AUDIO,
    isLoading: !data && !error,
    mutate,
  };
}
