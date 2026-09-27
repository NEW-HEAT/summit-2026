import { describe, expect, it } from "vitest";
import {
  RANGE_HOLD_FRACTION,
  RANGE_TO_CURRENT_DATE_END_FRACTION,
  contributionTimecodeFrame,
  rangeToCurrentDateReel,
} from "../scene/geographic-memory-timecode";
import type { ContributionFocusBeat } from "../scene/globe-focus-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";

describe("section range to live current-date timecode regression", () => {
  it("holds the section range, rolls into the current date, then follows daily progress", () => {
    const focus = beat(0, "2023-01-01", "2023-02-11");
    const held = rangeToCurrentDateReel(focus, "2023-01-10", "2023-01-11", 0.5, 0);
    const transitioning = rangeToCurrentDateReel(
      focus,
      "2023-01-10",
      "2023-01-11",
      0.5,
      0.2,
    );
    const live = rangeToCurrentDateReel(focus, "2023-01-10", "2023-01-11", 0.5, 0.5);

    expect(RANGE_HOLD_FRACTION).toBe(0.08);
    expect(RANGE_TO_CURRENT_DATE_END_FRACTION).toBe(0.34);
    expect(held).toEqual({
      outgoing: "JAN 01–FEB 11 2023",
      incoming: "JAN 10 2023",
      progress: 0,
    });
    expect(transitioning.outgoing).toBe("JAN 01–FEB 11 2023");
    expect(transitioning.incoming).toBe("JAN 10 2023");
    expect(transitioning.progress).toBeGreaterThan(0);
    expect(transitioning.progress).toBeLessThan(1);
    expect(live).toEqual({
      outgoing: "JAN 10 2023",
      incoming: "JAN 11 2023",
      progress: 0.5,
    });
  });

  it("matches the one-second pre-roll and 60-second live-date traversal", () => {
    const beats = Array.from({ length: 32 }, (_, index) => beat(
      index,
      dateAtOrdinal(index * 2),
      dateAtOrdinal(index * 2 + 1),
    ));
    const progress = Array.from({ length: 64 }, (_, index): OrganizationProgressDay => ({
      date: dateAtOrdinal(index),
      dayOrdinal: index,
      cumulativeContributions: {
        "new-heat": index,
        "agriculture-intelligence": 0,
        visualpt: 0,
        visgl: 0,
        misc: 0,
      },
    }));

    const preRoll = contributionTimecodeFrame(0, beats, progress);
    const traversalStart = contributionTimecodeFrame(60, beats, progress);
    const end = contributionTimecodeFrame(3_719, beats, progress);

    expect(preRoll.currentDate).toBe("2023-01-01");
    expect(preRoll.reel.outgoing).toBe("JAN 01–02 2023");
    expect(traversalStart.sectionIndex).toBe(0);
    expect(traversalStart.dateTransitionMode).toBe("section-range-to-live-date");
    expect(end.sectionIndex).toBe(31);
    expect(end.currentDate).toBe("2023-03-05");
    expect(end.reel.outgoing).toBe("MAR 05 2023");
  });
});

function beat(
  sectionIndex: number,
  startDate: string,
  endDate: string,
): ContributionFocusBeat {
  return {
    sectionIndex,
    startDayOrdinal: sectionIndex * 2,
    endDayOrdinal: sectionIndex * 2 + 1,
    startDate,
    endDate,
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
