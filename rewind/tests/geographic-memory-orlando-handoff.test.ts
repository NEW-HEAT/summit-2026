import { describe, expect, it } from "vitest";
import {
  CLIP_CONTRACT,
  buildHandoffManifest,
  frameState,
} from "../scene/clip-contract";

describe("Orlando Clip 03 handoff", () => {
  it("preserves the Zürich opening while holding Orlando for the final six frames", () => {
    expect(frameState(0).viewState).toEqual({
      longitude: 8.5417,
      latitude: 47.3769,
      zoom: 2.4858036230728944,
      pitch: 0,
      bearing: 0,
    });

    for (
      let frame = CLIP_CONTRACT.handoffFrame;
      frame < CLIP_CONTRACT.frameCount;
      frame += 1
    ) {
      expect(frameState(frame)).toMatchObject({
        calendarIso: "2023-01-01",
        stableHandoff: true,
        viewState: {
          longitude: -81.379234,
          latitude: 28.538336,
          zoom: 2.861318270370575,
          pitch: 0,
          bearing: 0,
        },
      });
    }
  });

  it("exports the editorial Orlando anchor and exact camera pose", () => {
    expect(buildHandoffManifest()).toMatchObject({
      date: "2023-01-01",
      location: "Orlando, Florida, United States",
      anchorAuthority: "editorial-city-center",
      scaleAuthority: "match-source-hero-screen-radius",
      camera: {
        longitude: -81.379234,
        latitude: 28.538336,
        zoom: 2.861318270370575,
        pitch: 0,
        bearing: 0,
      },
    });
  });
});
