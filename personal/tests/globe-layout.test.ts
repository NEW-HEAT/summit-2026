import { describe, expect, it } from "vitest";
import {
  HEIGHT,
  WIDTH,
} from "../scene/calendar-model";
import { CONTRIBUTION_GLOBE_LAYOUT } from "../scene/globe-layout";
import { CLIP_02_ORLANDO_HANDOFF_VIEW_STATE } from "../scene/globe-camera-model";

describe("contribution globe composition", () => {
  it("centers the locked 996px intro globe in the full transparent export frame", () => {
    expect(CONTRIBUTION_GLOBE_LAYOUT).toMatchObject({
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      zoom: CLIP_02_ORLANDO_HANDOFF_VIEW_STATE.zoom,
      targetGlobeHeightRatio: 996 / HEIGHT,
    });
    expect(CONTRIBUTION_GLOBE_LAYOUT.x + CONTRIBUTION_GLOBE_LAYOUT.width / 2).toBe(WIDTH / 2);
    expect(CONTRIBUTION_GLOBE_LAYOUT.y + CONTRIBUTION_GLOBE_LAYOUT.height / 2).toBe(HEIGHT / 2);
  });
});
