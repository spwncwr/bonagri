import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BonAgri",
    short_name: "BonAgri",
    description: "Agricultural marketplace connecting farmers, suppliers and buyers.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ea",
    theme_color: "#1f5d3a",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
