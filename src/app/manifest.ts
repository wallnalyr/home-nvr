import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Camera Monitor",
    short_name: "Cameras",
    description: "Home camera monitoring NVR",
    start_url: "/",
    display: "standalone",
    background_color: "#F2F2F7",
    theme_color: "#007AFF",
    orientation: "any",
    categories: ["utilities", "security"],
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
