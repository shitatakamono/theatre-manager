import type { MetadataRoute } from "next";
import { getAppOrigin } from "@/lib/app-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.4 },
  ];
}
