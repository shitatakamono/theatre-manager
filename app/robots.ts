import type { MetadataRoute } from "next";
import { getAppOrigin } from "@/lib/app-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy", "/terms"],
      disallow: ["/api/", "/categories", "/projects", "/settings"],
    },
    sitemap: `${getAppOrigin()}/sitemap.xml`,
  };
}
