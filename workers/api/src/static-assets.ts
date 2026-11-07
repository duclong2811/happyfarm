/** Hashed Vite assets are content-addressed and safe for a year-long browser cache. */
const IMMUTABLE_ASSET_PATH = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/u;

export function isImmutableAssetPath(pathname: string): boolean {
  return IMMUTABLE_ASSET_PATH.test(pathname);
}

/** Applies browser caching only to a successful, hashed static asset response. */
export function withStaticAssetCache(request: Request, response: Response): Response {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (!isImmutableAssetPath(new URL(request.url).pathname) || !response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
