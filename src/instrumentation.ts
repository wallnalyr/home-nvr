export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Self-heal stored audio label vocabulary (legacy ids, duplicates)
    // before anything reads it — see normalize-stored-audio.ts
    const { normalizeStoredAudioLabels } = await import(
      "@/lib/normalize-stored-audio"
    );
    await normalizeStoredAudioLabels().catch((err) => {
      console.error("[Audio] Label normalization failed:", err);
    });

    // Push Frigate config on startup (cameras may have been added while Frigate was starting)
    const { regenerateFrigateConfig } = await import(
      "@/lib/frigate-config-gen"
    );
    // Delay to give Frigate time to start
    setTimeout(() => {
      regenerateFrigateConfig().catch((err) => {
        console.error("[Config] Failed to push config to Frigate on startup:", err);
      });
    }, 10000);

    // Watch for Frigate running a config that diverges from the DB
    // (failed pushes, stale file restarts) and self-heal with one re-push
    const { startConfigDriftMonitor } = await import("@/lib/config-drift");
    startConfigDriftMonitor();

    // Start stream warmer (snapshot cache + camera health monitoring)
    const { startStreamWarmer } = await import("@/lib/stream-warmer");
    startStreamWarmer().catch((err) => {
      console.error("[StreamWarmer] Failed to start:", err);
    });

    // Start MQTT listener for Frigate events
    const { startMQTTListener, onFrigateEvent } = await import(
      "@/lib/mqtt-listener"
    );
    const { handleFrigateEvent } = await import(
      "@/lib/notification-dispatcher"
    );

    onFrigateEvent((_topic, payload) => {
      handleFrigateEvent(payload).catch((err) => {
        console.error("[Notification] Error handling event:", err);
      });
    });

    startMQTTListener();
  }
}
