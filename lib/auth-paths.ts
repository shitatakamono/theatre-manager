const PUBLIC_APP_PATHS = new Set(["/", "/privacy", "/terms", "/line/auth/complete"]);

export function isPublicAppPath(pathname: string): boolean {
  if (PUBLIC_APP_PATHS.has(pathname)) return true;
  return /^\/s\/rehearsals\/[^/]+$/.test(pathname);
}
