#!/usr/bin/env tsx

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// GitHub's secondary search limit is materially tighter than the published
// 30-request window for this authenticated commit-history workload.
const SEARCH_INTERVAL_MS = 8_000;
const SECONDARY_RATE_LIMIT_WAIT_MS = 120_000;

type Options = {
  login: string;
  from: string;
  to: string;
  timezone: string;
  output: string;
  approveOwnerVisibleProjects: boolean;
};

type RepositoryRef = {
  nameWithOwner: string;
  isPrivate: boolean;
};

type ContributionKind = "commit" | "pullRequest" | "issue" | "review";

type ProjectEvent = RepositoryRef & {
  occurredAt: string;
  kind: ContributionKind;
  id: string;
};

type CalendarDay = {
  date: string;
  contributionCount: number;
  contributionLevel: "NONE" | "FIRST_QUARTILE" | "SECOND_QUARTILE" | "THIRD_QUARTILE" | "FOURTH_QUARTILE";
};

type ConnectionKind = "pullRequest" | "issue" | "review";

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  let approveOwnerVisibleProjects = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--approve-owner-visible-projects") {
      approveOwnerVisibleProjects = true;
      continue;
    }
    const value = argv[index + 1];
    if (!argument.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    values.set(argument, value);
    index += 1;
  }
  const login = values.get("--login");
  const from = values.get("--from");
  const to = values.get("--to");
  const output = values.get("--output");
  if (!login || !from || !to || !output) {
    throw new Error("Usage: acquire-project-contributions.mts --login <login> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --output <snapshot.json> --approve-owner-visible-projects [--timezone <iana-zone>]");
  }
  assertDate(from);
  assertDate(to);
  if (from > to) throw new Error("The contribution range must move forward in time.");
  if (!approveOwnerVisibleProjects) {
    throw new Error("Owner-visible project acquisition is blocked. Pass --approve-owner-visible-projects only after the owner explicitly requests per-project personal activity.");
  }
  return {
    login,
    from,
    to,
    timezone: values.get("--timezone") ?? "America/New_York",
    output: path.resolve(output),
    approveOwnerVisibleProjects,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const partialPath = `${options.output}.partial.json`;
  const viewer = await ghJson(["api", "user"]);
  if (viewer.login !== options.login) {
    throw new Error(`Authenticated GitHub viewer ${viewer.login} does not match requested login ${options.login}.`);
  }

  const partial = await readPartial(partialPath, options);
  const calendarDays: CalendarDay[] = partial?.calendarDays ?? [];
  const events: ProjectEvent[] = partial?.events ?? [];
  const restrictedByYear: Array<{ year: number; count: number }> = partial?.restrictedByYear ?? [];
  const completedGraphqlRanges = new Set<string>(partial?.completedGraphqlRanges ?? []);
  const completedAuthoredRanges = new Set<string>(partial?.completedAuthoredRanges ?? []);
  const completedCommitRanges = new Set<string>(partial?.completedCommitRanges ?? []);
  for (const range of splitByYear(options.from, options.to)) {
    const key = `${range.from}..${range.to}`;
    if (completedGraphqlRanges.has(key)) {
      process.stdout.write(`PROJECT_CONTRIBUTIONS_GRAPHQL_CACHED ${key}\n`);
      continue;
    }
    const calendar = await fetchCalendar(range.from, range.to);
    calendarDays.push(...calendar.days);
    restrictedByYear.push({ year: Number(range.from.slice(0, 4)), count: calendar.restrictedContributionsCount });
    events.push(...await fetchContributionConnection("review", range.from, range.to));
    completedGraphqlRanges.add(key);
    await writePartial(partialPath, options, calendarDays, events, restrictedByYear, completedGraphqlRanges, completedAuthoredRanges, completedCommitRanges);
    process.stdout.write(`PROJECT_CONTRIBUTIONS_GRAPHQL ${range.from}..${range.to} days=${calendar.days.length} events=${events.length}\n`);
  }

  for (const range of splitByMonth(options.from, options.to)) {
    const key = `${range.from}..${range.to}`;
    if (completedAuthoredRanges.has(key)) {
      process.stdout.write(`PROJECT_CONTRIBUTIONS_AUTHORED_CACHED ${key}\n`);
      continue;
    }
    const authored = [
      ...await fetchAuthoredContributionSearch("pullRequest", options.login, range.from, range.to),
      ...await fetchAuthoredContributionSearch("issue", options.login, range.from, range.to),
    ];
    events.push(...authored);
    completedAuthoredRanges.add(key);
    await writePartial(partialPath, options, calendarDays, events, restrictedByYear, completedGraphqlRanges, completedAuthoredRanges, completedCommitRanges);
    process.stdout.write(`PROJECT_CONTRIBUTIONS_AUTHORED ${range.from}..${range.to} events=${authored.length}\n`);
  }

  for (const range of splitByMonth(options.from, options.to)) {
    const key = `${range.from}..${range.to}`;
    if (completedCommitRanges.has(key)) {
      process.stdout.write(`PROJECT_CONTRIBUTIONS_COMMITS_CACHED ${key}\n`);
      continue;
    }
    const commits = await searchCommits(options.login, range.from, range.to);
    events.push(...commits);
    completedCommitRanges.add(key);
    await writePartial(partialPath, options, calendarDays, events, restrictedByYear, completedGraphqlRanges, completedAuthoredRanges, completedCommitRanges);
    process.stdout.write(`PROJECT_CONTRIBUTIONS_COMMITS ${range.from}..${range.to} commits=${commits.length}\n`);
  }

  const uniqueEvents = new Map(events.map((event) => [`${event.kind}:${event.nameWithOwner}:${event.id}`, event]));
  const eventsByDay = new Map<string, ProjectEvent[]>();
  for (const event of uniqueEvents.values()) {
    const date = formatInTimezone(event.occurredAt, options.timezone);
    if (date < options.from || date > options.to) continue;
    const dayEvents = eventsByDay.get(date) ?? [];
    dayEvents.push(event);
    eventsByDay.set(date, dayEvents);
  }

  const levelMap = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 } as const;
  const years = splitByYear(options.from, options.to).map((range) => {
    const days = calendarDays
      .filter((day) => day.date >= range.from && day.date <= range.to)
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => {
        const projectMap = new Map<string, {
          repository: string;
          visibility: "public" | "private";
          count: number;
          commits: number;
          pullRequests: number;
          issues: number;
          reviews: number;
        }>();
        for (const event of eventsByDay.get(day.date) ?? []) {
          const current = projectMap.get(event.nameWithOwner) ?? {
            repository: event.nameWithOwner,
            visibility: event.isPrivate ? "private" : "public",
            count: 0,
            commits: 0,
            pullRequests: 0,
            issues: 0,
            reviews: 0,
          };
          current.count += 1;
          if (event.kind === "commit") current.commits += 1;
          if (event.kind === "pullRequest") current.pullRequests += 1;
          if (event.kind === "issue") current.issues += 1;
          if (event.kind === "review") current.reviews += 1;
          projectMap.set(event.nameWithOwner, current);
        }
        const projects = [...projectMap.values()].sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository));
        const attributedCount = projects.reduce((sum, project) => sum + project.count, 0);
        return {
          date: day.date,
          count: day.contributionCount,
          level: levelMap[day.contributionLevel],
          attributedCount,
          unattributedCount: Math.max(0, day.contributionCount - attributedCount),
          overflowCount: Math.max(0, attributedCount - day.contributionCount),
          projects,
        };
      });
    return {
      year: Number(range.from.slice(0, 4)),
      totalContributions: days.reduce((sum, day) => sum + day.count, 0),
      attributedContributions: days.reduce((sum, day) => sum + day.attributedCount, 0),
      days,
    };
  });

  const projectTotals = new Map<string, { repository: string; visibility: "public" | "private"; count: number }>();
  for (const year of years) {
    for (const day of year.days) {
      for (const project of day.projects) {
        const current = projectTotals.get(project.repository) ?? { repository: project.repository, visibility: project.visibility, count: 0 };
        current.count += project.count;
        projectTotals.set(project.repository, current);
      }
    }
  }
  const totals = [...projectTotals.values()].sort((left, right) => right.count - left.count || left.repository.localeCompare(right.repository));
  const snapshot = {
    schemaVersion: 2,
    login: options.login,
    generatedAt: new Date().toISOString(),
    source: "github-authenticated-owner-project-events",
    dateRange: { from: options.from, to: options.to },
    timezone: options.timezone,
    years,
    projects: totals,
    provenance: {
      authenticated: true,
      visibility: "owner-visible-projects",
      approval: "explicit-user-request-for-every-project",
      endpoints: ["viewer.contributionsCollection", "graphql.search authored issues and pull requests", "search/commits"],
      restrictedContributionsByYear: restrictedByYear,
      note: "Official calendar totals are retained independently from per-project events. Unattributed and overflow counts are explicit reconciliation fields.",
    },
  };
  await fs.mkdir(path.dirname(options.output), { recursive: true });
  await fs.writeFile(options.output, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(options.output, 0o600);
  await fs.rm(partialPath, { force: true });
  process.stdout.write(`PROJECT_CONTRIBUTIONS_COMPLETE days=${years.reduce((sum, year) => sum + year.days.length, 0)} projects=${totals.length} events=${uniqueEvents.size} output=${options.output}\n`);
}

async function fetchCalendar(from: string, to: string) {
  const query = `query($from:DateTime!,$to:DateTime!){viewer{contributionsCollection(from:$from,to:$to){restrictedContributionsCount contributionCalendar{weeks{contributionDays{date contributionCount contributionLevel}}}}}}`;
  const payload = await ghGraphql(query, { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` });
  const collection = payload.data.viewer.contributionsCollection;
  return {
    restrictedContributionsCount: collection.restrictedContributionsCount as number,
    days: collection.contributionCalendar.weeks.flatMap((week: any) => week.contributionDays) as CalendarDay[],
  };
}

async function fetchContributionConnection(kind: ConnectionKind, from: string, to: string) {
  const field = kind === "pullRequest" ? "pullRequestContributions" : kind === "issue" ? "issueContributions" : "pullRequestReviewContributions";
  const nodeSelection = kind === "pullRequest"
    ? "occurredAt pullRequest{id repository{nameWithOwner isPrivate}}"
    : kind === "issue"
      ? "occurredAt issue{id repository{nameWithOwner isPrivate}}"
      : "occurredAt pullRequestReview{id pullRequest{repository{nameWithOwner isPrivate}}}";
  const events: ProjectEvent[] = [];
  let after: string | null = null;
  do {
    const query = `query($from:DateTime!,$to:DateTime!,$after:String){viewer{contributionsCollection(from:$from,to:$to){${field}(first:100,after:$after){nodes{${nodeSelection}}pageInfo{hasNextPage endCursor}}}}}`;
    const payload = await ghGraphql(query, { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z`, after });
    const connection = payload.data.viewer.contributionsCollection[field];
    for (const node of connection.nodes) {
      const subject = kind === "pullRequest" ? node.pullRequest : kind === "issue" ? node.issue : node.pullRequestReview;
      const repository = kind === "review" ? subject.pullRequest.repository : subject.repository;
      events.push({
        occurredAt: node.occurredAt,
        kind,
        id: subject.id,
        nameWithOwner: repository.nameWithOwner,
        isPrivate: repository.isPrivate,
      });
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return events;
}

async function fetchAuthoredContributionSearch(
  kind: "pullRequest" | "issue",
  login: string,
  from: string,
  to: string,
) {
  const qualifier = kind === "pullRequest" ? "is:pr" : "is:issue";
  const searchQuery = `author:${login} ${qualifier} created:${from}..${to}`;
  const events: ProjectEvent[] = [];
  let after: string | null = null;
  let totalCount = 0;
  do {
    const query = `query($searchQuery:String!,$after:String){search(query:$searchQuery,type:ISSUE,first:100,after:$after){issueCount nodes{__typename ... on PullRequest{id createdAt repository{nameWithOwner isPrivate}} ... on Issue{id createdAt repository{nameWithOwner isPrivate}}} pageInfo{hasNextPage endCursor}}}`;
    const payload = await ghGraphql(query, { searchQuery, after });
    const connection = payload.data.search;
    totalCount = Number(connection.issueCount);
    if (totalCount > 1_000) {
      throw new Error(`GitHub authored ${kind} search exceeded the 1,000-result window for ${from}..${to}; split the acquisition range.`);
    }
    for (const node of connection.nodes) {
      if (!node.repository) continue;
      events.push({
        occurredAt: node.createdAt,
        kind,
        id: node.id,
        nameWithOwner: node.repository.nameWithOwner,
        isPrivate: node.repository.isPrivate,
      });
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  if (events.length !== totalCount) {
    throw new Error(`GitHub authored ${kind} search returned ${events.length} of ${totalCount} events for ${from}..${to}.`);
  }
  return events;
}

async function searchCommits(login: string, from: string, to: string): Promise<ProjectEvent[]> {
  const events: ProjectEvent[] = [];
  let page = 1;
  let totalCount = 0;
  do {
    let payload: any = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      payload = await ghSearch([
        "api", "-X", "GET", "search/commits",
        "-H", "Accept: application/vnd.github+json",
        "-f", `q=author:${login} author-date:${from}..${to}`,
        "-f", "per_page=100",
        "-f", `page=${page}`,
      ]);
      if (!payload.incomplete_results) break;
      // Historical search can time out even for sparse months. Smaller,
      // disjoint date windows must each be complete before accepting results.
      if (from < to) {
        const firstMs = Date.parse(from);
        const dayCount = Math.round((Date.parse(to) - firstMs) / 86_400_000) + 1;
        const midpointMs = firstMs + (Math.floor(dayCount / 2) - 1) * 86_400_000;
        const midpoint = new Date(midpointMs).toISOString().slice(0, 10);
        const next = new Date(midpointMs + 86_400_000).toISOString().slice(0, 10);
        process.stdout.write(`PROJECT_CONTRIBUTIONS_SPLIT_INCOMPLETE ${from}..${to} at=${midpoint}\n`);
        return [
          ...await searchCommits(login, from, midpoint),
          ...await searchCommits(login, next, to),
        ];
      }
      if (attempt === 3) throw new Error(`GitHub commit search remained incomplete for ${from}..${to} page ${page}.`);
      process.stdout.write(`PROJECT_CONTRIBUTIONS_INCOMPLETE_RETRY range=${from}..${to} page=${page} attempt=${attempt}\n`);
      await sleep(20_000);
    }
    totalCount = Number(payload.total_count);
    if (totalCount > 1_000) throw new Error(`GitHub commit search exceeded the 1,000-result window for ${from}..${to}; split the acquisition range.`);
    for (const item of payload.items) {
      events.push({
        occurredAt: item.commit.author.date,
        kind: "commit",
        id: item.sha,
        nameWithOwner: item.repository.full_name,
        isPrivate: Boolean(item.repository.private),
      });
    }
    page += 1;
  } while (events.length < totalCount);
  return events;
}

async function ghSearch(args: string[]) {
  const payload = await ghJson(args);
  await sleep(SEARCH_INTERVAL_MS);
  return payload;
}

async function ghGraphql(query: string, variables: Record<string, string | null>) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    if (value === null) continue;
    args.push("-F", `${name}=${value}`);
  }
  return ghJson(args);
}

async function ghJson(args: string[]) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const { stdout } = await execFileAsync("gh", args, { maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error: any) {
      const details = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
      if (!/secondary rate limit/i.test(details) || attempt === 4) throw error;
      process.stdout.write(`PROJECT_CONTRIBUTIONS_RATE_LIMIT attempt=${attempt} waitSeconds=${SECONDARY_RATE_LIMIT_WAIT_MS / 1_000}\n`);
      for (let elapsed = 0; elapsed < SECONDARY_RATE_LIMIT_WAIT_MS; elapsed += 10_000) {
        await sleep(10_000);
        process.stdout.write(`PROJECT_CONTRIBUTIONS_RATE_LIMIT_WAIT remainingSeconds=${(SECONDARY_RATE_LIMIT_WAIT_MS - elapsed - 10_000) / 1_000}\n`);
      }
    }
  }
  throw new Error("GitHub request retry loop ended unexpectedly.");
}

async function readPartial(partialPath: string, options: Options) {
  try {
    const partial = JSON.parse(await fs.readFile(partialPath, "utf8"));
    const key = `${options.login}:${options.from}:${options.to}:${options.timezone}`;
    if (partial.key !== key) throw new Error(`Partial acquisition key mismatch at ${partialPath}.`);
    process.stdout.write(`PROJECT_CONTRIBUTIONS_RESUME graphql=${partial.completedGraphqlRanges.length} months=${partial.completedCommitRanges.length}\n`);
    return partial;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writePartial(
  partialPath: string,
  options: Options,
  calendarDays: CalendarDay[],
  events: ProjectEvent[],
  restrictedByYear: Array<{ year: number; count: number }>,
  completedGraphqlRanges: Set<string>,
  completedAuthoredRanges: Set<string>,
  completedCommitRanges: Set<string>,
) {
  await fs.mkdir(path.dirname(partialPath), { recursive: true });
  const temporaryPath = `${partialPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify({
    key: `${options.login}:${options.from}:${options.to}:${options.timezone}`,
    calendarDays,
    events,
    restrictedByYear,
    completedGraphqlRanges: [...completedGraphqlRanges],
    completedAuthoredRanges: [...completedAuthoredRanges],
    completedCommitRanges: [...completedCommitRanges],
  })}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, partialPath);
  await fs.chmod(partialPath, 0o600);
}

function splitByYear(from: string, to: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year += 1) {
    ranges.push({ from: year === Number(from.slice(0, 4)) ? from : `${year}-01-01`, to: year === Number(to.slice(0, 4)) ? to : `${year}-12-31` });
  }
  return ranges;
}

function splitByMonth(from: string, to: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  let cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= last) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    ranges.push({ from: monthStart < from ? from : monthStart, to: monthEnd > to ? to : monthEnd });
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return ranges;
}

function formatInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return `${lookup.get("year")}-${lookup.get("month")}-${lookup.get("day")}`;
}

function assertDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ISO date: ${value}`);
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await main();
