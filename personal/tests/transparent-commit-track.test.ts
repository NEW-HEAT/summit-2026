import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transparent commit-track master", () => {
  it("keeps the HTML, deck.gl canvas, browser encoder, and final MOV alpha-capable", () => {
    const html = readFileSync(new URL("../scene/vertical-index.html", import.meta.url), "utf8");
    const scene = readFileSync(new URL("../scene/vertical-scene.ts", import.meta.url), "utf8");
    const renderer = readFileSync(new URL("../render-vertical.mts", import.meta.url), "utf8");

    expect(html).toMatch(/html, body[^{]*\{[^}]*background: transparent/);
    expect(html).toMatch(/\.stage[^{]*\{[^}]*background: transparent/);
    expect(scene).toContain("clearColor: [0, 0, 0, 0]");
    expect(scene).toMatch(/webgl:\s*\{[\s\S]*?alpha: true/);
    expect(scene).toContain("new WebMOutputFormat()");
    expect(scene).toContain('codec: "vp9"');
    expect(scene).toContain('alpha: "keep"');
    expect(renderer).toContain("Background output must be .mov.");
    expect(renderer).toContain("normalizeAlphaMov(browserIntermediate, outputPath, frameCount)");
    expect(renderer).toContain("alphaProbe(options.output)");
    expect(renderer).not.toContain("function validBackground(");
  });
});
