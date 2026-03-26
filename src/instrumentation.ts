export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
