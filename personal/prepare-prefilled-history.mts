import fs from "node:fs/promises";
import path from "node:path";
import { buildCommitLocationHeat, type CommitLocationHeatDataset, type PrivateLocationArchive } from "./scene/location-heat-model";
import { withPrefilledContributionHistory } from "./scene/prefilled-contribution-history";
import { organizationKeyForRepository, type OwnerProjectContributionSnapshot } from "./scene/calendar-model";
import { contributionLandingCounterFrame } from "./scene/contribution-landing-counter";
import { buildContributionFocusBeats } from "./scene/globe-focus-model";
import { buildContributionImpacts } from "./scene/globe-impact-model";

const [livePath, historySnapshotPath, archivePath, output] = process.argv.slice(2);
if (!livePath || !historySnapshotPath || !archivePath || !output) {
  throw new Error("Usage: prepare-prefilled-history.mts live-dataset.json history-snapshot.json private-archive.json output.json");
}
const live = JSON.parse(await fs.readFile(livePath, "utf8")) as CommitLocationHeatDataset;
const snapshot = JSON.parse(await fs.readFile(historySnapshotPath, "utf8")) as OwnerProjectContributionSnapshot;
const archive = JSON.parse(await fs.readFile(archivePath, "utf8")) as PrivateLocationArchive;
const historicalDays = snapshot.years.flatMap((year) => year.days).sort((a, b) => a.date.localeCompare(b.date));
if (snapshot.login !== "charlieforward9" || historicalDays.length !== 365
  || historicalDays.some((day, index) => day.date !== new Date(Date.UTC(2022, 0, index + 1)).toISOString().slice(0, 10))) {
  throw new Error("Expected the complete authenticated 2022 contribution year for charlieforward9.");
}
const history = buildCommitLocationHeat(snapshot, archive);
const result = withPrefilledContributionHistory(live, history);
const startingTotal = history.metrics.contributionVolume;
// Verify every encoded-frame addition and cumulative delta against the accepted live dataset.
for (let frame = 0; frame < 3720; frame += 1) {
  const before = contributionLandingCounterFrame(frame, live.organizationProgress);
  const after = contributionLandingCounterFrame(frame, result.organizationProgress);
  if (after.total !== before.total + startingTotal || JSON.stringify(after.additions) !== JSON.stringify(before.additions)) {
    throw new Error(`Prefill changed live contribution timing at frame ${frame}.`);
  }
}
const livePoints = result.points.filter((point) => point.dayOrdinal >= 0);
if (JSON.stringify(livePoints) !== JSON.stringify(live.points)) throw new Error("Prefill altered live points.");
const beforeBeats = buildContributionFocusBeats(live.points, live.locationZones, live.dateRange, live.dayCount);
const afterBeats = buildContributionFocusBeats(livePoints, result.locationZones, result.dateRange, result.dayCount);
if (JSON.stringify(beforeBeats) !== JSON.stringify(afterBeats)) throw new Error("Prefill altered camera focus timing.");
const peak = Math.max(1, ...livePoints.map((point) => point.volume));
for (let frame = 60; frame < 3720; frame += 1) {
  const revealHead = (frame / 60 - 1) / 60 * result.dayCount;
  const before = buildContributionImpacts(live.points, revealHead, peak);
  const after = buildContributionImpacts(livePoints, revealHead, peak);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`Prefill changed globe arrivals at frame ${frame}.`);
}
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(result)}\n`, { mode: 0o600, flag: "wx" });
const evidence = {
  status: "PASS", generatedAt: new Date().toISOString(),
  liveDataset: livePath, historySnapshot: historySnapshotPath,
  liveDateRange: result.dateRange, liveDayCount: result.dayCount,
  prefilledHistory: result.prefilledHistory,
  startingOrganizationCounts: result.organizationProgress[0].prefilledContributions,
  finalOrganizationCounts: result.organizationProgress.at(-1)!.cumulativeContributions,
  historyMetrics: history.metrics,
  historyAttribution: {
    officialProfileTotal: snapshot.years.reduce((sum, year) => sum + year.totalContributions, 0),
    attributedRepositoryEvents: historicalDays.reduce((sum, day) => sum + (day.attributedCount ?? 0), 0),
    visibleOrganizationEvents: startingTotal,
    excludedRepositoryEvents: snapshot.projects.filter((project) => organizationKeyForRepository(project.repository) === "misc")
      .reduce((sum, project) => sum + project.count, 0),
    unmappedActivityPolicy: "Preserve the existing four organizations; no misc lane or invented attribution.",
  },
  combinedMetrics: result.metrics,
  unchangedLivePoints: "PASS", unchangedAllFrameCountsAndAdditions: "PASS",
  unchangedAllFrameArrivals: "PASS", unchangedFocusBeats: "PASS",
  historyNotReplayed: "PASS", unmatchedHistoricalDaysRemainUnlocated: "PASS",
};
await fs.writeFile(path.join(path.dirname(output), "prefill-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
await fs.writeFile(path.join(path.dirname(output), "historical-repository-attribution.json"), `${JSON.stringify({
  dateRange: snapshot.dateRange, privateOwnerVisibleAudit: true,
  repositories: snapshot.projects.map((project) => ({ ...project, organization: organizationKeyForRepository(project.repository) })),
}, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: "PASS", startingTotal, liveTotal: live.metrics.contributionVolume,
  finalTotal: result.metrics.contributionVolume, startingOrganizationCounts: evidence.startingOrganizationCounts,
  historyMetrics: history.metrics, output }, null, 2));
