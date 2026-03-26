"use client";

import { useCallback, useSyncExternalStore } from "react";

function getPermissionSnapshot(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window))
    return "default";
  return Notification.permission;
}

function getServerPermission(): NotificationPermission {
  return "default";
}

// Permission doesn't have a change event, so we use a dummy subscribe
// that never fires. Permission changes require a user gesture anyway,
// and we update via the requestPermission callback.
let permissionListeners: Array<() => void> = [];

function subscribePermission(callback: () => void): () => void {
  permissionListeners.push(callback);
  return () => {
    permissionListeners = permissionListeners.filter((l) => l !== callback);
  };
}

function notifyPermissionChange() {
  for (const l of permissionListeners) l();
}

export function useNotificationPermission() {
  const permission = useSyncExternalStore(
    subscribePermission,
    getPermissionSnapshot,
    getServerPermission
  );

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!("Notification" in window)) return false;
    const result = await Notification.requestPermission();
    notifyPermissionChange();
    return result === "granted";
  }, []);

  return { permission, requestPermission };
}
