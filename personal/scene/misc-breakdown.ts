import {
  ORGANIZATION_GROUPS,
  organizationKeyForRepository,
  type ContributionSnapshot,
} from "./calendar-model";

const GROUPED_OWNERS = new Set(
  ORGANIZATION_GROUPS.flatMap((group) => group.owner ? [group.owner.toLocaleLowerCase("en-US")] : []),
);

export type MiscBreakdown = {
  officialUnattributedCount: number;
  otherOwnerAttributedCount: number;
  displayedMiscCount: number;
  unattributedShare: number;
  owners: Array<{ owner: string; count: number; repositoryCount: number }>;
  repositories: Array<{ repository: string; visibility: "public" | "private"; count: number }>;
};

export type PersonalLaneBreakdown = {
  profileLogin: string;
  profileUnattributedCount: number;
  directPersonalRepositoryCount: number;
  outsideOwnerContributionCount: number;
  displayedPersonalLaneCount: number;
  excludedFromVisibleCount: number;
  directPersonalRepositories: Array<{ repository: string; visibility: "public" | "private"; count: number }>;
  outsideOwners: Array<{ owner: string; count: number; repositoryCount: number }>;
  outsideRepositories: Array<{ repository: string; visibility: "public" | "private"; count: number }>;
};

export function buildMiscBreakdown(snapshot: ContributionSnapshot): MiscBreakdown {
  const ownerTotals = new Map<string, { count: number; repositories: Set<string> }>();
  const repositoryTotals = new Map<string, { count: number; visibility: "public" | "private" }>();
  let officialUnattributedCount = 0;

  for (const year of snapshot.years) {
    for (const day of year.days) {
      officialUnattributedCount += day.unattributedCount ?? 0;
      for (const project of day.projects ?? []) {
        const owner = project.repository.split("/", 1)[0];
        if (GROUPED_OWNERS.has(owner.toLocaleLowerCase("en-US"))) continue;
        const ownerTotal = ownerTotals.get(owner) ?? { count: 0, repositories: new Set<string>() };
        ownerTotal.count += project.count;
        ownerTotal.repositories.add(project.repository);
        ownerTotals.set(owner, ownerTotal);
        const repositoryTotal = repositoryTotals.get(project.repository) ?? { count: 0, visibility: project.visibility };
        repositoryTotal.count += project.count;
        repositoryTotals.set(project.repository, repositoryTotal);
      }
    }
  }

  const owners = [...ownerTotals.entries()]
    .map(([owner, total]) => ({ owner, count: total.count, repositoryCount: total.repositories.size }))
    .sort((left, right) => right.count - left.count || left.owner.localeCompare(right.owner));
  const repositories = [...repositoryTotals.entries()]
    .map(([repository, total]) => ({ repository, visibility: total.visibility, count: total.count }))
    .sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository));
  const otherOwnerAttributedCount = owners.reduce((sum, owner) => sum + owner.count, 0);
  const displayedMiscCount = officialUnattributedCount + otherOwnerAttributedCount;
  return {
    officialUnattributedCount,
    otherOwnerAttributedCount,
    displayedMiscCount,
    unattributedShare: displayedMiscCount === 0 ? 0 : officialUnattributedCount / displayedMiscCount,
    owners,
    repositories,
  };
}

export function renderMiscBreakdownMarkdown(breakdown: MiscBreakdown) {
  const ownerRows = breakdown.owners.map((owner) => `| ${owner.owner} | ${owner.count.toLocaleString("en-US")} | ${owner.repositoryCount} |`).join("\n");
  const repositoryRows = breakdown.repositories.map((repository) => `| ${repository.repository} | ${repository.visibility} | ${repository.count.toLocaleString("en-US")} |`).join("\n");
  return `# Private Misc contribution breakdown

This owner-visible ledger explains the gray Misc bucket. Keep it private: repository names may reveal private work.

- Official contributions without an observed repository identity: **${breakdown.officialUnattributedCount.toLocaleString("en-US")}**
- Attributed events under owners outside the four named groups: **${breakdown.otherOwnerAttributedCount.toLocaleString("en-US")}**
- Displayed Misc total: **${breakdown.displayedMiscCount.toLocaleString("en-US")}**
- Unattributed share of Misc: **${(breakdown.unattributedShare * 100).toFixed(1)}%**

## Other owners

| Owner | Contributions | Repositories |
|---|---:|---:|
${ownerRows || "| None | 0 | 0 |"}

## Other repositories

| Repository | Visibility | Contributions |
|---|---|---:|
${repositoryRows || "| None | public | 0 |"}
`;
}

export function buildPersonalLaneBreakdown(snapshot: ContributionSnapshot): PersonalLaneBreakdown {
  const normalizedLogin = snapshot.login.toLocaleLowerCase("en-US");
  const directPersonalRepositories = new Map<string, { count: number; visibility: "public" | "private" }>();
  const outsideOwners = new Map<string, { count: number; repositories: Set<string> }>();
  const outsideRepositories = new Map<string, { count: number; visibility: "public" | "private" }>();
  let profileUnattributedCount = 0;

  for (const year of snapshot.years) {
    for (const day of year.days) {
      profileUnattributedCount += day.unattributedCount ?? 0;
      for (const project of day.projects ?? []) {
        if (organizationKeyForRepository(project.repository) !== "misc") continue;
        const owner = project.repository.split("/", 1)[0];
        if (owner.toLocaleLowerCase("en-US") === normalizedLogin) {
          const current = directPersonalRepositories.get(project.repository) ?? { count: 0, visibility: project.visibility };
          current.count += project.count;
          directPersonalRepositories.set(project.repository, current);
          continue;
        }
        const current = outsideOwners.get(owner) ?? { count: 0, repositories: new Set<string>() };
        current.count += project.count;
        current.repositories.add(project.repository);
        outsideOwners.set(owner, current);
        const repository = outsideRepositories.get(project.repository) ?? { count: 0, visibility: project.visibility };
        repository.count += project.count;
        outsideRepositories.set(project.repository, repository);
      }
    }
  }

  const personalRepositories = [...directPersonalRepositories.entries()]
    .map(([repository, total]) => ({ repository, visibility: total.visibility, count: total.count }))
    .sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository));
  const owners = [...outsideOwners.entries()]
    .map(([owner, total]) => ({ owner, count: total.count, repositoryCount: total.repositories.size }))
    .sort((left, right) => right.count - left.count || left.owner.localeCompare(right.owner));
  const outsideRepositoryRows = [...outsideRepositories.entries()]
    .map(([repository, total]) => ({ repository, visibility: total.visibility, count: total.count }))
    .sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository));
  const directPersonalRepositoryCount = personalRepositories.reduce((sum, repository) => sum + repository.count, 0);
  const outsideOwnerContributionCount = owners.reduce((sum, owner) => sum + owner.count, 0);
  const excludedFromVisibleCount = profileUnattributedCount + directPersonalRepositoryCount + outsideOwnerContributionCount;
  return {
    profileLogin: snapshot.login,
    profileUnattributedCount,
    directPersonalRepositoryCount,
    outsideOwnerContributionCount,
    displayedPersonalLaneCount: excludedFromVisibleCount,
    excludedFromVisibleCount,
    directPersonalRepositories: personalRepositories,
    outsideOwners: owners,
    outsideRepositories: outsideRepositoryRows,
  };
}

export function renderPersonalLaneBreakdownMarkdown(breakdown: PersonalLaneBreakdown) {
  const repositoryRows = breakdown.directPersonalRepositories
    .map((repository) => `| ${repository.repository} | ${repository.visibility} | ${repository.count.toLocaleString("en-US")} |`)
    .join("\n");
  const ownerRows = breakdown.outsideOwners
    .map((owner) => `| ${owner.owner} | ${owner.count.toLocaleString("en-US")} | ${owner.repositoryCount} |`)
    .join("\n");
  const outsideRepositoryRows = breakdown.outsideRepositories
    .map((repository) => `| ${repository.repository} | ${repository.visibility} | ${repository.count.toLocaleString("en-US")} |`)
    .join("\n");
  return `# Private excluded contribution breakdown

This owner-visible ledger explains every contribution excluded from the four-lane film. Keep it private: repository names may reveal private work.

- Official profile contributions without repository identity: **${breakdown.profileUnattributedCount.toLocaleString("en-US")}**
- Contributions to remaining repositories owned by ${breakdown.profileLogin}: **${breakdown.directPersonalRepositoryCount.toLocaleString("en-US")}**
- Contributions to smaller outside owners: **${breakdown.outsideOwnerContributionCount.toLocaleString("en-US")}**
- Total excluded from the visible film: **${breakdown.excludedFromVisibleCount.toLocaleString("en-US")}**

The official remainder has no repository identity in the collected GitHub response. It is not assigned a color. Known repositories below are also excluded because they do not map to NEW HEAT, Agriculture-Intelligence, VisualPT, or vis.gl.

## Remaining personal repositories

| Repository | Visibility | Contributions |
|---|---|---:|
${repositoryRows || "| None | public | 0 |"}

## Smaller outside owners

| Owner | Contributions | Repositories |
|---|---:|---:|
${ownerRows || "| None | 0 | 0 |"}

## Smaller outside repositories

| Repository | Visibility | Contributions |
|---|---|---:|
${outsideRepositoryRows || "| None | public | 0 |"}
`;
}
