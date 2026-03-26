export interface Camera {
  id: string;
  name: string;
  slug: string;
  hasSubStream?: boolean;
  enabled: boolean;
  detectEnabled: boolean;
  detectWidth: number;
  detectHeight: number;
  detectFps: number;
  objectsTrack: string;
  audioDetect: string;
  recordEnabled: boolean;
  recordRetainDays: number;
  snapshotsEnabled: boolean;
  notifyEnabled: boolean;
  notifyCooldownSec: number;
  motionThreshold: number;
  motionMask: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  zones: Zone[];
}

export interface CameraFormData {
  name: string;
  rtspUrl: string;
  rtspSubUrl?: string;
  enabled?: boolean;
  detectEnabled?: boolean;
  detectWidth?: number;
  detectHeight?: number;
  detectFps?: number;
  objectsTrack?: string;
  audioDetect?: string;
  recordEnabled?: boolean;
  recordRetainDays?: number;
  snapshotsEnabled?: boolean;
  notifyEnabled?: boolean;
  notifyCooldownSec?: number;
  motionThreshold?: number;
  motionMask?: string;
  sortOrder?: number;
}

export interface Zone {
  id: string;
  name: string;
  coordinates: string;
  objects: string;
  cameraId: string;
}
