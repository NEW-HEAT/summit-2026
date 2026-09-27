import {COORDINATE_SYSTEM, Deck, OrbitView, OrbitViewport, OrthographicView} from '@deck.gl/core';
import {IconLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer} from '@deck.gl/layers';
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeVideo,
} from 'mediabunny';

const queryParameters = new URLSearchParams(window.location.search);
const SHOW_TIMECODE = queryParameters.get('showTimecode') === '1';
const CALENDAR_DIRECTION = queryParameters.get('calendarDirection') === 'up' ? -1 : 1;
const RANK_MODE = queryParameters.get('rankMode') === 'lifetime' ? 'lifetime' : 'recent';
const RENDER_TRACK = ['calendar', 'contributors', 'timecode'].includes(queryParameters.get('renderTrack'))
  ? queryParameters.get('renderTrack')
  : 'composite';
const HANDOFF_PATH = queryParameters.get('handoff');
const TRANSPARENT_RENDER = RENDER_TRACK !== 'composite';
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const FRAME_COUNT = 3060;
const EXACT_BOUNDARY_FRAME_COUNT = 3;
const OPENING_FRAMES = 60;
const CALENDAR_HANDOFF_END_FRAME = 17;
const DECADE_EXPANSION_START_FRAME = 8;
const RUNWAY_DIVE_START_FRAME = 38;
const TRAVERSAL_END_FRAME = 2879;
const TRAVERSAL_FRAMES = TRAVERSAL_END_FRAME - OPENING_FRAMES + 1;
const OUTRO_START_FRAME = TRAVERSAL_END_FRAME + 1;
const OUTRO_FRAMES = FRAME_COUNT - OUTRO_START_FRAME;
const OUTRO_PULLBACK_FRAMES = OUTRO_FRAMES;
const OUTRO_EXPANSION_START_FRAME = OUTRO_START_FRAME;
const CONTRIBUTOR_HANDOFF_FRAMES = OPENING_FRAMES;
const CONTRIBUTOR_ENTRY_FRAMES = 34;
const PERSONAL_END_DATE = '2026-08-30';
const VIDEO_BITRATE = 20_000_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_WEEK = 7 * MILLISECONDS_PER_DAY;
const CELL_WORLD_SIZE = 126;
const CELL_WORLD_STEP = 148;
const CELL_CORNER_RADIUS_RATIO = 2 / 126;
const DECADE_OVERVIEW_CELL_SIZE = 8;
const DECADE_OVERVIEW_CELL_STEP = 11;
const DECADE_OVERVIEW_YEAR_GAP = 11;
const DECADE_OVERVIEW_YEAR_HEIGHT = 7 * DECADE_OVERVIEW_CELL_STEP -
  (DECADE_OVERVIEW_CELL_STEP - DECADE_OVERVIEW_CELL_SIZE);
const DECADE_OVERVIEW_ROW_STEP = DECADE_OVERVIEW_YEAR_HEIGHT + DECADE_OVERVIEW_YEAR_GAP;
const DECADE_OVERVIEW_WIDTH = 53 * DECADE_OVERVIEW_CELL_STEP -
  (DECADE_OVERVIEW_CELL_STEP - DECADE_OVERVIEW_CELL_SIZE);
const DECADE_OVERVIEW_HEIGHT = 11 * DECADE_OVERVIEW_YEAR_HEIGHT +
  10 * DECADE_OVERVIEW_YEAR_GAP;
const DECADE_OVERVIEW_X = (WIDTH - DECADE_OVERVIEW_WIDTH) / 2;
const DECADE_OVERVIEW_Y = (HEIGHT - DECADE_OVERVIEW_HEIGHT) / 2;
const PERSONAL_RECAP_SCALE = 2 ** -0.08;
const PERSONAL_RECAP_CELL_SIZE = 22;
const PERSONAL_RECAP_CELL_STEP = 30;
const PERSONAL_RECAP_YEAR_GAP = 52;
const PERSONAL_RECAP_YEAR_HEIGHT = 7 * PERSONAL_RECAP_CELL_STEP -
  (PERSONAL_RECAP_CELL_STEP - PERSONAL_RECAP_CELL_SIZE);
const PERSONAL_RECAP_WIDTH = 53 * PERSONAL_RECAP_CELL_STEP -
  (PERSONAL_RECAP_CELL_STEP - PERSONAL_RECAP_CELL_SIZE);
const PERSONAL_RECAP_HEIGHT = 4 * PERSONAL_RECAP_YEAR_HEIGHT + 3 * PERSONAL_RECAP_YEAR_GAP;
const STORY_ANCHOR_SCREEN_Y = Number(queryParameters.get('storyAnchorScreenY') ?? 670);
const VISIBLE_PAST_WEEKS = 96;
const VISIBLE_FUTURE_WEEKS = 64;
const ATLAS_TILE_SIZE = 128;
const ATLAS_COLUMNS = 16;
const CONTRIBUTOR_GLOBE_CENTER = [WIDTH / 2, HEIGHT / 2];
const CONTRIBUTOR_GLOBE_RADIUS_X = 510;
const CONTRIBUTOR_GLOBE_RADIUS_Y = 510;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RECENT_WINDOW_DAYS = 56;
const RECENT_HALF_LIFE_DAYS = 21;
const SPRING_OMEGA = Number(queryParameters.get('springOmega') ?? 10.353319741954815);
const MAXIMUM_CENTER_VELOCITY = Number(queryParameters.get('maximumCenterVelocity') ?? 18);
const MAXIMUM_CENTER_ACCELERATION = Number(queryParameters.get('maximumCenterAcceleration') ?? 3);
const OVERLAY_VIEW_STATE = {target: [WIDTH / 2, HEIGHT / 2, 0], zoom: 0};
const COLORS = {
  background: [13, 17, 23, 255],
  empty: [22, 27, 34, 128],
  greens: [
    [14, 68, 41, 82],
    [0, 109, 50, 82],
    [38, 166, 65, 82],
    [57, 211, 83, 82],
  ],
  green: [38, 166, 65, 255],
  brightGreen: [57, 211, 83, 255],
  text: [240, 246, 252, 255],
};

const canvas = document.querySelector('#scene');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Scene canvas is missing.');
const handoffElement = document.querySelector('#handoff-frame');
if (!(handoffElement instanceof HTMLImageElement)) throw new Error('Handoff image is missing.');
const timecodeCanvas = document.querySelector('#timecode-overlay');
if (!(timecodeCanvas instanceof HTMLCanvasElement)) throw new Error('Timecode canvas is missing.');
const timecodeContext = timecodeCanvas.getContext('2d', {alpha: true});
if (!timecodeContext) throw new Error('Timecode canvas must support alpha.');

const manifestPath = queryParameters.get('manifest');
if (!manifestPath) throw new Error('Missing manifest query parameter.');

let manifest;
let identities;
let identityByProviderId;
let providerIndexById;
let calendarDays;
let calendarDayIndexByDate;
let weekStartMs;
let firstStoryMs;
let lastStoryMs;
let frequencyThresholds;
let activityDirector;
let contributorMotion;
let contributorPulse;
let contributorAtlas;
let contributorIconMapping;
let deck;
let calendarViewport;
let storyAnchorWorldY;
let frameState;

const ready = initialize();

async function initialize() {
  await initializeHandoff();
  manifest = await fetch(manifestPath).then(requireJson);
  validateManifest();
  identities = await Promise.all(manifest.identities.map(loadIdentity));
  identityByProviderId = new Map(identities.map((identity) => [identity.providerUserId, identity]));
  providerIndexById = new Map(identities.map((identity, index) => [identity.providerUserId, index]));
  prepareCalendarDays();
  frequencyThresholds = calculateFrequencyThresholds(calendarDays);
  ({atlas: contributorAtlas, mapping: contributorIconMapping} = buildContributorAtlas(identities));
  activityDirector = buildActivityDirector();
  contributorMotion = bakeContributorMotion(activityDirector);
  contributorPulse = buildContributionPulse();
  await initializeDeck();
  drawFrame(0);
  return true;
}

function initializeHandoff() {
  handoffElement.style.opacity = '0';
  if (RENDER_TRACK !== 'calendar' && RENDER_TRACK !== 'contributors') return Promise.resolve();
  if (!HANDOFF_PATH) throw new Error(`${RENDER_TRACK} requires an exact handoff frame.`);
  return new Promise((resolve, reject) => {
    handoffElement.onload = () => resolve();
    handoffElement.onerror = () => reject(new Error(`Could not load handoff frame: ${HANDOFF_PATH}.`));
    handoffElement.src = HANDOFF_PATH;
  });
}

function validateManifest() {
  const contract = manifest.renderContract;
  if (manifest.publicationPolicy !== 'public-repository-only-frozen-avatars') {
    throw new Error(`Unsupported publication policy: ${manifest.publicationPolicy}.`);
  }
  if (![SPRING_OMEGA, MAXIMUM_CENTER_VELOCITY, MAXIMUM_CENTER_ACCELERATION]
    .every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('The living-ladder motion configuration is invalid.');
  }
  if (!Number.isFinite(STORY_ANCHOR_SCREEN_Y) || STORY_ANCHOR_SCREEN_Y < 200 ||
      STORY_ANCHOR_SCREEN_Y > 920) {
    throw new Error('The contribution reveal line must remain inside the encoded runway.');
  }
  if (contract.width !== WIDTH || contract.height !== HEIGHT || contract.fps !== FPS ||
      contract.frameCount !== FRAME_COUNT || contract.durationSeconds !== 51) {
    throw new Error('The frozen manifest does not match the 1920x1080 60fps 51-second contract.');
  }
  const providerIds = manifest.identities.map((identity) => identity.providerUserId);
  if (providerIds.length > 300 || new Set(providerIds).size !== providerIds.length) {
    throw new Error('The public identity pack violates the living-ladder capacity or dedupe contract.');
  }
  for (const identity of manifest.identities) {
    if (!identity.providerUserId || !identity.login || !identity.avatarAsset?.dataUrl) {
      throw new Error('A visible contributor is missing a provider ID, username, or frozen avatar.');
    }
  }
}

async function requireJson(response) {
  if (!response.ok) throw new Error(`Failed to load ${response.url}: ${response.status}.`);
  return response.json();
}

async function loadIdentity(identity) {
  return {...identity, image: await loadImage(identity.avatarAsset.dataUrl)};
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('A frozen avatar could not be decoded.'));
    image.src = source;
  });
}

function prepareCalendarDays() {
  calendarDays = manifest.weeks.flatMap((week, weekIndex) => week.days
    .filter((day) => day.inRange)
    .map((day) => {
      const year = Number(day.date.slice(0, 4));
      const yearStart = Date.UTC(year, 0, 1);
      const dateMs = Date.parse(`${day.date}T00:00:00Z`);
      const ordinal = Math.round((dateMs - yearStart) / MILLISECONDS_PER_DAY);
      const firstWeekday = new Date(yearStart).getUTCDay();
      return {
        ...day,
        weekIndex,
        year,
        yearIndex: year - 2016,
        localWeekIndex: Math.floor((ordinal + firstWeekday) / 7),
      };
    }));
  calendarDayIndexByDate = new Map(calendarDays.map((day, index) => [day.date, index]));
  weekStartMs = Date.parse(`${manifest.weeks[0].weekStart}T00:00:00Z`);
  firstStoryMs = Date.parse(manifest.sourceBoundary.firstInRangeCommitCommittedAt);
  lastStoryMs = Date.parse(manifest.sourceBoundary.lastInRangeCommitCommittedAt);
  if (!calendarDays.length || !Number.isFinite(firstStoryMs) || !Number.isFinite(lastStoryMs)) {
    throw new Error('The frozen calendar boundary is invalid.');
  }
}

function calculateFrequencyThresholds(days) {
  const positiveCounts = days.map((day) => day.commitCount).filter((count) => count > 0).sort((a, b) => a - b);
  if (!positiveCounts.length) return [1, 1, 1];
  return [0.25, 0.5, 0.75].map((percentile) =>
    positiveCounts[Math.ceil(percentile * positiveCounts.length) - 1],
  );
}

function buildContributorAtlas(loadedIdentities) {
  const rows = Math.ceil(loadedIdentities.length / ATLAS_COLUMNS);
  const atlas = document.createElement('canvas');
  atlas.width = ATLAS_COLUMNS * ATLAS_TILE_SIZE;
  atlas.height = rows * ATLAS_TILE_SIZE;
  const context = atlas.getContext('2d');
  if (!context) throw new Error('Could not create the contributor atlas.');
  const mapping = {};
  for (const [iconIndex, identity] of loadedIdentities.entries()) {
    const x = (iconIndex % ATLAS_COLUMNS) * ATLAS_TILE_SIZE;
    const y = Math.floor(iconIndex / ATLAS_COLUMNS) * ATLAS_TILE_SIZE;
    context.save();
    context.beginPath();
    context.arc(x + 64, y + 64, 60, 0, Math.PI * 2);
    context.clip();
    context.translate(0, y * 2 + ATLAS_TILE_SIZE);
    context.scale(1, -1);
    context.drawImage(identity.image, x + 4, y + 4, 120, 120);
    context.restore();
    mapping[identity.providerUserId] = {
      x,
      y,
      width: ATLAS_TILE_SIZE,
      height: ATLAS_TILE_SIZE,
      mask: false,
    };
  }
  return {atlas, mapping};
}

function buildActivityDirector() {
  const contributorCount = identities.length;
  const historyOrder = identities
    .map((identity, identityIndex) => ({
      identityIndex,
      firstContributionDate: identity.firstContributionDate,
      providerUserId: identity.providerUserId,
    }))
    .sort((left, right) =>
      left.firstContributionDate.localeCompare(right.firstContributionDate) ||
      left.providerUserId.localeCompare(right.providerUserId),
    );
  const historySlotByIdentity = new Int16Array(contributorCount);
  for (const [historyIndex, item] of historyOrder.entries()) {
    historySlotByIdentity[item.identityIndex] = historyIndex;
  }
  const firstDayIndexByIdentity = new Int16Array(contributorCount);
  firstDayIndexByIdentity.fill(-1);
  for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
    firstDayIndexByIdentity[identityIndex] = calendarDayIndexByDate.get(
      identities[identityIndex].firstContributionDate,
    ) ?? -1;
  }

  const commitCountsByDay = calendarDays.map((day) => {
    const counts = [];
    for (const contribution of day.visibleContributors) {
      const identityIndex = providerIndexById.get(contribution.providerUserId);
      if (identityIndex === undefined) throw new Error('A daily identity is missing from the frozen pack.');
      counts.push([identityIndex, contribution.authoredCommitCount]);
    }
    return counts;
  });
  const ranksByDay = [];
  const scoreFractionsByDay = [];
  const scores = new Float64Array(contributorCount);
  const cumulativeCounts = new Uint32Array(contributorCount);
  const mostRecentDay = new Int32Array(contributorCount);
  mostRecentDay.fill(-1);
  const decay = 2 ** (-1 / RECENT_HALF_LIFE_DAYS);
  const expiredWeight = 2 ** (-RECENT_WINDOW_DAYS / RECENT_HALF_LIFE_DAYS);
  let lifetimeRanks = new Int16Array(contributorCount);
  let lifetimeFractions = new Float32Array(contributorCount);
  lifetimeRanks.fill(-1);

  for (let dayIndex = 0; dayIndex < calendarDays.length; dayIndex += 1) {
    for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
      scores[identityIndex] *= decay;
    }
    const expiredDayIndex = dayIndex - RECENT_WINDOW_DAYS;
    if (expiredDayIndex >= 0) {
      for (const [identityIndex, count] of commitCountsByDay[expiredDayIndex]) {
        scores[identityIndex] -= count * expiredWeight;
        if (Math.abs(scores[identityIndex]) < 1e-12) scores[identityIndex] = 0;
      }
    }
    for (const [identityIndex, count] of commitCountsByDay[dayIndex]) {
      scores[identityIndex] += count;
      cumulativeCounts[identityIndex] += count;
      mostRecentDay[identityIndex] = dayIndex;
    }
    if (RANK_MODE === 'lifetime') {
      const rankRefresh = dayIndex === 0 || dayIndex === calendarDays.length - 1 ||
        new Date(`${calendarDays[dayIndex].date}T00:00:00Z`).getUTCDay() === 0;
      if (rankRefresh) {
        const admitted = [];
        for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
          if (firstDayIndexByIdentity[identityIndex] >= 0 &&
              firstDayIndexByIdentity[identityIndex] <= dayIndex &&
              cumulativeCounts[identityIndex] > 0) {
            admitted.push(identityIndex);
          }
        }
        admitted.sort((left, right) =>
          cumulativeCounts[right] - cumulativeCounts[left] ||
          mostRecentDay[right] - mostRecentDay[left] ||
          firstDayIndexByIdentity[left] - firstDayIndexByIdentity[right] ||
          identities[left].providerUserId.localeCompare(identities[right].providerUserId),
        );
        lifetimeRanks = new Int16Array(contributorCount);
        lifetimeRanks.fill(-1);
        lifetimeFractions = new Float32Array(contributorCount);
        const maximumLifetimeCount = admitted.length ? cumulativeCounts[admitted[0]] : 1;
        for (let rank = 0; rank < admitted.length; rank += 1) {
          const identityIndex = admitted[rank];
          if (rank < 24) lifetimeRanks[identityIndex] = rank;
          lifetimeFractions[identityIndex] =
            cumulativeCounts[identityIndex] / maximumLifetimeCount;
        }
      }
      ranksByDay.push(lifetimeRanks.slice());
      scoreFractionsByDay.push(lifetimeFractions.slice());
      continue;
    }
    const active = [];
    for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
      if (firstDayIndexByIdentity[identityIndex] >= 0 &&
          firstDayIndexByIdentity[identityIndex] <= dayIndex && scores[identityIndex] > 1e-10) {
        active.push(identityIndex);
      }
    }
    active.sort((left, right) =>
      scores[right] - scores[left] ||
      cumulativeCounts[right] - cumulativeCounts[left] ||
      mostRecentDay[right] - mostRecentDay[left] ||
      firstDayIndexByIdentity[left] - firstDayIndexByIdentity[right] ||
      identities[left].providerUserId.localeCompare(identities[right].providerUserId),
    );
    const ranks = new Int16Array(contributorCount);
    ranks.fill(-1);
    const fractions = new Float32Array(contributorCount);
    const maximumScore = active.length ? scores[active[0]] : 1;
    for (let rank = 0; rank < Math.min(24, active.length); rank += 1) {
      const identityIndex = active[rank];
      ranks[identityIndex] = rank;
      fractions[identityIndex] = scores[identityIndex] / maximumScore;
    }
    ranksByDay.push(ranks);
    scoreFractionsByDay.push(fractions);
  }
  return {
    historySlotByIdentity,
    firstDayIndexByIdentity,
    ranksByDay,
    scoreFractionsByDay,
  };
}

function bakeContributorMotion(director) {
  const contributorCount = identities.length;
  const values = new Float32Array(FRAME_COUNT * contributorCount * 4);
  const entryFrameByIdentity = new Int16Array(contributorCount);
  for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
    const contributionFrame = getFrameForStoryTimestamp(
      Date.parse(`${identities[identityIndex].firstContributionDate}T00:00:00Z`),
    );
    // Begin outside-frame motion early enough that the portrait lands on the
    // orb exactly when its first contribution enters the shared timeline.
    entryFrameByIdentity[identityIndex] = Math.max(
      EXACT_BOUNDARY_FRAME_COUNT,
      contributionFrame - CONTRIBUTOR_ENTRY_FRAMES + 1,
    );
  }
  const positionX = new Float64Array(contributorCount);
  const positionY = new Float64Array(contributorCount);
  const size = new Float64Array(contributorCount);
  const alpha = new Float64Array(contributorCount);
  const velocityX = new Float64Array(contributorCount);
  const velocityY = new Float64Array(contributorCount);
  const sizeVelocity = new Float64Array(contributorCount);
  const alphaVelocity = new Float64Array(contributorCount);
  const admitted = new Uint8Array(contributorCount);
  const timeStep = 1 / FPS;

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const dayIndex = getStoryDayIndex(frame);
    const ranks = director.ranksByDay[dayIndex];
    const scoreFractions = director.scoreFractionsByDay[dayIndex];
    for (let identityIndex = 0; identityIndex < contributorCount; identityIndex += 1) {
      if (director.firstDayIndexByIdentity[identityIndex] < 0 ||
          frame < entryFrameByIdentity[identityIndex]) {
        continue;
      }
      const globeTarget = getContributorGlobeTarget(
        director.historySlotByIdentity[identityIndex],
        frame,
        scoreFractions[identityIndex],
        ranks[identityIndex],
      );
      if (!admitted[identityIndex]) {
        const origin = getContributorEntryOrigin(identityIndex);
        admitted[identityIndex] = 1;
        positionX[identityIndex] = origin.x;
        positionY[identityIndex] = origin.y;
        size[identityIndex] = Math.max(16, globeTarget.size * 0.32);
        alpha[identityIndex] = 0;
      }
      const target = globeTarget;
      const entryAge = frame - entryFrameByIdentity[identityIndex];
      if (entryAge < CONTRIBUTOR_ENTRY_FRAMES) {
        const linearProgress = clamp(
          entryAge / Math.max(1, CONTRIBUTOR_ENTRY_FRAMES - 1),
          0,
          1,
        );
        const entryProgress = 1 - (1 - linearProgress) ** 3;
        const origin = getContributorEntryOrigin(identityIndex);
        const deltaX = target.x - origin.x;
        const deltaY = target.y - origin.y;
        const deltaLength = Math.max(1, Math.hypot(deltaX, deltaY));
        const curve = Math.sin(Math.PI * entryProgress) * origin.bend;
        positionX[identityIndex] = lerp(origin.x, target.x, entryProgress) -
          deltaY / deltaLength * curve;
        positionY[identityIndex] = lerp(origin.y, target.y, entryProgress) +
          deltaX / deltaLength * curve;
        size[identityIndex] = lerp(Math.max(16, target.size * 0.32), target.size, entryProgress);
        alpha[identityIndex] = target.alpha * smoothstep(0, 0.16, linearProgress);
        const offset = ((frame * contributorCount + identityIndex) * 4);
        values[offset] = positionX[identityIndex];
        values[offset + 1] = positionY[identityIndex];
        values[offset + 2] = size[identityIndex];
        values[offset + 3] = alpha[identityIndex];
        continue;
      }
      const rawAccelerationX = SPRING_OMEGA * SPRING_OMEGA *
        (target.x - positionX[identityIndex]) * timeStep * timeStep -
        2 * SPRING_OMEGA * velocityX[identityIndex] * timeStep;
      const rawAccelerationY = SPRING_OMEGA * SPRING_OMEGA *
        (target.y - positionY[identityIndex]) * timeStep * timeStep -
        2 * SPRING_OMEGA * velocityY[identityIndex] * timeStep;
      const accelerationScale = Math.min(
        1,
        MAXIMUM_CENTER_ACCELERATION / Math.max(1e-12, Math.hypot(rawAccelerationX, rawAccelerationY)),
      );
      const nextVelocityX = velocityX[identityIndex] + rawAccelerationX * accelerationScale;
      const nextVelocityY = velocityY[identityIndex] + rawAccelerationY * accelerationScale;
      const velocityScale = Math.min(
        1,
        MAXIMUM_CENTER_VELOCITY / Math.max(1e-12, Math.hypot(nextVelocityX, nextVelocityY)),
      );
      velocityX[identityIndex] = nextVelocityX * velocityScale;
      velocityY[identityIndex] = nextVelocityY * velocityScale;
      positionX[identityIndex] += velocityX[identityIndex];
      positionY[identityIndex] += velocityY[identityIndex];

      const sizeAcceleration = SPRING_OMEGA * SPRING_OMEGA * (target.size - size[identityIndex]) -
        2 * SPRING_OMEGA * sizeVelocity[identityIndex];
      sizeVelocity[identityIndex] += sizeAcceleration * timeStep;
      size[identityIndex] += sizeVelocity[identityIndex] * timeStep;
      const alphaAcceleration = SPRING_OMEGA * SPRING_OMEGA * (target.alpha - alpha[identityIndex]) -
        2 * SPRING_OMEGA * alphaVelocity[identityIndex];
      alphaVelocity[identityIndex] += alphaAcceleration * timeStep;
      alpha[identityIndex] += alphaVelocity[identityIndex] * timeStep;

      const offset = ((frame * contributorCount + identityIndex) * 4);
      values[offset] = positionX[identityIndex];
      values[offset + 1] = positionY[identityIndex];
      values[offset + 2] = size[identityIndex];
      values[offset + 3] = alpha[identityIndex];
    }
  }
  return values;
}

function getContributorEntryOrigin(identityIndex) {
  const hash = hashString(identities[identityIndex].providerUserId);
  const edge = hash % 4;
  const along = 0.1 + ((hash >>> 3) % 10_000) / 10_000 * 0.8;
  const margin = 120 + (hash % 90);
  const bend = ((hash >>> 7) % 2 === 0 ? -1 : 1) * (54 + (hash % 92));
  if (edge === 0) return {x: -margin, y: along * HEIGHT, bend};
  if (edge === 1) return {x: WIDTH + margin, y: along * HEIGHT, bend};
  if (edge === 2) return {x: along * WIDTH, y: -margin, bend};
  return {x: along * WIDTH, y: HEIGHT + margin, bend};
}

function buildContributionPulse() {
  const contributorCount = identities.length;
  const values = new Float32Array(FRAME_COUNT * contributorCount);
  const pulseFrameCount = 18;
  let eventCount = 0;
  for (let dayIndex = 0; dayIndex < calendarDays.length; dayIndex += 1) {
    const eventFrame = getFrameForStoryTimestamp(
      Date.parse(`${calendarDays[dayIndex].date}T00:00:00Z`),
    );
    for (const contribution of calendarDays[dayIndex].visibleContributors) {
      const identityIndex = providerIndexById.get(contribution.providerUserId);
      if (identityIndex === undefined) continue;
      eventCount += 1;
      const weight = 0.72 + 0.28 * clamp(
        Math.log1p(contribution.authoredCommitCount) / Math.log(8),
        0,
        1,
      );
      for (let pulseFrame = 0; pulseFrame < pulseFrameCount; pulseFrame += 1) {
        const frame = eventFrame + pulseFrame;
        if (frame >= FRAME_COUNT) break;
        const progress = pulseFrame / Math.max(1, pulseFrameCount - 1);
        const envelope = (1 - progress) ** 2;
        const pulseIndex = frame * contributorCount + identityIndex;
        values[pulseIndex] = Math.max(values[pulseIndex], envelope * weight);
      }
    }
  }
  values.eventCount = eventCount;
  return values;
}

function getFrameForStoryTimestamp(timestamp) {
  if (timestamp <= firstStoryMs) return OPENING_FRAMES;
  if (timestamp >= lastStoryMs) return TRAVERSAL_END_FRAME;
  const progress = (timestamp - firstStoryMs) / (lastStoryMs - firstStoryMs);
  return Math.round(OPENING_FRAMES + progress * (TRAVERSAL_FRAMES - 1));
}

function getContributorGlobeTarget(historyIndex, frame, scoreFraction, rank = -1) {
  const sphereIndex = (historyIndex * 137) % identities.length;
  const globeRotation = -0.28 + getJourneyProgress(frame) * 0.42;
  let radius;
  let angle;
  if (rank === 0) {
    radius = 0;
    angle = globeRotation;
  } else if (rank > 0 && rank <= 6) {
    radius = 150;
    angle = globeRotation + ((rank - 1) / 6) * Math.PI * 2;
  } else if (rank >= 7 && rank <= 14) {
    radius = 270;
    angle = globeRotation + 0.24 + ((rank - 7) / 8) * Math.PI * 2;
  } else if (rank >= 15 && rank <= 23) {
    radius = 350;
    angle = globeRotation - 0.16 + ((rank - 15) / 9) * Math.PI * 2;
  } else {
    const slotFraction = (sphereIndex + 0.5) / identities.length;
    const innerRadius = 390;
    const outerRadius = 510;
    radius = Math.sqrt(
      innerRadius * innerRadius + slotFraction *
      (outerRadius * outerRadius - innerRadius * innerRadius),
    );
    angle = sphereIndex * GOLDEN_ANGLE + globeRotation;
  }
  const depth = Math.sin(angle * 1.7 + sphereIndex * 0.13);
  const depthFraction = (depth + 1) / 2;
  const contributionScale = Math.pow(clamp(scoreFraction, 0, 1), 0.52);
  const depthScale = 0.94 + depthFraction * 0.08;
  const targetSize = rank >= 0 && rank < 24
    ? 36 + 110 * contributionScale
    : 24 + 40 * contributionScale;
  return {
    x: CONTRIBUTOR_GLOBE_CENTER[0] + Math.cos(angle) * radius,
    y: CONTRIBUTOR_GLOBE_CENTER[1] + Math.sin(angle) * radius,
    size: targetSize * depthScale,
    alpha: 0.8 + depthFraction * 0.2,
    depth,
  };
}

function getCalendarViewState(frame) {
  const journeyProgress = getJourneyProgress(frame);
  const crawlState = getCrawlViewState(journeyProgress);
  const overviewState = {target: [0, 0, 0], zoom: -0.08, rotationX: 90, rotationOrbit: 0};
  if (frame < OPENING_FRAMES) {
    return interpolateViewState(overviewState, crawlState, getRunwayDiveProgress(frame));
  }
  if (frame >= OUTRO_START_FRAME) {
    return interpolateViewState(crawlState, overviewState, getOutroPullbackProgress(frame));
  }
  return crawlState;
}

function getCrawlViewState(journeyProgress) {
  const orbitWave = Math.sin(journeyProgress * Math.PI * 2 * 0.82);
  const secondaryOrbitWave = Math.sin(journeyProgress * Math.PI * 4.4 + 0.35);
  return {
    target: [0, 0, 0],
    zoom: 0.33,
    rotationX: 20 + 1.6 * Math.sin(journeyProgress * Math.PI * 2),
    rotationOrbit: -14 + orbitWave * 24 + secondaryOrbitWave * 5,
  };
}

function getJourneyProgress(frame) {
  return smoothstep(
    0,
    1,
    (frame - OPENING_FRAMES) / Math.max(1, TRAVERSAL_END_FRAME - OPENING_FRAMES),
  );
}

function getDecadeRowExpansionProgress(frame, day) {
  const newestFirstYearIndex = 2026 - day.year;
  if (newestFirstYearIndex <= 3) {
    return quintic(
      (frame - DECADE_EXPANSION_START_FRAME) /
      Math.max(1, 18 - DECADE_EXPANSION_START_FRAME),
    );
  }
  const startFrame = 13 + (newestFirstYearIndex - 4) * 3;
  return quintic((frame - startFrame) / 6);
}

function getRunwayDiveProgress(frame) {
  return quintic(
    (frame - RUNWAY_DIVE_START_FRAME) /
    Math.max(1, OPENING_FRAMES - 1 - RUNWAY_DIVE_START_FRAME),
  );
}

function getOutroPullbackProgress(frame) {
  return quintic(
    (frame - OUTRO_START_FRAME) / Math.max(1, OUTRO_PULLBACK_FRAMES - 1),
  );
}

function getOutroExpansionTimeline(frame) {
  return clamp(
    (frame - OUTRO_EXPANSION_START_FRAME) /
    Math.max(1, FRAME_COUNT - 1 - OUTRO_EXPANSION_START_FRAME),
    0,
    1,
  );
}

function getOutroRowExpansionProgress(timeline, day) {
  const newestFirstYearIndex = 2026 - day.year;
  const start = (newestFirstYearIndex / 10) * 0.78;
  return quintic((timeline - start) / 0.22);
}

function interpolateViewState(start, end, progress) {
  return {
    target: [
      lerp(start.target[0], end.target[0], progress),
      lerp(start.target[1], end.target[1], progress),
      lerp(start.target[2], end.target[2], progress),
    ],
    zoom: lerp(start.zoom, end.zoom, progress),
    rotationX: lerp(start.rotationX, end.rotationX, progress),
    rotationOrbit: lerp(start.rotationOrbit, end.rotationOrbit, progress),
  };
}

function initializeDeck() {
  return new Promise((resolve, reject) => {
    let settled = false;
    deck = new Deck({
      canvas,
      width: WIDTH,
      height: HEIGHT,
      useDevicePixels: 1,
      views: [
        new OrbitView({
          id: 'calendar-runway',
          x: 0,
          y: 0,
          width: WIDTH,
          height: HEIGHT,
          orbitAxis: 'Z',
          orthographic: false,
          fovy: 48,
          near: 0.1,
          far: 100_000,
        }),
        new OrthographicView({id: 'overlay', flipY: true}),
      ],
      viewState: {'calendar-runway': getCalendarViewState(0), overlay: OVERLAY_VIEW_STATE},
      controller: false,
      layers: [],
      layerFilter: ({layer, viewport}) => layer.id.startsWith(`${viewport.id}-`),
      glOptions: {preserveDrawingBuffer: true, antialias: true, alpha: TRANSPARENT_RENDER},
      parameters: {
        clearColor: TRANSPARENT_RENDER
          ? [0, 0, 0, 0]
          : COLORS.background.map((value) => value / 255),
      },
      onLoad: () => {
        settled = true;
        resolve();
      },
      onError: (error) => {
        if (!settled) reject(error);
        else throw error;
      },
    });
  });
}

function getCalendarViewport() {
  const viewport = deck.getViewports().find((candidate) => candidate.id === 'calendar-runway');
  if (!viewport) throw new Error('The calendar OrbitViewport is missing.');
  return viewport;
}

function setCalendarViewForFrame(frame) {
  const calendarViewState = getCalendarViewState(frame);
  deck.setProps({
    viewState: {'calendar-runway': calendarViewState, overlay: OVERLAY_VIEW_STATE},
  });
  calendarViewport = getCalendarViewport();
  // The preceding personal crawl keeps the active cell 220 world units behind
  // the camera target. Preserve that exact camera-relative geometry here.
  storyAnchorWorldY = -220;
  return calendarViewState;
}

function drawFrame(frameIndex) {
  const frame = clamp(Math.round(frameIndex), 0, FRAME_COUNT - 1);
  const calendarViewState = setCalendarViewForFrame(frame);
  const data = buildFrameData(frame);
  const calendarHandoffProgress = quintic(
    (frame - EXACT_BOUNDARY_FRAME_COUNT + 1) /
    Math.max(1, CALENDAR_HANDOFF_END_FRAME - EXACT_BOUNDARY_FRAME_COUNT + 1),
  );
  const contributorHandoffProgress = quintic(
    frame / Math.max(1, CONTRIBUTOR_HANDOFF_FRAMES - 1),
  );
  handoffElement.style.opacity = RENDER_TRACK === 'calendar'
    ? String(1 - calendarHandoffProgress)
    : RENDER_TRACK === 'contributors'
      ? String(1 - contributorHandoffProgress)
      : '0';
  drawSynchronizedTimecode(data.timecode);
  deck.setProps({layers: buildLayers(data)});
  deck.redraw('living-ladder-deterministic-frame');
  frameState = {
    frameIndex: frame,
    storyDate: calendarDays[data.dayIndex].date,
    visibleCellCount: data.cells.length,
    contributorCount: data.contributors.length,
    focusLogins: data.labels.map((label) => label.text),
    calendarViewState,
  };
}

function drawSynchronizedTimecode(value) {
  timecodeContext.clearRect(0, 0, WIDTH, HEIGHT);
  if (RENDER_TRACK !== 'timecode') return;
  timecodeContext.save();
  timecodeContext.translate(WIDTH / 2, HEIGHT / 2);
  timecodeContext.fillStyle = '#ffffff';
  timecodeContext.shadowColor = 'rgba(0,0,0,0.82)';
  timecodeContext.shadowBlur = 16;
  timecodeContext.shadowOffsetY = 2;
  timecodeContext.textBaseline = 'middle';
  timecodeContext.font = '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
  drawCenteredTrackedTimecode(value, 3);
  timecodeContext.restore();
}

function drawCenteredTrackedTimecode(value, tracking) {
  let width = 0;
  for (const character of value) width += timecodeContext.measureText(character).width;
  width += Math.max(0, value.length - 1) * tracking;
  let cursor = -width / 2;
  for (const character of value) {
    timecodeContext.fillText(character, cursor, 0);
    cursor += timecodeContext.measureText(character).width + tracking;
  }
}

function buildFrameData(frame) {
  const dayIndex = getStoryDayIndex(frame);
  const timelineWeek = getTimelineWeek(frame);
  const runwayTransitionViewport = frame < OPENING_FRAMES
    ? createRunwayTransitionViewport(0)
    : frame >= OUTRO_START_FRAME
      ? createRunwayTransitionViewport(1)
      : calendarViewport;
  const runwayDiveProgress = frame < OPENING_FRAMES ? getRunwayDiveProgress(frame) : 1;
  const outroExpansionTimeline = frame >= OUTRO_EXPANSION_START_FRAME
    ? getOutroExpansionTimeline(frame)
    : 0;
  const firstVisibleWeek = Math.max(0, Math.floor(timelineWeek) - VISIBLE_PAST_WEEKS);
  const lastVisibleWeek = Math.min(
    manifest.weeks.length - 1,
    Math.ceil(timelineWeek) + VISIBLE_FUTURE_WEEKS,
  );
  const cells = [];
  const badges = [];
  const candidateDays = frame < OPENING_FRAMES || frame >= OUTRO_START_FRAME
    ? calendarDays
    : calendarDays.filter((day) => day.weekIndex >= firstVisibleWeek && day.weekIndex <= lastVisibleWeek);
  for (const day of candidateDays) {
      const center = getCellCenterWorld(day, day.weekIndex, timelineWeek);
      const projected = projectCell(center);
      const transitionProjected = runwayTransitionViewport === calendarViewport
        ? projected
        : projectCell(center, runwayTransitionViewport);
      const hasFiniteRunwayProjection = projected.polygon.every((point) =>
        Number.isFinite(point[0]) && Number.isFinite(point[1]),
      );
      const hasStableRunwayTarget = hasFiniteRunwayProjection && isVisibleQuad(projected.corners) &&
        projected.polygon.every((point) =>
          Math.abs(point[0]) < WIDTH * 3 && Math.abs(point[1]) < HEIGHT * 3);
      const hasStableRunwayTransitionTarget = isVisibleQuad(transitionProjected.corners) &&
        transitionProjected.polygon.every((point) =>
          Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
          Math.abs(point[0]) < WIDTH * 3 && Math.abs(point[1]) < HEIGHT * 3);
      const projectedVisibilityAlpha = getProjectedCellVisibility(projected);
      const transitionVisibilityAlpha = getProjectedCellVisibility(transitionProjected);
      if (frame >= OPENING_FRAMES && frame < OUTRO_START_FRAME && !hasStableRunwayTarget) continue;
      const sourceDayIndex = calendarDayIndexByDate.get(day.date);
      const revealed = sourceDayIndex !== undefined && sourceDayIndex <= dayIndex;
      const targetColor = revealed ? getFrequencyColor(day.commitCount) : COLORS.empty;
      if (frame < OPENING_FRAMES) {
        const personalPolygon = getScreenCellPolygon(getPersonalExpansionOriginCellScreen(day));
        const decadePolygon = getScreenCellPolygon(getOverviewCellScreen(day));
        const runwayPolygon = hasStableRunwayTransitionTarget
          ? transitionProjected.polygon
          : getRunwayContinuityExitPolygon(day, timelineWeek);
        const runwayColor = hasStableRunwayTransitionTarget
          ? targetColor
          : [targetColor[0], targetColor[1], targetColor[2], 0];
        const recapColor = getOverviewFrequencyColor(day.commitCount);
        const decadeRowExpansionProgress = getDecadeRowExpansionProgress(
          frame,
          day,
        );
        const expandedPolygon = personalPolygon.map((point, index) => [
          lerp(point[0], decadePolygon[index][0], decadeRowExpansionProgress),
          lerp(point[1], decadePolygon[index][1], decadeRowExpansionProgress),
        ]);
        const continuityAlpha = hasStableRunwayTransitionTarget
          ? 1
          : 1 - smoothstep(0.02, 0.42, runwayDiveProgress);
        const expansionAlpha = day.year >= 2023
          ? 1
          : smoothstep(0, 0.22, decadeRowExpansionProgress);
        cells.push({
          polygon: expandedPolygon.map((point, index) => [
            lerp(point[0], runwayPolygon[index][0], runwayDiveProgress),
            lerp(point[1], runwayPolygon[index][1], runwayDiveProgress),
          ]),
          color: multiplyAlpha(
            mixRgba(recapColor, runwayColor, runwayDiveProgress),
            expansionAlpha * continuityAlpha *
              lerp(1, transitionVisibilityAlpha, runwayDiveProgress),
          ),
        });
      } else if (frame >= OUTRO_START_FRAME) {
        const decadePolygon = getScreenCellPolygon(getOverviewCellScreen(day));
        const sourcePolygon = hasStableRunwayTransitionTarget
          ? transitionProjected.polygon
          : getRunwayContinuityExitPolygon(day, timelineWeek);
        const rowExpansionProgress = getOutroRowExpansionProgress(
          outroExpansionTimeline,
          day,
        );
        const entryAlpha = hasStableRunwayTransitionTarget
          ? lerp(transitionVisibilityAlpha, 1, rowExpansionProgress)
          : smoothstep(0, 0.16, rowExpansionProgress);
        cells.push({
          polygon: sourcePolygon.map((point, index) => [
            lerp(point[0], decadePolygon[index][0], rowExpansionProgress),
            lerp(point[1], decadePolygon[index][1], rowExpansionProgress),
          ]),
          color: multiplyAlpha(
            mixRgba(
              targetColor,
              getOverviewFrequencyColor(day.commitCount),
              rowExpansionProgress,
            ),
            entryAlpha,
          ),
        });
      } else {
        cells.push({
          polygon: projected.polygon,
          color: multiplyAlpha(targetColor, projectedVisibilityAlpha),
        });
      }
      const edge = minimumEdgeLength(projected.corners);
      if (frame >= OPENING_FRAMES && frame < OUTRO_START_FRAME && revealed &&
          day.humanContributorCount > 1 &&
          edge >= 28 && projected.center[0] >= 800) {
        const topRight = getProjectedUpperRight(projected.corners);
        badges.push({
          position: [topRight[0] - 8, topRight[1] + 8],
          text: day.humanContributorCount > 99 ? '99+' : String(day.humanContributorCount),
        });
      }
  }

  const contributors = [];
  const labels = [];
  const rims = [];
  const pulseRims = [];
  const ranks = activityDirector.ranksByDay[dayIndex];
  const contributorReveal = frame < CONTRIBUTOR_HANDOFF_FRAMES
    ? smoothstep(0.18, 0.95, frame / Math.max(1, CONTRIBUTOR_HANDOFF_FRAMES - 1))
    : 1;
  for (let identityIndex = 0; identityIndex < identities.length; identityIndex += 1) {
    const offset = ((frame * identities.length + identityIndex) * 4);
    const alpha = contributorMotion[offset + 3] * contributorReveal;
    if (alpha <= 0.01) continue;
    const entry = {
      providerUserId: identities[identityIndex].providerUserId,
      login: identities[identityIndex].login,
      position: [contributorMotion[offset], contributorMotion[offset + 1]],
      size: contributorMotion[offset + 2],
      alpha: Math.round(clamp(alpha, 0, 1) * 255),
      rank: ranks[identityIndex],
      glow: contributorPulse[frame * identities.length + identityIndex] * contributorReveal,
      depth: getContributorGlobeTarget(
        activityDirector.historySlotByIdentity[identityIndex],
        frame,
        activityDirector.scoreFractionsByDay[dayIndex][identityIndex],
        ranks[identityIndex],
      ).depth,
    };
    contributors.push(entry);
    rims.push(entry);
    if (entry.glow > 0.01) pulseRims.push(entry);
  }
  contributors.sort((left, right) => left.depth - right.depth ||
    left.size - right.size || left.providerUserId.localeCompare(right.providerUserId));
  rims.sort((left, right) => left.depth - right.depth ||
    left.providerUserId.localeCompare(right.providerUserId));
  return {
    frame,
    dayIndex,
    timelineWeek,
    cells,
    badges,
    contributors,
    rims,
    pulseRims,
    labels,
    timecode: formatDateTimecode(getTimecodeDate(frame)),
    openingProgress: runwayDiveProgress,
    rangeTimecodeAlpha: 0,
    storyTimecodeAlpha: 1,
  };
}

function buildLayers(data) {
  const calendarLayers = [
    new SolidPolygonLayer({
      id: 'overlay-calendar-runway-cells',
      data: data.cells,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPolygon: (item) => item.polygon,
      getFillColor: (item) => item.color,
      pickable: false,
      parameters: overlayParameters(),
    }),
    new ScatterplotLayer({
      id: 'overlay-cluster-badge-discs',
      data: data.badges,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (item) => item.position,
      getRadius: 11,
      radiusUnits: 'pixels',
      getFillColor: [13, 17, 23, 235],
      getLineColor: [38, 166, 65, 196],
      getLineWidth: 1,
      lineWidthUnits: 'pixels',
      filled: true,
      stroked: true,
      pickable: false,
      parameters: overlayParameters(),
    }),
    new TextLayer({
      id: 'overlay-cluster-badge-text',
      data: data.badges,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (item) => item.position,
      getText: (item) => item.text,
      getColor: [240, 246, 252, 218],
      getSize: 12,
      sizeUnits: 'pixels',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Arial, sans-serif',
      fontWeight: 600,
      fontSettings: {sdf: true, fontSize: 64, buffer: 5, radius: 10, cutoff: 0.25},
      billboard: false,
      pickable: false,
      parameters: overlayParameters(),
    }),
  ];
  const contributorLayers = [
    new ScatterplotLayer({
      id: 'overlay-contributor-rims',
      data: data.rims,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (item) => item.position,
      getRadius: (item) => item.size / 2 + 2,
      radiusUnits: 'pixels',
      getFillColor: [57, 211, 83, 0],
      getLineColor: (item) => [57, 211, 83, item.rank >= 0 && item.rank < 24 ? 116 : 48],
      getLineWidth: (item) => item.rank >= 0 && item.rank < 8 ? 2 : 1,
      lineWidthUnits: 'pixels',
      filled: false,
      stroked: true,
      pickable: false,
      parameters: overlayParameters(),
    }),
    new ScatterplotLayer({
      id: 'overlay-contributor-pulse-soft-glow',
      data: data.pulseRims,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (item) => item.position,
      getRadius: (item) => item.size / 2 + 6 + item.glow * 10,
      radiusUnits: 'pixels',
      getLineColor: (item) => [57, 211, 83, Math.round(92 * item.glow)],
      getLineWidth: (item) => 3 + 4 * item.glow,
      lineWidthUnits: 'pixels',
      filled: false,
      stroked: true,
      pickable: false,
      parameters: overlayParameters(),
    }),
    new ScatterplotLayer({
      id: 'overlay-contributor-pulse-edge',
      data: data.pulseRims,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      getPosition: (item) => item.position,
      getRadius: (item) => item.size / 2 + 2,
      radiusUnits: 'pixels',
      getLineColor: (item) => [57, 211, 83, Math.round(255 * item.glow)],
      getLineWidth: (item) => 1.5 + 2.5 * item.glow,
      lineWidthUnits: 'pixels',
      filled: false,
      stroked: true,
      pickable: false,
      parameters: overlayParameters(),
    }),
    new IconLayer({
      id: 'overlay-contributor-portraits',
      data: data.contributors,
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      iconAtlas: contributorAtlas,
      iconMapping: contributorIconMapping,
      getIcon: (item) => item.providerUserId,
      getPosition: (item) => item.position,
      getSize: (item) => item.size,
      sizeUnits: 'pixels',
      getColor: (item) => [255, 255, 255, item.alpha],
      billboard: false,
      pickable: false,
      parameters: overlayParameters(),
    }),
  ];
  if (RENDER_TRACK === 'calendar') return calendarLayers;
  if (RENDER_TRACK === 'contributors') return contributorLayers;
  if (RENDER_TRACK === 'timecode') return [];
  return [...calendarLayers, ...contributorLayers];
}

function buildRailMaskStrips(alpha = 1) {
  const strips = [];
  const step = 4;
  for (let x = 340; x < 520; x += step) {
    const right = Math.min(520, x + step);
    const midpoint = (x + right) / 2;
    const progress = (midpoint - 340) / (520 - 340);
    const mask = 3 * progress * progress - 2 * progress * progress * progress;
    strips.push({
      polygon: rectanglePolygon(x, right, 0, HEIGHT),
      color: [
        COLORS.background[0],
        COLORS.background[1],
        COLORS.background[2],
        Math.round(255 * (1 - mask) * alpha),
      ],
    });
  }
  for (let x = 1400; x < 1580; x += step) {
    const right = Math.min(1580, x + step);
    const midpoint = (x + right) / 2;
    const progress = (midpoint - 1400) / (1580 - 1400);
    const mask = 3 * progress * progress - 2 * progress * progress * progress;
    strips.push({
      polygon: rectanglePolygon(x, right, 0, HEIGHT),
      color: [
        COLORS.background[0],
        COLORS.background[1],
        COLORS.background[2],
        Math.round(255 * mask * alpha),
      ],
    });
  }
  return strips;
}

function overlayParameters() {
  return {depthTest: false, depthMask: false, blend: true};
}

function getStoryTimestamp(frame) {
  if (frame <= OPENING_FRAMES) return firstStoryMs;
  if (frame >= TRAVERSAL_END_FRAME) return lastStoryMs;
  const progress = (frame - OPENING_FRAMES) / (TRAVERSAL_FRAMES - 1);
  return firstStoryMs + progress * (lastStoryMs - firstStoryMs);
}

function getTimecodeDate(frame) {
  if (frame < 24) return PERSONAL_END_DATE;
  if (frame < OPENING_FRAMES) {
    const rewindProgress = quintic((frame - 24) / Math.max(1, OPENING_FRAMES - 1 - 24));
    const personalEndMs = Date.parse(`${PERSONAL_END_DATE}T00:00:00Z`);
    const timestamp = lerp(personalEndMs, firstStoryMs, rewindProgress);
    return new Date(timestamp).toISOString().slice(0, 10);
  }
  return new Date(getStoryTimestamp(frame)).toISOString().slice(0, 10);
}

function getStoryDayIndex(frame) {
  const timestamp = getStoryTimestamp(frame);
  const date = new Date(timestamp).toISOString().slice(0, 10);
  const exactIndex = calendarDayIndexByDate.get(date);
  if (exactIndex !== undefined) return exactIndex;
  if (timestamp <= Date.parse(`${calendarDays[0].date}T00:00:00Z`)) return 0;
  return calendarDays.length - 1;
}

function getTimelineWeek(frame) {
  return (getStoryTimestamp(frame) - weekStartMs) / MILLISECONDS_PER_WEEK;
}

function getCellCenterWorld(day, weekIndex, timelineWeek) {
  return [
    (day.weekday - 3) * CELL_WORLD_STEP,
    storyAnchorWorldY + CALENDAR_DIRECTION * (weekIndex - timelineWeek) * CELL_WORLD_STEP,
    2,
  ];
}

function createRunwayTransitionViewport(journeyProgress) {
  return new OrbitViewport({
    id: 'calendar-runway-transition',
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    orbitAxis: 'Z',
    orthographic: false,
    fovy: 48,
    near: 0.1,
    far: 100_000,
    ...getCrawlViewState(journeyProgress),
  });
}

function projectCell(center, viewport = calendarViewport) {
  const half = CELL_WORLD_SIZE / 2;
  const worldCorners = [
    [center[0] - half, center[1] - half, 2],
    [center[0] + half, center[1] - half, 2],
    [center[0] + half, center[1] + half, 2],
    [center[0] - half, center[1] + half, 2],
  ];
  const corners = worldCorners
    .map((corner) => viewport.project(corner, {topLeft: true}).slice(0, 2));
  const polygon = roundedRectanglePolygon(
    center[0] - half,
    center[0] + half,
    center[1] - half,
    center[1] + half,
    CELL_WORLD_SIZE * CELL_CORNER_RADIUS_RATIO,
  ).map((point) => viewport.project([point[0], point[1], 2], {topLeft: true}).slice(0, 2));
  return {
    center: viewport.project(center, {topLeft: true}).slice(0, 2),
    corners,
    polygon,
  };
}

function getFrequencyColor(commitCount) {
  if (commitCount <= 0) return COLORS.empty;
  let level = 1;
  for (const threshold of frequencyThresholds) {
    if (commitCount > threshold) level += 1;
  }
  return COLORS.greens[Math.min(4, level) - 1];
}

function getOverviewCellScreen(day) {
  const newestFirstYearIndex = 2026 - day.year;
  return {
    x: DECADE_OVERVIEW_X + day.localWeekIndex * DECADE_OVERVIEW_CELL_STEP,
    y: DECADE_OVERVIEW_Y + newestFirstYearIndex * DECADE_OVERVIEW_ROW_STEP +
      day.weekday * DECADE_OVERVIEW_CELL_STEP,
    size: DECADE_OVERVIEW_CELL_SIZE,
  };
}

function getPersonalRecapCellScreen(day) {
  if (day.year < 2023 || day.year > 2026) return null;
  const sourceYearIndex = 3 - (day.year - 2023);
  const worldLeft = -PERSONAL_RECAP_WIDTH / 2;
  const worldTop = -PERSONAL_RECAP_HEIGHT / 2;
  const worldX = worldLeft + day.localWeekIndex * PERSONAL_RECAP_CELL_STEP;
  const worldY = worldTop + sourceYearIndex *
    (PERSONAL_RECAP_YEAR_HEIGHT + PERSONAL_RECAP_YEAR_GAP) +
    day.weekday * PERSONAL_RECAP_CELL_STEP;
  return {
    x: WIDTH / 2 + worldX * PERSONAL_RECAP_SCALE,
    y: HEIGHT / 2 - (worldY + PERSONAL_RECAP_CELL_SIZE) * PERSONAL_RECAP_SCALE,
    size: PERSONAL_RECAP_CELL_SIZE * PERSONAL_RECAP_SCALE,
  };
}

function getPersonalExpansionOriginCellScreen(day) {
  const existingCell = getPersonalRecapCellScreen(day);
  if (existingCell) return existingCell;
  const newestFirstYearIndex = 2026 - day.year;
  return {
    x: DECADE_OVERVIEW_X + day.localWeekIndex * DECADE_OVERVIEW_CELL_STEP,
    y: DECADE_OVERVIEW_Y + (newestFirstYearIndex - 1) * DECADE_OVERVIEW_ROW_STEP +
      day.weekday * DECADE_OVERVIEW_CELL_STEP,
    size: DECADE_OVERVIEW_CELL_SIZE,
  };
}

function getScreenCellPolygon(cell) {
  return roundedRectanglePolygon(
    cell.x,
    cell.x + cell.size,
    cell.y,
    cell.y + cell.size,
    cell.size * CELL_CORNER_RADIUS_RATIO,
  );
}

function getOverviewFrequencyColor(commitCount) {
  const color = getFrequencyColor(commitCount);
  return [color[0], color[1], color[2], commitCount > 0 ? 235 : 173];
}

function getRunwayContinuityExitPolygon(day, timelineWeek) {
  const size = 4;
  const centerX = WIDTH / 2 + (day.weekday - 3) * 48 + (day.yearIndex - 5) * 1.5;
  const centerY = day.weekIndex < timelineWeek ? HEIGHT + 48 : -48;
  return roundedRectanglePolygon(
    centerX - size / 2,
    centerX + size / 2,
    centerY - size / 2,
    centerY + size / 2,
    size * CELL_CORNER_RADIUS_RATIO,
  );
}

function mixRgba(left, right, progress) {
  return left.map((value, index) => Math.round(lerp(value, right[index], progress)));
}

function multiplyAlpha(color, alpha) {
  return [color[0], color[1], color[2], Math.round(color[3] * alpha)];
}

function rectanglePolygon(left, right, top, bottom) {
  return [[left, top, 0], [right, top, 0], [right, bottom, 0], [left, bottom, 0]];
}

function roundedRectanglePolygon(left, right, top, bottom, radius) {
  const corners = [
    {x: left + radius, y: top + radius, start: Math.PI, end: Math.PI * 1.5},
    {x: right - radius, y: top + radius, start: Math.PI * 1.5, end: Math.PI * 2},
    {x: right - radius, y: bottom - radius, start: 0, end: Math.PI * 0.5},
    {x: left + radius, y: bottom - radius, start: Math.PI * 0.5, end: Math.PI},
  ];
  return corners.flatMap((corner) => Array.from({length: 5}, (_, index) => {
    const angle = lerp(corner.start, corner.end, index / 4);
    return [corner.x + Math.cos(angle) * radius, corner.y + Math.sin(angle) * radius];
  }));
}

function isVisibleQuad(corners) {
  return corners.some(([x, y]) => x > 140 && x < 1780 && y > 32 && y < HEIGHT + 180);
}

function minimumEdgeLength(corners) {
  return Math.min(...corners.map((corner, index) => distance(corner, corners[(index + 1) % corners.length])));
}

function getProjectedCellVisibility(projected) {
  if (!projected.corners.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
    return 0;
  }
  return smoothstep(1.5, 8, minimumEdgeLength(projected.corners));
}

function getProjectedUpperRight(corners) {
  const topEdge = [...corners].sort((left, right) => left[1] - right[1]).slice(0, 2);
  return topEdge[0][0] > topEdge[1][0] ? topEdge[0] : topEdge[1];
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function getContributorOverlapStatistics(contributors) {
  let pairCount = 0;
  let severePairCount = 0;
  let maximumOverlapPixels = 0;
  const pairs = [];
  for (let leftIndex = 0; leftIndex < contributors.length; leftIndex += 1) {
    const left = contributors[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < contributors.length; rightIndex += 1) {
      const right = contributors[rightIndex];
      const requiredDistance = (left.size + right.size) / 2 + 3;
      const overlapPixels = requiredDistance - distance(left.position, right.position);
      if (overlapPixels <= 0) continue;
      pairCount += 1;
      maximumOverlapPixels = Math.max(maximumOverlapPixels, overlapPixels);
      if (overlapPixels > Math.min(left.size, right.size) * 0.28) severePairCount += 1;
      pairs.push({
        ranks: [left.rank, right.rank],
        sizes: [left.size, right.size],
        overlapPixels,
      });
    }
  }
  const possiblePairCount = contributors.length * Math.max(0, contributors.length - 1) / 2;
  return {
    pairCount,
    severePairCount,
    maximumOverlapPixels,
    pairRate: possiblePairCount ? pairCount / possiblePairCount : 0,
    pairs: pairs.sort((left, right) => right.overlapPixels - left.overlapPixels).slice(0, 8),
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDateTimecode(date) {
  const [year, month, day] = date.split('-');
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${monthNames[Number(month) - 1]} ${day} ${year}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function smoothstep(edgeZero, edgeOne, value) {
  const progress = clamp((value - edgeZero) / (edgeOne - edgeZero), 0, 1);
  return 3 * progress * progress - 2 * progress * progress * progress;
}

function quintic(value) {
  const progress = clamp(value, 0, 1);
  return 6 * progress ** 5 - 15 * progress ** 4 + 10 * progress ** 3;
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

async function renderSampleMp4(startFrame, endFrame) {
  await ready;
  const firstFrame = clamp(Math.round(startFrame), 0, FRAME_COUNT - 1);
  const lastFrame = clamp(Math.round(endFrame), firstFrame, FRAME_COUNT - 1);
  const sampleFrameCount = lastFrame - firstFrame + 1;
  const supported = await canEncodeVideo('avc', {
    width: WIDTH,
    height: HEIGHT,
    bitrate: VIDEO_BITRATE,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
  });
  if (!supported) throw new Error('This browser cannot encode the 1080p H.264 sample.');
  const target = new BufferTarget();
  const output = new Output({format: new Mp4OutputFormat({fastStart: 'in-memory'}), target});
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: VIDEO_BITRATE,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
    keyFrameInterval: 2,
  });
  output.addVideoTrack(source, {frameRate: FPS, maximumPacketCount: sampleFrameCount + 2});
  await output.start();
  for (let frame = firstFrame; frame <= lastFrame; frame += 1) {
    drawFrame(frame);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const sampleFrame = frame - firstFrame;
    await source.add(sampleFrame / FPS, 1 / FPS, {
      keyFrame: sampleFrame === 0 || sampleFrame % 120 === 0,
    });
    if (sampleFrame % 60 === 0 || frame === lastFrame) {
      console.log(`DECKGL_LIVING_LADDER_PROGRESS ${sampleFrame + 1}/${sampleFrameCount}`);
    }
  }
  await output.finalize();
  if (!target.buffer) throw new Error('Browser encoder returned no MP4 buffer.');
  const filename = 'deckgl-living-ladder-checkpoint.raw.mp4';
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([target.buffer], {type: 'video/mp4'}));
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(anchor.href), 10_000);
  return {filename, frameCount: sampleFrameCount, fps: FPS, durationSeconds: sampleFrameCount / FPS};
}

function getDiagnostics(frame = 2700) {
  const sampleFrame = clamp(Math.round(frame), 0, FRAME_COUNT - 1);
  const calendarViewState = setCalendarViewForFrame(sampleFrame);
  const frameData = buildFrameData(sampleFrame);
  const contributorOverlap = getContributorOverlapStatistics(frameData.contributors);
  const visibleEdges = frameData.cells.map((cell) => ({
    corners: cell.polygon,
    center: [
      cell.polygon.reduce((sum, corner) => sum + corner[0], 0) / cell.polygon.length,
      cell.polygon.reduce((sum, corner) => sum + corner[1], 0) / cell.polygon.length,
    ],
  }))
    .filter((projected) => projected.center[1] < HEIGHT && projected.center[1] > 200)
    .map((projected) => ({y: projected.center[1], edge: minimumEdgeLength(projected.corners)}))
    .sort((left, right) => right.y - left.y);
  return {
    variant: 'personal-pitch-organic-continuity-v3',
    renderTrack: RENDER_TRACK,
    sourceBoundary: manifest.sourceBoundary,
    frame: sampleFrame,
    storyDate: calendarDays[frameData.dayIndex].date,
    eligiblePublicContributorCount: identities.length,
    renderedContributorCount: frameData.contributors.length,
    focusLogins: frameData.labels.map((label) => label.text),
    duplicateProviderCount: identities.length - new Set(identities.map((identity) => identity.providerUserId)).size,
    missingAvatarCount: identities.filter((identity) => !identity.image).length,
    frequencyThresholds,
    rankMode: RANK_MODE,
    storyAnchorScreenY: STORY_ANCHOR_SCREEN_Y,
    calendarContinuity: {
      renderer: 'single-overlay-rounded-polygon-layer',
      transitionMode: 'single-canonical-cell-peel-and-dive',
      offscreenFlow: 'temporal-edge-lanes',
      depthVisibilityFade: true,
      randomSegmentSpawn: false,
      overviewFrame: 0,
      runwayStartFrame: OPENING_FRAMES,
      decadeOutroStartFrame: OUTRO_START_FRAME,
      decadeOverviewFrame: FRAME_COUNT - 1,
      canonicalDayCount: calendarDays.length,
    },
    camera: {
      ...calendarViewState,
      fovy: 48,
      viewportX: 0,
      viewportWidth: WIDTH,
    },
    contributorLayout: {
      mode: 'collision-spaced-concentric-orb',
      center: CONTRIBUTOR_GLOBE_CENTER,
      radius: [CONTRIBUTOR_GLOBE_RADIUS_X, CONTRIBUTOR_GLOBE_RADIUS_Y],
      historyPortraitMinimumSize: 24,
      maximumContributionPortraitSize: 150,
      cumulativeRetention: true,
      orbBacking: false,
      topContributorRadialScale: 0.2,
      contributionPulseEventCount: contributorPulse.eventCount,
      contributionPulseDurationFrames: 18,
      entryMode: 'deterministic-offscreen-four-edge-snap',
      entryDurationFrames: CONTRIBUTOR_ENTRY_FRAMES,
      usernameLabels: false,
      overlap: contributorOverlap,
    },
    timecode: {
      format: 'Mon DD YYYY',
      font: '600 60px "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
      firstFrame: formatDateTimecode(getTimecodeDate(0)),
      rewindStartFrame: 24,
      rewindEndFrame: OPENING_FRAMES - 1,
      rewindTarget: formatDateTimecode(getTimecodeDate(OPENING_FRAMES - 1)),
      traversalStart: formatDateTimecode(getTimecodeDate(OPENING_FRAMES)),
      traversalEnd: formatDateTimecode(getTimecodeDate(TRAVERSAL_END_FRAME)),
      finalFrame: formatDateTimecode(getTimecodeDate(FRAME_COUNT - 1)),
    },
    cameraMotion: {
      personalReferenceRotationX: 20,
      rotationOrbitRange: [-43, 15],
      rotationXRange: [18.4, 21.6],
      zoomRange: [0.33, 0.33],
      fovy: 48,
      visiblePastWeeks: VISIBLE_PAST_WEEKS,
      visibleFutureWeeks: VISIBLE_FUTURE_WEEKS,
    },
    transition: {
      openingFrames: OPENING_FRAMES,
      openingSeconds: OPENING_FRAMES / FPS,
      fourYearToDecadeFrames: OPENING_FRAMES,
      fourYearToDecadeSeconds: OPENING_FRAMES / FPS,
      decadeToCrawlFrames: OPENING_FRAMES,
      decadeToCrawlSeconds: OPENING_FRAMES / FPS,
      overlapMode: 'single-organic-morph',
      outroFrames: OUTRO_FRAMES,
      outroSeconds: OUTRO_FRAMES / FPS,
      outroPullbackFrames: OUTRO_PULLBACK_FRAMES,
      outroExpansionFrames: FRAME_COUNT - OUTRO_EXPANSION_START_FRAME,
    },
    motion: {
      springOmega: SPRING_OMEGA,
      maximumCenterVelocity: MAXIMUM_CENTER_VELOCITY,
      maximumCenterAcceleration: MAXIMUM_CENTER_ACCELERATION,
    },
    deepestVisibleCell: visibleEdges[0] ?? null,
    viewClasses: deck.getViewports().map((viewport) => viewport.constructor.name),
    viewportIds: deck.getViewports().map((viewport) => viewport.id),
  };
}

window.__DECKGL_LIVING_LADDER__ = {
  ready,
  setFrame: async (frameIndex) => {
    await ready;
    drawFrame(frameIndex);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return frameState;
  },
  getDiagnostics,
  renderSampleMp4,
};
