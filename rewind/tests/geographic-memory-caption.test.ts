import { describe, expect, it } from "vitest";
import {
  formatMemoryDateRange,
  formatMemorySingleDate,
  parseMapboxMemoryLocation,
} from "../scene/geographic-memory-caption";

describe("geographic memory captions", () => {
  it("formats compact inclusive date ranges", () => {
    expect(
      formatMemoryDateRange({
        targetMs: Date.parse("2025-03-07T00:00:00.000Z"),
        sourceMs: Date.parse("2025-03-11T00:00:00.000Z"),
      })
    ).toBe("MAR 07–11 2025");
    expect(
      formatMemoryDateRange({
        targetMs: Date.parse("2024-03-29T00:00:00.000Z"),
        sourceMs: Date.parse("2024-04-02T00:00:00.000Z"),
      })
    ).toBe("MAR 29–APR 02 2024");
    expect(formatMemorySingleDate(Date.parse("2023-01-01T00:00:00.000Z"))).toBe(
      "JAN 01 2023"
    );
  });

  it("builds City or Region, State, Country without duplicate levels", () => {
    const location = parseMapboxMemoryLocation({
      features: [
        {
          properties: {
            feature_type: "place",
            name: "Antigua Guatemala",
            context: {
              place: { name: "Antigua Guatemala" },
              region: { name: "Sacatepéquez" },
              country: { name: "Guatemala" },
            },
          },
        },
      ],
    });
    expect(location).toEqual({
      cityOrRegion: "Antigua Guatemala",
      state: "Sacatepéquez",
      country: "Guatemala",
      label: "Antigua Guatemala, Sacatepéquez, Guatemala",
    });
  });

  it("falls back to region and country when no city is available", () => {
    const location = parseMapboxMemoryLocation({
      features: [
        {
          properties: {
            feature_type: "region",
            name: "Montana",
            context: {
              region: { name: "Montana" },
              country: { name: "United States" },
            },
          },
        },
      ],
    });
    expect(location?.label).toBe("Montana, United States");
    expect(location?.state).toBeNull();
  });
});
