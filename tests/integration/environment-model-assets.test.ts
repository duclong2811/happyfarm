import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MODELS = ["tree", "pine", "bush", "rock", "flower"] as const;

describe("Kenney environment model assets", () => {
  it.each(MODELS)("ships %s as a valid binary glTF file", (name) => {
    const file = readFileSync(
      resolve(process.cwd(), "apps", "web", "src", "assets", "models", "kenney-nature", `${name}.glb`)
    );
    expect(file.byteLength).toBeGreaterThan(1000);
    expect(String.fromCharCode(...file.subarray(0, 4))).toBe("glTF");
    const header = new DataView(file.buffer, file.byteOffset, file.byteLength);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe(file.byteLength);
  });

  it("records the source and CC0 license", () => {
    const register = readFileSync(resolve(process.cwd(), "docs", "ASSET_LICENSES.md"), "utf8");
    expect(register).toContain("https://kenney.nl/assets/nature-kit");
    expect(register).toContain("Creative Commons Zero 1.0 (CC0)");
    for (const name of MODELS) expect(register).toContain(`kenney-nature/${name}.glb`);
  });
});
