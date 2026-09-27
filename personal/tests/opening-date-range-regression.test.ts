import { describe, expect, it } from "vitest";
import {
  OPENING_DATE_RANGE_LABEL,
  contributionTimecodeFrame,
  rangeToCurrentDateReel,
} from "../scene/geographic-memory-timecode";
import type { ContributionFocusBeat } from "../scene/globe-focus-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";

describe("opening contribution date range regression", () => {
  it("starts the full personal journey at JAN 01 2022–2023 before resolving live", () => {
    const beats = Array.from({ length: 32 }, (_, sectionIndex) =>
      beat(sectionIndex),
    );
    const progress = Array.from(
      { length: 1_338 },
      (_, dayOrdinal): OrganizationProgressDay => ({
        date: dateAtOrdinal(dayOrdinal),
        dayOrdinal,
        cumulativeContributions: {
          "new-heat": dayOrdinal,
          "agriculture-intelligence": 0,
          visualpt: 0,
          visgl: 0,
          misc: 0,
        },
      }),
    );

    const opening = contributionTimecodeFrame(0, beats, progress);
    expect(OPENING_DATE_RANGE_LABEL).toBe("JAN 01 2022–2023");
    expect(opening.reel).toEqual({
      outgoing: OPENING_DATE_RANGE_LABEL,
      incoming: "JAN 01 2023",
      progress: 0,
    });

    const live = rangeToCurrentDateReel(
      beats[0],
      "2023-01-12",
      "2023-01-13",
      0.25,
      0.5,
      OPENING_DATE_RANGE_LABEL,
    );
    expect(live).toEqual({
      outgoing: "JAN 12 2023",
      incoming: "JAN 13 2023",
      progress: 0.103515625,
    });
  });
});

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
