import { sep } from "node:path";

/**
 * The development API host, kept for one generation and retired when the server source changes.
 *
 * `createDevApiHost` captures the routes and the payload schemas at the moment it is created, so a
 * host memoized for the life of the dev server keeps answering with the code from before an edit:
 * the browser reloads with the new client while the API still speaks the old contract. That is the
 * "stale worker" failure behind both the V14.5.1C `invalid_union` and the V14.5.2A first-use plant
 * (`INVALID_INPUT`, because the running host still required a field the new client had stopped
 * sending).
 *
 * This cache exists so a server-side edit rebuilds the host instead of serving the old one. It also
 * closes a retired generation only once no request is in flight, so a poll that is mid-answer is
 * never left talking to a database handle that was closed underneath it.
 *
 * Node-side tooling only: it is imported by `vite.config.ts` and never reaches the browser bundle.
 */

export interface ClosableHost {
  close(): void;
}

export interface HostCache<H extends ClosableHost> {
  /** The current generation, built on first use. */
  get(): Promise<H>;
  /** Drop the current generation: the next `get()` builds a fresh host from the edited source. */
  invalidate(): void;
  /** Mark the start of a request that will use the host. */
  begin(): void;
  /** Mark the end of that request, closing any retired generation when nothing is in flight. */
  end(): void;
  /** How many retired generations are waiting to be closed. For tests. */
  retiredCount(): number;
}

export function createHostCache<H extends ClosableHost>(create: () => Promise<H>): HostCache<H> {
  let current: Promise<H> | null = null;
  let inFlight = 0;
  const retired: H[] = [];

  const flush = (): void => {
    if (inFlight > 0) return;
    for (const host of retired.splice(0)) host.close();
  };

  return {
    get(): Promise<H> {
      current ??= create();
      return current;
    },
    invalidate(): void {
      const stale = current;
      current = null;
      if (stale === null) return;
      void stale
        .then((host) => {
          retired.push(host);
          flush();
        })
        .catch(() => {
          // A generation that never finished building has nothing to close.
        });
    },
    begin(): void {
      inFlight += 1;
    },
    end(): void {
      inFlight -= 1;
      if (inFlight <= 0) inFlight = 0;
      flush();
    },
    retiredCount(): number {
      return retired.length;
    }
  };
}

/**
 * Whether a watched file is part of the server the dev API host is built from.
 *
 * The routes, the domain rules and the game data all live outside `apps/web`, and the migrations are
 * part of the host's startup. A client-only edit does not rebuild the API.
 */
export function isServerSourceChange(file: string, roots: readonly string[]): boolean {
  if (!file.endsWith(".ts") && !file.endsWith(".sql")) return false;
  return roots.some((root) => file === root || file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`));
}
