import { describe, expect, it } from "vitest";
import {
  ORGANIZATION_GROUPS,
  buildOrganizationSlices,
  organizationKeyForRepository,
} from "../scene/calendar-model";

describe("corrected personal contribution categories", () => {
  it("promotes the user-selected repositories and owners into their organizations", () => {
    expect(organizationKeyForRepository("charlieforward9/ATHLEAT")).toBe("new-heat");
    expect(organizationKeyForRepository("aws-amplify/amplify-js")).toBe("agriculture-intelligence");
    expect(organizationKeyForRepository("joby-aviation/noodles.gl")).toBe("visgl");
    expect(organizationKeyForRepository("robertleeplummerjr/Leaflet.glify")).toBe("visgl");
    expect(organizationKeyForRepository("yuzhva/react-leaflet-markercluster")).toBe("visgl");
    expect(organizationKeyForRepository("mapbox/shp-write")).toBe("visgl");
  });

  it("uses charlieforward9 as the visible personal and open-source fallback lane", () => {
    expect(ORGANIZATION_GROUPS.find((group) => group.key === "misc")?.label).toBe("charlieforward9");
    expect(organizationKeyForRepository("charlieforward9/quickies")).toBe("misc");
    expect(organizationKeyForRepository("openjs-foundation/nodejs.org")).toBe("misc");
  });

  it("applies the corrected mapping before adding profile-only remainder", () => {
    const projects = [
      ["charlieforward9/ATHLEAT", 2],
      ["aws-amplify/amplify-js", 3],
      ["joby-aviation/noodles.gl", 4],
      ["robertleeplummerjr/Leaflet.glify", 5],
      ["yuzhva/react-leaflet-markercluster", 6],
      ["mapbox/shp-write", 7],
      ["charlieforward9/quickies", 8],
    ] as const;
    const slices = buildOrganizationSlices({
      date: "2026-08-30",
      count: 44,
      level: 4,
      attributedCount: 35,
      unattributedCount: 9,
      projects: projects.map(([repository, count]) => ({
        repository,
        visibility: "public",
        count,
        commits: count,
        pullRequests: 0,
        issues: 0,
        reviews: 0,
      })),
    });
    expect(slices.map(({ key, count }) => [key, count])).toEqual([
      ["new-heat", 2],
      ["agriculture-intelligence", 3],
      ["visgl", 22],
      ["misc", 17],
    ]);
  });
});
