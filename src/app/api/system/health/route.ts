import { NextResponse } from "next/server";

const FRIGATE_URL = process.env.FRIGATE_URL || "http://frigate:5000";
const GO2RTC_URL = process.env.FRIGATE_INTERNAL_URL || "http://frigate:1984";
const FRIGATE_CONFIG_PATH = process.env.FRIGATE_CONFIG_PATH || "/config/frigate/config.yml";

async function checkService(
  url: string,
  timeout = 3000
): Promise<{ ok: boolean; status?: number; error?: string; data?: unknown }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    let data: unknown = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) {
      try {
        data = await res.json();
      } catch {
        /* ignore parse errors */
      }
    } else {
      try {
        data = await res.text();
      } catch {
        /* ignore */
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

export async function GET() {
  const [frigateVersion, frigateConfig, go2rtcStreams] = await Promise.all([
    checkService(`${FRIGATE_URL}/api/version`),
    checkService(`${FRIGATE_URL}/api/config`),
    checkService(`${GO2RTC_URL}/api/streams`),
  ]);

  // Check if config file exists on disk
  let configFileExists = false;
  try {
    const { access } = await import("fs/promises");
    await access(FRIGATE_CONFIG_PATH);
    configFileExists = true;
  } catch {
    configFileExists = false;
  }

  // Get cameras from DB
  let dbCameras: { name: string; slug: string }[] = [];
  try {
    const { prisma } = await import("@/lib/db");
    const cameras = await prisma.camera.findMany({
      where: { enabled: true },
      select: { name: true, slug: true },
    });
    dbCameras = cameras.map((c) => ({ name: c.name, slug: c.slug }));
  } catch {
    /* db not ready */
  }

  // Extract go2rtc stream names for comparison
  let go2rtcStreamNames: string[] = [];
  if (go2rtcStreams.ok && go2rtcStreams.data && typeof go2rtcStreams.data === "object") {
    go2rtcStreamNames = Object.keys(go2rtcStreams.data as Record<string, unknown>);
  }

  // Test fetching a frame from go2rtc for each DB camera
  const frameTests = await Promise.all(
    dbCameras.map(async (cam) => {
      try {
        const res = await fetch(
          `${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(cam.slug)}`,
          { method: "HEAD", signal: AbortSignal.timeout(3000) }
        );
        return { slug: cam.slug, status: res.status, ok: res.ok };
      } catch (e) {
        return { slug: cam.slug, status: 0, ok: false, error: e instanceof Error ? e.message : "unknown" };
      }
    })
  );

  // Check MQTT connection status
  let mqttStatus: { connected: boolean; url: string } = {
    connected: false,
    url: process.env.MQTT_URL || "mqtt://mqtt:1883",
  };
  try {
    const { getMQTTStatus } = await import("@/lib/mqtt-listener");
    mqttStatus = getMQTTStatus();
  } catch {
    /* mqtt module not loaded */
  }

  // Check push notification status
  let pushStatus: { vapidConfigured: boolean; subscriptionCount: number } = {
    vapidConfigured: false,
    subscriptionCount: 0,
  };
  try {
    const { VAPID_PUBLIC_KEY } = await import("@/lib/webpush");
    const { prisma: db } = await import("@/lib/db");
    const subCount = await db.pushSubscription.count();
    pushStatus = {
      vapidConfigured: !!VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY,
      subscriptionCount: subCount,
    };
  } catch {
    /* not ready */
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      frigate: {
        url: FRIGATE_URL,
        version: frigateVersion,
        config: {
          ok: frigateConfig.ok,
          status: frigateConfig.status,
          hasCameras:
            frigateConfig.data &&
            typeof frigateConfig.data === "object" &&
            "cameras" in (frigateConfig.data as Record<string, unknown>)
              ? Object.keys(
                  (frigateConfig.data as Record<string, unknown>)
                    .cameras as Record<string, unknown>
                )
              : null,
        },
      },
      go2rtc: {
        url: GO2RTC_URL,
        streams: go2rtcStreams,
      },
      mqtt: mqttStatus,
      push: pushStatus,
    },
    app: {
      configFilePath: FRIGATE_CONFIG_PATH,
      configFileExists,
      camerasInDb: dbCameras,
      go2rtcStreamNames,
      slugsMatchStreams: dbCameras.every((c) => go2rtcStreamNames.includes(c.slug)),
      frameTests,
    },
  });
}
