import { describe, expect, it } from "vitest";
import { createHostCache, isServerSourceChange } from "../../apps/web/dev-api-host-cache";

/**
 * The dev API host must not outlive the code it was built from.
 *
 * `createDevApiHost` captures the routes and payload schemas when it is created, so a host memoized
 * for the whole dev-server session keeps answering with the pre-edit contract while the browser has
 * already reloaded with the new client. That is the V14.5.1C `invalid_union` and the V14.5.2A
 * first-use-plant `INVALID_INPUT`. These cases pin the reload rule and the safe retire.
 */

class FakeHost {
  closed = false;
  close(): void {
    this.closed = true;
  }
}

function cacheWith(hosts: FakeHost[]) {
  let created = 0;
  return {
    cache: createHostCache<FakeHost>(() => {
      const host = new FakeHost();
      hosts.push(host);
      created += 1;
      return Promise.resolve(host);
    }),
    creations: () => created
  };
}

describe("the dev API host cache", () => {
  it("builds the host once and reuses it", async () => {
    const hosts: FakeHost[] = [];
    const { cache, creations } = cacheWith(hosts);
    const first = await cache.get();
    const second = await cache.get();
    expect(first).toBe(second);
    expect(creations()).toBe(1);
  });

  it("rebuilds after an invalidation, and closes the retired generation when idle", async () => {
    const hosts: FakeHost[] = [];
    const { cache, creations } = cacheWith(hosts);
    const first = await cache.get();
    cache.invalidate();
    // The retire resolves asynchronously; flush a microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(first.closed).toBe(true);
    const second = await cache.get();
    expect(second).not.toBe(first);
    expect(creations()).toBe(2);
  });

  it("does not close a retired generation while a request is in flight", async () => {
    const hosts: FakeHost[] = [];
    const { cache } = cacheWith(hosts);
    const first = await cache.get();
    cache.begin();
    cache.invalidate();
    await Promise.resolve();
    await Promise.resolve();
    // The in-flight request is still using the old host, so its database stays open.
    expect(first.closed).toBe(false);
    expect(cache.retiredCount()).toBe(1);
    cache.end();
    expect(first.closed).toBe(true);
    expect(cache.retiredCount()).toBe(0);
  });

  it("recognises the sources the host is built from", () => {
    const roots = ["C:\\repo\\workers", "C:\\repo\\packages", "C:\\repo\\database"];
    expect(isServerSourceChange("C:\\repo\\workers\\api\\src\\handler.ts", roots)).toBe(true);
    expect(isServerSourceChange("C:\\repo\\packages\\contracts\\src\\index.ts", roots)).toBe(true);
    expect(isServerSourceChange("C:\\repo\\database\\migrations\\0002_crop_simulation.sql", roots)).toBe(true);
    // A client-only edit or a non-source file does not rebuild the API.
    expect(isServerSourceChange("C:\\repo\\apps\\web\\src\\main.ts", roots)).toBe(false);
    expect(isServerSourceChange("C:\\repo\\workers\\api\\src\\handler.test.ts.md", roots)).toBe(false);
    expect(isServerSourceChange("C:\\repo\\packages\\package.json", roots)).toBe(false);
  });
});
