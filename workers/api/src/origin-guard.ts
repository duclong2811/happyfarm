/**
 * The one origin check every unsafe request passes through.
 *
 * Guest sessions are carried by a cookie, and a cookie is sent by the browser on any request whose
 * site policy allows it. `SameSite=Lax` stops a cross-site POST from carrying the credential, and
 * this check is the belt to that pair of braces: a browser that tells us the request came from
 * another origin is refused before any identity is resolved, so a mutation can only ever be driven
 * by a page on this very origin.
 *
 * The rule is deliberately about the *request*, not about cookies: it never names a provider, so it
 * protects the Access path and any future cookie-borne identity with the same line of code.
 *
 * A request with no `Origin` header is allowed. Browsers that make a cross-origin unsafe request
 * always send one, so its absence means a non-browser client (curl, a smoke test, server-to-server),
 * which cannot be protected by this rule and is not the threat a CSRF check exists for.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function rejectsCrossOriginRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin !== new URL(request.url).origin;
}
