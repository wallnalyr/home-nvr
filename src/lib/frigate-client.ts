const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";

interface FrigateRequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function frigateRequest(path: string, options: FrigateRequestOptions = {}) {
  const { method = "GET", body, timeout = 10000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${FRIGATE_URL}/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Frigate API error: ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return res.json();
    }
    return res;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function getFrigateEvents(params: Record<string, string | number | boolean | undefined> = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return frigateRequest(`/events${query ? `?${query}` : ""}`);
}

export async function getFrigateEvent(id: string) {
  return frigateRequest(`/events/${encodeURIComponent(id)}`);
}

export async function getFrigateEventSnapshot(id: string): Promise<Response> {
  return fetch(`${FRIGATE_URL}/api/events/${encodeURIComponent(id)}/snapshot.jpg`, {
    signal: AbortSignal.timeout(10000),
  });
}

export async function getFrigateSnapshot(cameraName: string): Promise<Response> {
  return fetch(`${FRIGATE_URL}/api/${encodeURIComponent(cameraName)}/latest.jpg`, {
    signal: AbortSignal.timeout(10000),
  });
}

export async function getFrigateRecordings(cameraName: string, params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  const query = searchParams.toString();
  return frigateRequest(`/${encodeURIComponent(cameraName)}/recordings${query ? `?${query}` : ""}`);
}

export async function getFrigateStats() {
  return frigateRequest("/stats");
}

export async function getFrigateConfig() {
  return frigateRequest("/config");
}

export async function deleteFrigateEvent(id: string) {
  return frigateRequest(`/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function toggleFrigateEventRetain(id: string, retain: boolean) {
  return frigateRequest(`/events/${encodeURIComponent(id)}/retain`, {
    method: retain ? "POST" : "DELETE",
  });
}

export async function saveFrigateConfig(configYaml: string) {
  const res = await fetch(`${FRIGATE_URL}/api/config/save?save_option=restart`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: configYaml,
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    // Frigate's validation errors can echo config context, including camera
    // RTSP URLs with credentials — redact and bound the body before it
    // travels into thrown errors and API responses (configWarning).
    // Greedy to the LAST @ in the token so passwords containing '/', '@',
    // or quotes are over-redacted rather than leaked.
    let body = raw.replace(/rtsps?:\/\/\S*@/gi, "rtsp://***@");
    // Belt and suspenders: strip the exact credential substrings from the
    // config we just pushed, in case an error echoes them outside a URL.
    for (const match of configYaml.matchAll(/rtsps?:\/\/(\S*)@/gi)) {
      if (match[1] && match[1].length >= 3) {
        body = body.split(`${match[1]}@`).join("***@");
      }
    }
    throw new Error(
      `Failed to save Frigate config: ${res.status} ${body.slice(0, 500)}`,
    );
  }
  return res.json();
}
