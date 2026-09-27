import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GEOGRAPHIC_MEMORY_TIMECODE_STYLE,
  contributionTimecodeFrame,
  forwardAnalogGlyphMotion,
  organizationLegendDisplayLabel,
} from "../scene/geographic-memory-timecode";
import type { ContributionFocusBeat } from "../scene/globe-focus-model";
import type { OrganizationProgressDay } from "../scene/organization-share-model";

describe("geographic-memory contribution timecode", () => {
  it("keeps the established reel and promotes cumulative organization progress", () => {
    expect(GEOGRAPHIC_MEMORY_TIMECODE_STYLE).toMatchObject({
      dateCellWidth: 39,
      dateCellHeight: 84,
      dateCenterY: -112,
      dateFont: '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      organizationColumnWidth: 420,
      organizationRuleWidth: 148,
      organizationLabelY: -10,
      organizationCountY: 52,
      organizationCountFont: '750 56px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
    });
    expect(organizationLegendDisplayLabel(
      "agriculture-intelligence",
      "Agriculture-Intelligence",
    )).toBe("AGINTEL");
    const source = readFileSync(new URL("../scene/geographic-memory-timecode.ts", import.meta.url), "utf8");
    expect(source).toContain("frame.cumulativeContributions[share.key]");
    expect(source).not.toContain("share.activeDayPercent");
    expect(source).not.toContain("share.contributionPercent");
    expect(source).not.toContain("organizationMetricFont");
    expect(source).not.toContain("drawMemoryLocation");
  });

  it("moves the reel forward in time and stays synchronized to the 32 sections", () => {
    const motion = forwardAnalogGlyphMotion(0.25, 84);
    expect(motion.outgoingOffsetY).toBe(-21);
    expect(motion.incomingOffsetY).toBe(63);

    const beats = Array.from({ length: 32 }, (_, sectionIndex) => beat(sectionIndex));
    const progress = organizationProgress();
    expect(contributionTimecodeFrame(0, beats, progress)).toMatchObject({
      sectionIndex: 0,
      cumulativeContributions: {},
    });
    expect(contributionTimecodeFrame(58 * 60 - 1, beats).sectionIndex).toBe(31);
    expect(contributionTimecodeFrame(58 * 60, beats, progress)).toMatchObject({
      sectionIndex: 31,
      cumulativeContributions: {
        "new-heat": 40,
        visgl: 10,
      },
    });
  });
});

function organizationProgress(): OrganizationProgressDay[] {
  return [
    {
      date: "2023-01-01",
      dayOrdinal: 0,
      cumulativeContributions: {
        "new-heat": 30,
        "agriculture-intelligence": 0,
        visualpt: 0,
        visgl: 10,
        misc: 0,
      },
    },
    {
      date: "2023-01-02",
      dayOrdinal: 1,
      cumulativeContributions: {
        "new-heat": 40,
        "agriculture-intelligence": 0,
        visualpt: 0,
        visgl: 10,
        misc: 0,
      },
    },
  ];
}

function beat(sectionIndex: number): ContributionFocusBeat {
  const day = String(sectionIndex + 1).padStart(2, "0");
  return {
    sectionIndex,
    startDayOrdinal: sectionIndex,
    endDayOrdinal: sectionIndex,
    startDate: `2023-01-${day}`,
    endDate: `2023-01-${day}`,
    longitude: -80,
    latitude: 26,
    volume: 1,
    cellId: "-80:26",
    organizationKey: "new-heat",
    organizationColor: [248, 81, 73],
    organizationIndex: 0,
    source: "section-dominant-contribution-cell",
    locationPrimary: "Boynton Beach",
    locationSecondary: "Florida · United States",
    locationEvidence: "nearest-curated-memory-zone",
  };
}
