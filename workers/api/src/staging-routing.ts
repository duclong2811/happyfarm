/**
 * The one boundary between the static web app and the API in a deployed Worker.
 *
 * The repository's handler speaks paths without a prefix (`/farms`, `/health`), while the browser
 * calls the same origin it was served from (`API_BASE = "/api"`). Rather than rewrite every route,
 * a deployed Worker strips the prefix here, in one place, and everything else - the SPA shell, JS,
 * CSS, GLB models - is left to Cloudflare's static asset binding.
 *
 * Pure and dependency-free so the boundary can be asserted in a unit test instead of in production.
 */

export const API_PREFIX = "/api";

/**
 * The handler path for an API request, or null when the request is not for the API.
 *
 * `/api` alone maps to `/`, `/api/farms` to `/farms`, and a path that merely starts with the same
 * letters (`/apian/…`) is not an API request at all.
 */
export function apiPath(pathname: string): string | null {
  if (pathname === API_PREFIX) return "/";
  if (pathname.startsWith(`${API_PREFIX}/`)) {
    const stripped = pathname.slice(API_PREFIX.length);
    return stripped.length === 0 ? "/" : stripped;
  }
  return null;
}

export function isApiRequest(pathname: string): boolean {
  return apiPath(pathname) !== null;
}

/** The same request, addressed at the handler's own path space. */
export function rewriteToApiRequest(request: Request): Request {
  const url = new URL(request.url);
  const path = apiPath(url.pathname);
  if (path === null) return request;
  const target = new URL(url.href);
  target.pathname = path;
  return new Request(target, request);
}
