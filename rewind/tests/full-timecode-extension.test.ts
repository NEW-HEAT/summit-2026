import { describe, expect, it } from "vitest";
import {
  FULL_TIMECODE_EXTENSION_CONTRACT,
  fullTimecodeExtensionFrame,
} from "../full-timecode-extension/contract";

describe("full Clip 02 timecode extension", () => {
  it("replaces the terminal Earth card while preserving the full 4.2-second addition", () => {
    expect(FULL_TIMECODE_EXTENSION_CONTRACT).toMatchObject({
      fps: 60,
      baseFrameCount: 1_854,
      transitionSourceFrameIndex: 1_832,
      baseHeadFrameCount: 1_833,
      replacedBaseTailFrameCount: 21,
      appendedFrameCount: 252,
      recapSegmentFrameCount: 273,
      totalFrameCount: 2_106,
      baseDurationSeconds: 30.9,
      appendedDurationSeconds: 4.2,
      recapSegmentDurationSeconds: 4.55,
      totalDurationSeconds: 35.1,
    });
    expect(
      FULL_TIMECODE_EXTENSION_CONTRACT.baseHeadFrameCount +
        FULL_TIMECODE_EXTENSION_CONTRACT.replacedBaseTailFrameCount
    ).toBe(FULL_TIMECODE_EXTENSION_CONTRACT.baseFrameCount);
    expect(
      FULL_TIMECODE_EXTENSION_CONTRACT.replacedBaseTailFrameCount +
        FULL_TIMECODE_EXTENSION_CONTRACT.appendedFrameCount
    ).toBe(FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount);
    expect(
      FULL_TIMECODE_EXTENSION_CONTRACT.baseHeadFrameCount +
        FULL_TIMECODE_EXTENSION_CONTRACT.recapSegmentFrameCount
    ).toBe(FULL_TIMECODE_EXTENSION_CONTRACT.totalFrameCount);
  });

  it("ends on the requested range with a recap label instead of a location", () => {
    expect(FULL_TIMECODE_EXTENSION_CONTRACT.finalDateLabel).toBe(
      "JAN 1, 2022–2023"
    );
    expect(FULL_TIMECODE_EXTENSION_CONTRACT.finalRecapLabel).toBe("YEAR RECAP");
    expect(FULL_TIMECODE_EXTENSION_CONTRACT).not.toHaveProperty(
      "finalLocationLabel"
    );
    expect(JSON.stringify(FULL_TIMECODE_EXTENSION_CONTRACT)).not.toContain(
      "EARTH"
    );
  });

  it("starts on the last clean Durham frame and settles smoothly into a hold", () => {
    expect(fullTimecodeExtensionFrame(0).easedTransitionProgress).toBe(0);
    expect(fullTimecodeExtensionFrame(71).easedTransitionProgress).toBe(1);
    expect(fullTimecodeExtensionFrame(272).easedTransitionProgress).toBe(1);
  });
});
