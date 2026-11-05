const LOCAL_APP_ORIGIN = "http://localhost:3000";

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function getAppOrigin(request?: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const configuredOrigin = configured ? normalizeOrigin(configured) : null;
  if (configuredOrigin) return configuredOrigin;

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    const vercelOrigin = normalizeOrigin(vercelHost.startsWith("http") ? vercelHost : `https://${vercelHost}`);
    if (vercelOrigin) return vercelOrigin;
  }

  if (request) return new URL(request.url).origin;
  return LOCAL_APP_ORIGIN;
}

export function getGoogleCalendarRedirectUri(request?: Request): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return new URL("/api/google-calendar/callback", getAppOrigin(request)).toString();
}

export function getLineLoginRedirectUri(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const configuredOrigin = configured ? normalizeOrigin(configured) : null;
  if (!configuredOrigin) {
    throw new Error("NEXT_PUBLIC_APP_URL is required for LINE Login");
  }
  return new URL("/api/line/login/callback", configuredOrigin).toString();
}
