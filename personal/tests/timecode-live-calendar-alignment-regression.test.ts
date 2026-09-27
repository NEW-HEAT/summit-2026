import { describe, expect, it } from "vitest";
import {
  OPENING_DATE_RANGE_LABEL,
  contributionTimecodeFrame,
} from "../scene/geographic-memory-timecode";
import type { ContributionFocusBeat } from "../scene/globe-focus-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";

describe("opening range to live calendar alignment regression", () => {
  it("uses the range only in pre-roll and shares the globe calendar day clock", () => {
    const beats = Array.from({ length: 32 }, (_, sectionIndex) =>
      beat(sectionIndex),
    );
    const progress = organizationProgress(1_338);

    const opening = contributionTimecodeFrame(0, beats, progress);
    const openingMotion = contributionTimecodeFrame(1, beats, progress);
    const lastPreRollFrame = contributionTimecodeFrame(59, beats, progress);
    const traversalStart = contributionTimecodeFrame(60, beats, progress);

    expect(opening.reel).toEqual({
      outgoing: OPENING_DATE_RANGE_LABEL,
      incoming: "JAN 01 2023",
      progress: 0,
    });
    expect(openingMotion.reel.outgoing).toBe(OPENING_DATE_RANGE_LABEL);
    expect(openingMotion.reel.progress).toBeGreaterThan(0);
    expect(lastPreRollFrame.reel.outgoing).toBe(OPENING_DATE_RANGE_LABEL);
    expect(lastPreRollFrame.reel.progress).toBeLessThan(1);
    expect(traversalStart).toMatchObject({
      currentDate: "2023-01-01",
      dateTransitionMode: "opening-range-to-live-calendar",
      reel: {
        outgoing: "JAN 01 2023",
        incoming: "JAN 01 2023",
        progress: 0,
      },
    });

    const alignedDates = new Map([
      [480, "2023-06-06"],
      [1_140, "2024-02-06"],
      [2_040, "2025-01-05"],
      [2_760, "2025-09-30"],
      [3_719, "2026-08-30"],
    ]);
    for (const [frameIndex, expectedDate] of alignedDates) {
      const frame = contributionTimecodeFrame(frameIndex, beats, progress);
      expect(frame.currentDate).toBe(expectedDate);
      const liveLabel = formatLiveDate(expectedDate);
      expect(frame.reel).toEqual({
        outgoing: liveLabel,
        incoming: liveLabel,
        progress: 0,
      });
    }
  });
});

function formatLiveDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const monthLabel = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ][month - 1];
  return `${monthLabel} ${String(day).padStart(2, "0")} ${year}`;
}

function organizationProgress(dayCount: number): OrganizationProgressDay[] {
  return Array.from({ length: dayCount }, (_, dayOrdinal) => ({
    date: dateAtOrdinal(dayOrdinal),
    dayOrdinal,
    cumulativeContributions: {
      "new-heat": dayOrdinal,
      "agriculture-intelligence": 0,
      visualpt: 0,
      visgl: 0,
      misc: 0,
    },
  }));
}

function beat(sectionIndex: number): ContributionFocusBeat {
  const startDayOrdinal = sectionIndex * 42;
  const endDayOrdinal = startDayOrdinal + 41;
  return {
    sectionIndex,
    startDayOrdinal,
    endDayOrdinal,
    startDate: dateAtOrdinal(startDayOrdinal),
    endDate: dateAtOrdinal(endDayOrdinal),
    longitude: -80,
    latitude: 26,
    volume: 1,
    cellId: "-80:26",
    organizationKey: "new-heat",
    organizationColor: [248, 81, 73],
    organizationIndex: 0,
    source: "section-dominant-contribution-cell",
    locationPrimary: "Focus",
    locationSecondary: "Area",
    locationEvidence: "nearest-curated-memory-zone",
  };
}

function dateAtOrdinal(ordinal: number) {
  const date = new Date("2023-01-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + ordinal);
  return date.toISOString().slice(0, 10);
}
