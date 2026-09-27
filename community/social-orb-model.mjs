export const FRAME_COUNT = 3060;
export const FIRST_TIMESTAMP = Date.parse('2016-01-04T01:56:05Z');
export const LAST_TIMESTAMP = Date.parse('2026-08-31T01:47:35Z');
export const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
export const ease = value => { const fraction = clamp(value); return fraction ** 3 * (fraction * (fraction * 6 - 15) + 10); };
export function getEventFrame(date) {
  return Math.round(60 + 2819 * clamp((Date.parse(date) - FIRST_TIMESTAMP) / (LAST_TIMESTAMP - FIRST_TIMESTAMP)));
}
export function getTimelineFrame(timestamp) {
  return 60 + 2819 * (timestamp - FIRST_TIMESTAMP) / (LAST_TIMESTAMP - FIRST_TIMESTAMP);
}
/** Calendar months, in UTC, clamping month-end instead of overflowing into March. */
export function addSixMonths(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 6);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}
export function buildPresenceWindows(node) {
  const firstPullRequest = Date.parse(node.retention?.firstPullRequestDate);
  const dates = [...new Set([Date.parse(node.firstDate), firstPullRequest,
    ...(node.retention?.ownedActivityDates ?? []).map(Date.parse)])]
    .filter(date => Number.isFinite(date) && date <= LAST_TIMESTAMP).sort((left, right) => left - right);
  const windows = [];
  for (const date of dates) {
    const end = date === firstPullRequest ? Infinity : addSixMonths(date);
    const previous = windows.at(-1);
    if (previous && date <= previous.end) previous.end = Math.max(previous.end, end);
    else windows.push({start: date, end});
  }
  return windows.map(window => ({...window,
    startFrame: window.start <= FIRST_TIMESTAMP ? 5 : getTimelineFrame(window.start),
    endFrame: getTimelineFrame(window.end)}));
}
export function getPresence(node, frame) {
  // The final three seconds hold the same source time as the calendar and timecode.
  const storyFrame = Math.min(frame, 2879);
  for (const window of node.presenceWindows) {
    if (storyFrame < window.startFrame || storyFrame >= window.endFrame) continue;
    const departure = window.end <= LAST_TIMESTAMP ? clamp(1 - (window.endFrame - storyFrame) / 42) : 0;
    return {visible: true, entryStart: window.startFrame,
      departure, opacity: getDepartureEffect(departure).opacity,
      permanent: Number.isFinite(Date.parse(node.retention?.firstPullRequestDate)) &&
        storyFrame >= getTimelineFrame(Date.parse(node.retention.firstPullRequestDate))};
  }
  return {visible: false, opacity: 0, departure: 0, permanent: false};
}
/** One local flash, never a strobe. The drift and dissolve finish at the six-month cutoff. */
export function getDepartureEffect(progress, seed = 0.5) {
  const fraction = clamp(progress);
  const flashPhase = clamp((fraction - 0.66) / 0.22);
  return {
    distance: (120 + seed * 40) * ease(fraction),
    opacity: 1 - ease((fraction - 0.62) / 0.38),
    flash: Math.sin(Math.PI * flashPhase) ** 2,
    sparkOpacity: ease((fraction - 0.72) / 0.12) * (1 - ease((fraction - 0.87) / 0.13)),
    spread: ease((fraction - 0.72) / 0.28),
  };
}
export function hashIdentifier(value) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  result = Math.imul(result ^ result >>> 16, 0x7feb352d);
  result = Math.imul(result ^ result >>> 15, 0x846ca68b);
  result ^= result >>> 16;
  return (result >>> 0) / 4294967296;
}
/** Small portraits have stable outer lanes; a 3D sphere's rear pole must not cross the focus area. */
export function getPortraitTarget(node, projected, size, progress, focusOverride, outerExpansion = 0) {
  const angle = node.seed * Math.PI * 2 + progress * Math.PI * 0.72;
  const radialFraction = hashIdentifier(node.id + ':outer-radius');
  const radius = 375 + radialFraction * 135;
  const outerX = 960 + Math.cos(angle) * (radius * 1.12 + 300 * clamp(outerExpansion) * radialFraction);
  const outerY = 540 + Math.sin(angle) * radius * 0.92;
  const focus = focusOverride ?? ease((size - 30) / 28);
  return [outerX + (projected[0] - outerX) * focus,
    outerY + (projected[1] - outerY) * focus];
}
/** Size can grow promptly while promotion toward the center remains a gradual movement. */
export function advancePortraitFocus(current, size, distance) {
  const desired = ease((size - 30) / 28);
  const maximumChange = 3 / Math.max(1, distance);
  return current + clamp((desired - current) * 0.06, -maximumChange, maximumChange);
}
/** Trim connections to portrait rims so semi-transparent photos never contain stray linework. */
export function getConnectorSegment(source, target) {
  const differenceX = target.position[0] - source.position[0];
  const differenceY = target.position[1] - source.position[1];
  const distance = Math.hypot(differenceX, differenceY);
  const sourceRadius = source.size / 2 + 4;
  const targetRadius = target.size / 2 + 4;
  if (distance <= sourceRadius + targetRadius) return null;
  return {
    source: [source.position[0] + differenceX * sourceRadius / distance,
      source.position[1] + differenceY * sourceRadius / distance, 0],
    target: [target.position[0] - differenceX * targetRadius / distance,
      target.position[1] - differenceY * targetRadius / distance, 0],
  };
}
export function getConnectorStyle(strength, pulse, alpha) {
  const weight = clamp(strength);
  return {width: 1.25 + weight * 0.65 + pulse * 0.7,
    opacity: (110 + weight * 45 + pulse * 90) * alpha};
}
export function buildSocialDirector(manifest) {
  const nodes = manifest.nodes.filter(node => node.avatar);
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  const frames = Array.from({length: FRAME_COUNT}, () => []);
  const edges = new Map();
  for (const [index, node] of nodes.entries()) {
    node.birth = getEventFrame(node.firstDate);
    node.presenceWindows = buildPresenceWindows(node);
    node.seed = hashIdentifier(node.id);
    const vertical = hashIdentifier(node.id + ':latitude') * 1.84 - 0.92;
    const angle = node.seed * Math.PI * 2;
    const horizontal = Math.sqrt(1 - vertical * vertical);
    node.direction = [horizontal * Math.cos(angle), vertical, horizontal * Math.sin(angle)];
    for (const event of node.contributions) frames[getEventFrame(event.date)].push({
      source: index, count: event.count, type: 'contribution'});
  }
  for (const event of manifest.events) {
    const source = indexById.get(event.source);
    const target = indexById.get(event.target);
    if (source === undefined || target === undefined || source === target) continue;
    const key = [source, target].sort((left, right) => left - right).join(':');
    if (!edges.has(key)) edges.set(key, {key, source, target, count: 0, weight: 0, lastFrame: -1000});
    frames[getEventFrame(event.date)].push({source, target, edge: key,
      weight: event.type === 'reaction' ? 0.2 : event.type === 'mention' ? 1.5 : 1, type: event.type});
  }
  return {nodes, frames, edges, indexById};
}

/** A persistent damped spacing offset, independent of orbital movement. No position projection. */
export function separatePortraits(items, states = new Map()) {
  const buckets = new Map();
  const cellSize = 80;
  for (const item of items) {
    if (!states.has(item.index)) states.set(item.index, {x: 0, y: 0, velocityX: 0, velocityY: 0});
    const state = states.get(item.index);
    item.x += state.x;
    item.y += state.y;
    item.forceX = -state.x * 0.009 - state.velocityX * 0.32;
    item.forceY = -state.y * 0.009 - state.velocityY * 0.32;
    const key = Math.floor(item.x / cellSize) + ':' + Math.floor(item.y / cellSize);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  for (const item of items) {
    const column = Math.floor(item.x / cellSize);
    const row = Math.floor(item.y / cellSize);
    const reach = Math.ceil((item.size / 2 + 72) / cellSize);
    for (let offsetX = -reach; offsetX <= reach; offsetX++) {
      for (let offsetY = -reach; offsetY <= reach; offsetY++) {
        for (const other of buckets.get((column + offsetX) + ':' + (row + offsetY)) ?? []) {
          if (other.index <= item.index) continue;
          let differenceX = other.x - item.x;
          let differenceY = other.y - item.y;
          let distance = Math.hypot(differenceX, differenceY);
          const required = (item.size + other.size) / 2 + 3;
          if (distance >= required) continue;
          if (distance < 0.001) {
            const angle = hashIdentifier(item.index + ':' + other.index) * Math.PI * 2;
            differenceX = Math.cos(angle) * 0.001;
            differenceY = Math.sin(angle) * 0.001;
            distance = 0.001;
          }
          const leftShare = other.size ** 2 / (item.size ** 2 + other.size ** 2);
          const force = (required - distance) * 0.13 *
            Math.min(item.spacingWeight ?? 1, other.spacingWeight ?? 1);
          item.forceX -= differenceX / distance * force * leftShare;
          item.forceY -= differenceY / distance * force * leftShare;
          other.forceX += differenceX / distance * force * (1 - leftShare);
          other.forceY += differenceY / distance * force * (1 - leftShare);
        }
      }
    }
  }
  let maximumSpeed = 0;
  let maximumAcceleration = 0;
  for (const item of items) {
    const state = states.get(item.index);
    // Collision pressure may separate two faces by pushing a small one into the center.
    // Brake that inward drift early through the same bounded acceleration, never a position clamp.
    if (item.protectedCore) {
      const core = item.protectedCore;
      const horizontal = item.x - core.x;
      const vertical = item.y - core.y;
      const radius = Math.hypot(horizontal / core.scaleX, vertical / core.scaleY);
      if (radius < core.radius) {
        const gradientX = horizontal / core.scaleX ** 2;
        const gradientY = vertical / core.scaleY ** 2;
        const length = Math.hypot(gradientX, gradientY) || 1;
        const directionX = gradientX / length;
        const directionY = gradientY / length;
        const radialForce = item.forceX * directionX + item.forceY * directionY;
        const outwardForce = Math.max(0, (core.radius - radius) * 0.12 - radialForce);
        item.forceX += directionX * outwardForce;
        item.forceY += directionY * outwardForce;
      }
    }
    const accelerationScale = Math.min(1, 0.16 / (Math.hypot(item.forceX, item.forceY) || 1));
    const velocityX = state.velocityX + item.forceX * accelerationScale;
    const velocityY = state.velocityY + item.forceY * accelerationScale;
    const speedScale = Math.min(1, 1.8 / (Math.hypot(velocityX, velocityY) || 1));
    const nextVelocityX = velocityX * speedScale;
    const nextVelocityY = velocityY * speedScale;
    maximumAcceleration = Math.max(maximumAcceleration,
      Math.hypot(nextVelocityX - state.velocityX, nextVelocityY - state.velocityY));
    state.velocityX = nextVelocityX;
    state.velocityY = nextVelocityY;
    state.x += state.velocityX;
    state.y += state.velocityY;
    item.x += state.velocityX;
    item.y += state.velocityY;
    maximumSpeed = Math.max(maximumSpeed, Math.hypot(state.velocityX, state.velocityY));
  }
  return {maximumSpeed, maximumAcceleration};
}
