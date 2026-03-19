export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPreference {
  id: string;
  subscriptionId: string;
  camera: string;
  objectType: string;
  enabled: boolean;
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    eventId?: string;
    camera?: string;
    objectType?: string;
  };
}
