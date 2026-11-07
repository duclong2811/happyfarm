import { describe, expect, it } from "vitest";
import { isImmutableAssetPath, withStaticAssetCache } from "../../workers/api/src/static-assets";

describe("static asset cache policy", () => {
  it("recognizes only hashed assets", () => {
    expect(isImmutableAssetPath("/assets/index-W_VfKi96.js")).toBe(true);
    expect(isImmutableAssetPath("/assets/player-farmer-w59lVvob.glb")).toBe(true);
    expect(isImmutableAssetPath("/index.html")).toBe(false);
    expect(isImmutableAssetPath("/api/health")).toBe(false);
    expect(isImmutableAssetPath("/assets/player-farmer.glb")).toBe(false);
  });

  it("sets a long immutable browser cache only for successful hashed assets", async () => {
    const response = new Response("asset", { headers: { "Content-Type": "model/gltf-binary" } });
    const cached = withStaticAssetCache(new Request("https://staging.test/assets/player-farmer-w59lVvob.glb"), response);
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(cached.headers.get("Content-Type")).toBe("model/gltf-binary");
    await expect(cached.text()).resolves.toBe("asset");
  });

  it("leaves the shell, API-shaped paths, and errors uncached by this rule", () => {
    const response = new Response("nope", { status: 404 });
    for (const pathname of ["/index.html", "/api/health", "/assets/missing-AbCd1234.glb"]) {
      const result = withStaticAssetCache(new Request(`https://staging.test${pathname}`), response.clone());
      expect(result.headers.get("Cache-Control")).toBeNull();
    }
  });
});
