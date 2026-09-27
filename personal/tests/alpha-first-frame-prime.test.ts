import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transparent export first-frame priming", () => {
  it("renders frame zero before constructing the canvas encoder source", () => {
    const scene = readFileSync(new URL("../scene/vertical-scene.ts", import.meta.url), "utf8");
    const primeIndex = scene.indexOf("await setFrame(0);");
    const sourceIndex = scene.indexOf("const source = new CanvasSource(canvas");

    expect(primeIndex).toBeGreaterThan(-1);
    expect(sourceIndex).toBeGreaterThan(primeIndex);
    expect(scene).toContain("if (frameIndex > 0) await setFrame(frameIndex);");
  });

  it("encodes the movie before proof capture moves the canvas to recap frames", () => {
    const renderer = readFileSync(new URL("../render-vertical.mts", import.meta.url), "utf8");
    const normalizeIndex = renderer.indexOf("await normalizeAlphaMov(browserIntermediate, outputPath, frameCount);");
    const proofIndex = renderer.indexOf("const proof = await captureProofFrames");

    expect(normalizeIndex).toBeGreaterThan(-1);
    expect(proofIndex).toBeGreaterThan(normalizeIndex);
  });
});
