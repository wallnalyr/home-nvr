# Home NVR

A self-hosted network video recorder with live camera feeds, AI-powered object and audio detection, continuous recording, and real-time push alerts. Built on Next.js, Frigate, and go2rtc.

## Features

- **Live Streaming** — MSE (fMP4 over WebSocket) with automatic WebRTC fallback, playback rate catchup, stall detection, and buffer management
- **Object Detection** — Person, car, animal, package, and more via Frigate's AI models (CPU, Coral TPU, or NVIDIA TensorRT)
- **Audio Detection** — Fire alarms, glass breaking, screams, barking, and other sounds via Frigate's YAMNet model, configurable per camera
- **Continuous Recording** — Configurable retention per camera with hour-by-hour playback via HLS
- **Event Browser** — Filterable event grid with snapshots, clips, batch delete, and saved/favorite events
- **Push Notifications** — Real-time alerts with snapshots, per-object and per-camera filtering, cooldown control
- **PWA** — Installable on iOS/Android with app badge counts, offline support, and native fullscreen with audio
- **Hardware Aware** — Auto-detects GPU and Coral TPU, recommends camera limits, enables NVDEC acceleration when available
- **Zero-Config Secrets** — JWT and VAPID keys auto-generate on first boot and persist across restarts

## Architecture

| Component | Role |
|-----------|------|
| **Next.js 16** (App Router) | Web app, API proxy, config management |
| **Frigate** | Object/audio detection, recording, event management |
| **go2rtc** | RTSP restreaming, MSE/WebRTC for live view |
| **Mosquitto** | MQTT broker for Frigate event notifications |
| **SQLite** (Prisma) | Camera config, push subscriptions, notification preferences |
| **Traefik** | Reverse proxy with TLS (external) |

## Prerequisites

- Docker and Docker Compose
- RTSP cameras on your network
- (Optional) NVIDIA GPU with nvidia-container-toolkit for hardware acceleration
- (Optional) Google Coral TPU for efficient object detection

## Quick Start

### 1. Configure

Edit `docker-compose.yml` and set these values:

```yaml
environment:
  ADMIN_PASSWORD: changeme                        # Your login password
  TZ: America/New_York                            # Your timezone (IANA format)
  NEXT_PUBLIC_APP_URL: https://camera.yourdomain.com
  VAPID_SUBJECT: mailto:you@example.com           # Must be a routable domain (not .internal/.local)
```

Everything else has sensible defaults:
- **JWT_SECRET** — auto-generated on first boot, persisted in the data volume
- **VAPID keys** — auto-generated on first boot, persisted in the data volume
- **Database** — SQLite, created automatically with migrations

### 2. Start

```bash
docker compose up -d
```

The app will:
1. Generate secrets (JWT, VAPID) if not already present
2. Run database migrations
3. Push camera config to Frigate
4. Connect to MQTT for real-time event notifications
5. Begin warming camera streams for instant live view

### 3. Add cameras

1. Open the app and log in with your password (username defaults to `admin`)
2. Go to **Cameras** tab
3. Tap **Add** and enter the camera name and RTSP URL
4. Configure which objects and audio events to detect per camera
5. The app generates the Frigate config and pushes it automatically

#### RTSP URL format (Hikvision)
```
rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101   # Main stream
rtsp://admin:password@192.168.1.100:554/Streaming/Channels/102   # Sub stream
```

## GPU Setup (Optional)

For NVIDIA GPU acceleration, uncomment the GPU section in `docker-compose.yml` under the frigate service and ensure nvidia-container-toolkit is installed:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

## Deployment

### Docker Compose

The included `docker-compose.yml` runs the full stack: app, Frigate, Mosquitto. It includes Traefik labels for automatic HTTPS routing.

### Portainer

Deploy as a stack in Portainer. Set environment variables in the Portainer UI — no `.env` file needed. Pull and redeploy to update.

### Network Requirements

| Port | Protocol | Purpose |
|------|----------|---------|
| 8554 | TCP | RTSP restream (Frigate) |
| 8555 | TCP/UDP | WebRTC media (go2rtc) — required for iOS live view |
| 3000 | TCP | App (internal, routed through Traefik) |

The go2rtc WebSocket is routed through Traefik at the `/go2rtc/` path prefix. `NEXT_PUBLIC_APP_URL` must be set so go2rtc advertises the correct WebRTC ICE candidates.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | Yes | — | Login password (hashed at runtime) |
| `TZ` | Yes | `America/New_York` | Timezone for timestamps and recordings |
| `NEXT_PUBLIC_APP_URL` | Yes | — | Public URL of the app (used for WebRTC ICE candidates) |
| `VAPID_SUBJECT` | Yes | — | `mailto:` email for push notifications (must be routable domain) |
| `JWT_SECRET` | No | Auto-generated | Auth token signing key |
| `VAPID_PUBLIC_KEY` | No | Auto-generated | Web push public key |
| `VAPID_PRIVATE_KEY` | No | Auto-generated | Web push private key |
| `ADMIN_USERNAME` | No | `admin` | Login username |
| `ADMIN_PASSWORD_HASH` | No | — | Pre-hashed password (bypasses `ADMIN_PASSWORD`) |
| `DATABASE_URL` | No | `file:./data/camera-monitor.db` | SQLite database path |
| `FRIGATE_URL` | No | `http://frigate:5000` | Frigate API URL |
| `MQTT_URL` | No | `mqtt://mqtt:1883` | MQTT broker URL |

## Project Structure

```
src/
  app/
    (app)/              # Authenticated app pages (live, events, recordings, cameras, settings)
    api/                # API routes (auth, cameras, frigate proxy, push, settings, system)
    login/              # Login page
  components/
    streaming/          # Live view components (camera-feed, camera-grid)
    events/             # Event browser components
    recordings/         # Recording playback components
    cameras/            # Camera management (form with object/audio selection)
    settings/           # Settings panels (objects, audio, notifications)
    pwa/                # PWA install prompt, push manager, service worker
    ui/                 # shadcn/ui components
  hooks/                # React hooks (streaming, events, cameras, push, etc.)
  lib/                  # Server utilities (auth, Frigate client, config gen, MQTT, notifications)
  types/                # TypeScript type definitions
prisma/                 # Database schema and migrations
public/                 # PWA assets and service worker
scripts/                # CLI utilities (VAPID key gen, password hashing)
```

## Camera Tips

- **Hikvision**: Disable H.264+/Smart Codec in camera settings — it strips keyframes and breaks live streaming. Use standard H.264.
- **I-frame interval**: Set equal to FPS (e.g., 15 for 15fps) for fast MSE startup.
- **Sub streams**: Use a sub stream (e.g., 640x480) for detection and the main stream for recording to reduce CPU load.
- **Passwords**: Hikvision silently truncates passwords to 16 characters.

## License

MIT
