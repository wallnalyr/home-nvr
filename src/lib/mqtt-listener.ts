import mqtt from "mqtt";

const MQTT_URL = process.env.MQTT_URL || "mqtt://mqtt:1883";

let client: mqtt.MqttClient | null = null;

type EventHandler = (topic: string, payload: unknown) => void;
const handlers: EventHandler[] = [];

export function onFrigateEvent(handler: EventHandler) {
  handlers.push(handler);
}

export function startMQTTListener() {
  if (client) return;

  client = mqtt.connect(MQTT_URL, {
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    console.log("[MQTT] Connected to broker");
    // Review items: Frigate groups continuous tracked-object activity into one
    // review per camera. Subscribing here (instead of frigate/events) gives us
    // one message per activity burst, matching the dedup Frigate's own UI uses.
    client!.subscribe("frigate/reviews", (err) => {
      if (err) {
        console.error("[MQTT] Subscribe error (reviews):", err);
      } else {
        console.log("[MQTT] Subscribed to frigate/reviews");
      }
    });
    // Audio detection events: frigate/<camera>/audio/<label> → ON/OFF
    client!.subscribe("frigate/+/audio/+", (err) => {
      if (err) {
        console.error("[MQTT] Subscribe error (audio):", err);
      } else {
        console.log("[MQTT] Subscribed to frigate/+/audio/+");
      }
    });
  });

  client.on("message", (topic, message) => {
    try {
      const msg = message.toString();

      // Audio topics send plain "ON"/"OFF", not JSON
      if (topic.includes("/audio/")) {
        const parts = topic.split("/");
        // frigate/<camera>/audio/<label>
        const camera = parts[1];
        const audioLabel = parts[3];
        for (const handler of handlers) {
          handler(topic, { _audio: true, camera, label: audioLabel, state: msg });
        }
        return;
      }

      const payload = JSON.parse(msg);
      for (const handler of handlers) {
        handler(topic, payload);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  client.on("error", (err) => {
    console.error("[MQTT] Error:", err.message);
  });

  client.on("offline", () => {
    console.log("[MQTT] Offline, will reconnect");
  });
}

export function getMQTTStatus(): { connected: boolean; url: string } {
  return {
    connected: client?.connected ?? false,
    url: MQTT_URL,
  };
}

export function stopMQTTListener() {
  if (client) {
    client.end();
    client = null;
  }
}
