import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@localhost";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log(
      `[WebPush] VAPID configured (public key: ${VAPID_PUBLIC_KEY.slice(0, 10)}..., subject: ${VAPID_SUBJECT})`
    );
  } catch (err) {
    console.error(
      "[WebPush] Failed to set VAPID details — keys may be invalid:",
      err instanceof Error ? err.message : err
    );
  }
} else {
  console.warn(
    "[WebPush] VAPID keys not configured — push notifications disabled. " +
      `Public key ${VAPID_PUBLIC_KEY ? "set" : "MISSING"}, ` +
      `Private key ${VAPID_PRIVATE_KEY ? "set" : "MISSING"}`
  );
}

export { webpush, VAPID_PUBLIC_KEY };
