import {Deck, OrthographicView, OrbitViewport, COORDINATE_SYSTEM} from '@deck.gl/core';
import {IconLayer, ScatterplotLayer, LineLayer} from '@deck.gl/layers';
import {createAvatarAtlasLayout} from './social-avatar-atlas.mjs';
import {FRAME_COUNT, buildSocialDirector, getPresence, getPortraitTarget, getConnectorSegment,
  getConnectorStyle, getDepartureEffect, advancePortraitFocus, separatePortraits, clamp, ease} from './social-orb-model.mjs';

const parameters = new URLSearchParams(location.search);
const width = 1920;
const height = 1080;
const protectedCore = {x: width / 2, y: height / 2, scaleX: 1.12, scaleY: 0.92, radius: 365};
const handoff = document.querySelector('#handoff-frame');
const canvas = document.querySelector('#scene');
let deck;
let director;
let atlas;
let iconMapping;
let baked;
let connections;
let manifest;
let diagnostics;
const ready = initialize();
function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Frozen image failed to decode'));
    image.src = source;
  });
}
async function initialize() {
  manifest = await fetch(parameters.get('manifest')).then(response => response.json());
  director = buildSocialDirector(manifest);
  const globe = await loadImage(parameters.get('handoff'));
  handoff.src = globe.src;
  const layout = createAvatarAtlasLayout(director.nodes);
  atlas = document.createElement('canvas');
  atlas.width = layout.width;
  atlas.height = layout.height;
  const context = atlas.getContext('2d');
  iconMapping = {};
  for (let offset = 0; offset < layout.tiles.length; offset += 32) {
    const batch = layout.tiles.slice(offset, offset + 32);
    const images = await Promise.all(batch.map(tile => loadImage(director.nodes[tile.index].avatar)));
    for (let position = 0; position < batch.length; position++) {
      const {index, x, y, size} = batch[position];
      const inset = size * 3 / 128;
      context.save();
      context.beginPath();
      context.arc(x + size / 2, y + size / 2, size / 2 - inset, 0, Math.PI * 2);
      context.clip();
      context.translate(0, y * 2 + size);
      context.scale(1, -1);
      context.drawImage(images[position], x + inset, y + inset, size - inset * 2, size - inset * 2);
      context.restore();
      iconMapping[index] = {x, y, width: size, height: size, mask: false};
    }
  }
  await bakeMotion();
  await new Promise((resolve, reject) => {
    deck = new Deck({
      canvas, width, height, useDevicePixels: 1,
      views: [new OrthographicView({id: 'portraits', flipY: true})],
      viewState: {target: [width / 2, height / 2, 0], zoom: 0},
      controller: false, layers: [],
      glOptions: {preserveDrawingBuffer: true, antialias: true, alpha: true},
      parameters: {clearColor: [0, 0, 0, 0]},
      onLoad: resolve, onError: reject,
    });
  });
  drawFrame(0);
}
async function bakeMotion() {
  const nodes = director.nodes;
  const count = nodes.length;
  // Only visible nodes need frame storage; keep the larger departure state without inflating RAM.
  baked = new Array(FRAME_COUNT);
  connections = Array.from({length: FRAME_COUNT}, () => []);
  const totals = new Float32Array(count);
  const strengths = new Float32Array(count);
  const lastPulse = new Int32Array(count).fill(-1000);
  const lastInteraction = new Int32Array(count).fill(-1000);
  const offsets = nodes.map(() => [0, 0, 0]);
  const worldPositions = nodes.map(node => node.direction.map(value => value * 490));
  const smoothedSizes = new Float32Array(count).fill(18);
  const focusWeights = new Float32Array(count);
  const previous = new Array(count);
  const spacingStates = new Map();
  const connectorVisibility = new Map();
  let maximumCollisionSpeed = 0;
  let maximumCollisionAcceleration = 0;
  let maximumSampledPenetration = 0;
  let maximumVisible = 0;
  let maximumStep = 0;
  let maximumStepDetail;
  let maximumAcceleration = 0;
  let finalVisible = 0;
  let finalPermanent = 0;
  let reentries = 0;
  const entries = new Uint16Array(count);
  let contributionEvents = 0;
  let socialEvents = 0;
  let minimumSmallPortraitRadius = Infinity;
  let minimumSmallPortraitDetail;
  let smallPortraitCoreIntrusions = 0;
  let maximumShownConnections = 0;
  let departingPortraitFrames = 0;
  let permanentDepartureFrames = 0;
  let outerExpansion = 0;
  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    for (const event of director.frames[frame]) {
      if (event.type === 'contribution') {
        totals[event.source] += event.count;
        lastPulse[event.source] = frame;
        contributionEvents++;
      } else {
        const edge = director.edges.get(event.edge);
        edge.count++;
        edge.weight += event.weight;
        edge.lastFrame = frame;
        strengths[event.source] += event.weight;
        strengths[event.target] += event.weight;
        lastInteraction[event.source] = frame;
        lastInteraction[event.target] = frame;
        socialEvents++;
      }
    }
    const progress = clamp((frame - 60) / 2819);
    const presence = nodes.map(node => getPresence(node, frame));
    const visibleCount = presence.reduce((total, life) => total + Number(life.visible), 0);
    outerExpansion += (ease((visibleCount - 600) / 800) - outerExpansion) * 0.008;
    const orbit = -24 + progress * 810;
    const viewport = new OrbitViewport({
      width, height, target: [0, 0, 0], orbitAxis: 'Y',
      rotationOrbit: orbit, rotationX: 19 + 9 * Math.sin(progress * Math.PI * 2),
      zoom: 0, orthographic: true, near: 0.1, far: 10000,
    });
    const maximumTotal = Math.max(1, ...totals);
    const maximumStrength = Math.max(1, ...strengths);
    const targets = nodes.map((node, index) => {
      const contributionFraction = Math.log1p(totals[index]) / Math.log1p(maximumTotal);
      const socialFraction = Math.log1p(strengths[index]) / Math.log1p(maximumStrength);
      const centrality = contributionFraction * 0.88 + socialFraction * 0.12;
      const radius = 490 * (0.86 + node.seed * 0.14) * (1 - centrality * 0.81);
      return node.direction.map(value => value * radius);
    });
    if (frame % 12 === 0) {
      const neighborPositions = nodes.map(() => [0, 0, 0, 0]);
      for (const edge of director.edges.values()) {
        if (!edge.count || !presence[edge.source].visible || !presence[edge.target].visible) continue;
        const weight = Math.log1p(edge.weight);
        for (const [source, target] of [[edge.source, edge.target], [edge.target, edge.source]]) {
          const accumulator = neighborPositions[source];
          for (let axis = 0; axis < 3; axis++) accumulator[axis] += targets[target][axis] * weight;
          accumulator[3] += weight;
        }
      }
      for (let index = 0; index < count; index++) {
        const accumulator = neighborPositions[index];
        if (!accumulator[3]) continue;
        for (let axis = 0; axis < 3; axis++) {
          const attraction = (accumulator[axis] / accumulator[3] - targets[index][axis]) * 0.14;
          offsets[index][axis] += (attraction - offsets[index][axis]) * 0.18;
        }
      }
    }
    const visible = [];
    const opening = ease(frame / 59);
    for (let index = 0; index < count; index++) {
      const node = nodes[index];
      const life = presence[index];
      if (!life.visible) {
        previous[index] = undefined;
        spacingStates.delete(index);
        continue;
      }
      const entryStart = life.entryStart;
      if (!previous[index]) {
        if (entries[index]++) reentries++;
      }
      const entry = ease((frame - entryStart) / 30);
      const target = worldPositions[index];
      for (let axis = 0; axis < 3; axis++) {
        target[axis] += (targets[index][axis] + offsets[index][axis] - target[axis]) * 0.045;
      }
      const projected = viewport.project(target);
      const orbitRadians = orbit * Math.PI / 180;
      const pitchRadians = (19 + 9 * Math.sin(progress * Math.PI * 2)) * Math.PI / 180;
      const rotatedDepth = -Math.sin(orbitRadians) * target[0] + Math.cos(orbitRadians) * target[2];
      const viewDepth = Math.sin(pitchRadians) * target[1] + Math.cos(pitchRadians) * rotatedDepth;
      const depth = clamp((490 - viewDepth) / 980);
      const score = Math.sqrt(totals[index] / maximumTotal);
      const desiredSize = Math.max(18, (totals[index] ? 23 + 111 * score : 18) * (0.88 + 0.12 * (1 - depth)));
      smoothedSizes[index] += (desiredSize - smoothedSizes[index]) * 0.085;
      const outerTarget = getPortraitTarget(node, projected, 30, progress, undefined, outerExpansion);
      const focusDistance = Math.hypot(projected[0] - outerTarget[0], projected[1] - outerTarget[1]);
      focusWeights[index] = advancePortraitFocus(focusWeights[index], smoothedSizes[index], focusDistance);
      // A demoting portrait finishes its outward travel before becoming a tiny outer-lane face.
      const size = Math.max(smoothedSizes[index], focusWeights[index] > 0.001 ? 30 + 28 * focusWeights[index] : 0);
      const previousPoint = previous[index];
      const portraitTarget = getPortraitTarget(node, projected, size, progress, focusWeights[index], outerExpansion);
      // Enter radially into the assigned sector, never across the major contributors' center.
      const entryAngle = Math.atan2(portraitTarget[1] - height / 2, portraitTarget[0] - width / 2);
      const originX = width / 2 + Math.cos(entryAngle) * 1400;
      const originY = height / 2 + Math.sin(entryAngle) * 1000;
      const targetX = originX + (portraitTarget[0] - originX) * entry;
      const targetY = originY + (portraitTarget[1] - originY) * entry;
      const followStrength = totals[index] ? 0.18 : 0.12;
      // Orbit follows its own smooth base. Spacing never feeds displaced positions back into it.
      const x = previousPoint ? previousPoint.baseX + (targetX - previousPoint.baseX) * followStrength : targetX;
      const y = previousPoint ? previousPoint.baseY + (targetY - previousPoint.baseY) * followStrength : targetY;
      const glow = Math.max(clamp(1 - (frame - lastPulse[index]) / 20) ** 2,
        clamp(1 - (frame - lastInteraction[index]) / 12) ** 2 * 0.46);
      const depthAlpha = totals[index] ? 0.70 + 0.30 * (1 - depth) :
        0.25 + 0.43 * (1 - depth) ** 1.25;
      const effectAlpha = opening * Math.min(1, (frame - entryStart) / 12) * Math.max(depthAlpha, glow * 0.9);
      visible.push({index, x, y, baseX: x, baseY: y, size: size * (0.76 + entry * 0.24),
        protectedCore: size <= 30 ? protectedCore : null,
        alpha: life.opacity * effectAlpha, effectAlpha, departure: life.departure,
        spacingWeight: (1 - ease(life.departure)) * ease((frame - entryStart - 30) / 30),
        glow,
        settled: frame - entryStart >= 70, depth});
    }
    const spacing = separatePortraits(visible, spacingStates);
    maximumCollisionSpeed = Math.max(maximumCollisionSpeed, spacing.maximumSpeed);
    maximumCollisionAcceleration = Math.max(maximumCollisionAcceleration, spacing.maximumAcceleration);
    if (frame % 30 === 0) {
      const readable = visible.filter(item => item.settled && item.alpha > 0.35);
      for (let left = 0; left < readable.length; left++) for (let right = left + 1; right < readable.length; right++) {
        const first = readable[left];
        const second = readable[right];
        maximumSampledPenetration = Math.max(maximumSampledPenetration,
          (first.size + second.size) / 2 - Math.hypot(first.x - second.x, first.y - second.y));
      }
    }
    maximumVisible = Math.max(maximumVisible, visible.length);
    finalVisible = visible.length;
    finalPermanent = presence.filter(life => life.visible && life.permanent).length;
    baked[frame] = new Float32Array(visible.length * 8);
    for (const [visibleIndex, item] of visible.entries()) {
      if (item.departure > 0) {
        departingPortraitFrames++;
        if (presence[item.index].permanent) permanentDepartureFrames++;
        const differenceX = item.x - width / 2;
        const differenceY = item.y - height / 2;
        const distance = Math.hypot(differenceX, differenceY) || 1;
        const directionX = differenceX / distance;
        const directionY = differenceY / distance;
        const margin = item.size / 2 + 24;
        const horizontalRoom = Math.abs(directionX) < 0.0001 ? Infinity :
          ((directionX > 0 ? width - margin : margin) - item.x) / directionX;
        const verticalRoom = Math.abs(directionY) < 0.0001 ? Infinity :
          ((directionY > 0 ? height - margin : margin) - item.y) / directionY;
        const maximumTravel = Math.min(120 + nodes[item.index].seed * 40,
          Math.max(0, Math.min(horizontalRoom, verticalRoom)) * 0.78);
        const travel = maximumTravel * ease(item.departure);
        item.x += directionX * travel;
        item.y += directionY * travel;
      }
      if (item.size <= 30 && item.alpha > 0.05) {
        const radius = Math.hypot((item.x - width / 2) / 1.12, (item.y - height / 2) / 0.92);
        if (radius < minimumSmallPortraitRadius) minimumSmallPortraitDetail = {frame, id: nodes[item.index].id,
          radius, size: item.size, focus: focusWeights[item.index],
          entryFrames: frame - presence[item.index].entryStart,
          baseRadius: Math.hypot((item.baseX - width / 2) / 1.12, (item.baseY - height / 2) / 0.92),
          spacingDistance: Math.hypot(item.x - item.baseX, item.y - item.baseY)};
        minimumSmallPortraitRadius = Math.min(minimumSmallPortraitRadius, radius);
        if (radius < 320) smallPortraitCoreIntrusions++;
      }
      const previousPoint = previous[item.index];
      if (previousPoint) {
        item.velocityX = item.x - previousPoint.x;
        item.velocityY = item.y - previousPoint.y;
        if (item.settled) {
          const step = Math.hypot(item.velocityX, item.velocityY);
          if (step > maximumStep) {
            maximumStep = step;
            maximumStepDetail = {frame, id: nodes[item.index].id, size: item.size, departure: item.departure,
              baseStep: Math.hypot(item.baseX - previousPoint.baseX, item.baseY - previousPoint.baseY)};
          }
          if (previousPoint.settled) maximumAcceleration = Math.max(maximumAcceleration,
            Math.hypot(item.velocityX - previousPoint.velocityX, item.velocityY - previousPoint.velocityY));
        }
      }
      previous[item.index] = item;
      baked[frame].set([item.index, item.x, item.y, item.size, item.alpha, item.glow,
        item.departure, item.effectAlpha], visibleIndex * 8);
    }
    const strongest = [...director.edges.values()].filter(edge => edge.count &&
      presence[edge.source].visible && presence[edge.target].visible)
      .sort((left, right) => right.weight - left.weight || left.key.localeCompare(right.key));
    const selected = new Map();
    const degree = new Map();
    for (const edge of strongest) {
      if (selected.size >= 52) break;
      if ((degree.get(edge.source) ?? 0) >= 5 || (degree.get(edge.target) ?? 0) >= 5) continue;
      selected.set(edge.key, edge);
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    const recent = strongest.filter(edge => frame - edge.lastFrame < 14)
      .sort((left, right) => right.lastFrame - left.lastFrame || right.weight - left.weight).slice(0, 8);
    for (const edge of recent) selected.set(edge.key, edge);
    for (const key of selected.keys()) if (!connectorVisibility.has(key)) connectorVisibility.set(key, 0);
    for (const [key, opacity] of connectorVisibility) {
      const nextOpacity = clamp(opacity + (selected.has(key) ? 1 / 18 : -1 / 24));
      if (!nextOpacity) connectorVisibility.delete(key);
      else connectorVisibility.set(key, nextOpacity);
    }
    connections[frame] = [...connectorVisibility].flatMap(([key, opacity]) => {
      const edge = director.edges.get(key);
      const sourceLife = presence[edge.source];
      const targetLife = presence[edge.target];
      if (!sourceLife.visible || !targetLife.visible) return [];
      return [{source: edge.source, target: edge.target,
        pulse: clamp(1 - (frame - edge.lastFrame) / 14),
        strength: Math.log1p(edge.weight) / 8,
        visibility: ease(opacity) * ease((frame - Math.max(sourceLife.entryStart, targetLife.entryStart) - 20) / 22) *
          (1 - ease(Math.max(sourceLife.departure, targetLife.departure) / 0.65)),
      }];
    });
    maximumShownConnections = Math.max(maximumShownConnections,
      connections[frame].filter(edge => edge.visibility > 0.2).length);
    if (frame % 120 === 0) {
      console.log('SOCIAL_BAKE ' + frame + '/' + FRAME_COUNT + ' nodes=' + visible.length);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  diagnostics = {
    nodeCount: count, missingAvatarCount: manifest.nodes.length - count,
    duplicateProviderCount: count - new Set(nodes.map(node => node.id)).size,
    sourceEventCount: manifest.events.length, renderedSocialEvents: socialEvents,
    contributionEvents, maximumVisible, finalVisible, finalPermanent,
    finalTemporary: finalVisible - finalPermanent, reentries,
    maximumSampledPenetration, maximumStep, maximumStepDetail, maximumAcceleration,
    maximumCollisionSpeed, maximumCollisionAcceleration, retentionPolicy: manifest.retentionPolicy,
    minimumSmallPortraitRadius, minimumSmallPortraitDetail, smallPortraitCoreIntrusions, maximumShownConnections,
    departingPortraitFrames, permanentDepartureFrames,
    departureStyle: '42-frame outward drift, one green flash, six dissolving sparks; complete at expiry',
    bakedBytes: baked.reduce((total, frame) => total + frame.byteLength, 0),
    composition: 'Contribution-weighted focus with protected outer portrait lanes and gently widening side space',
    rotationDegrees: 810, dimensions: 3, nodeLabels: false, orbBacking: false,
    firstTimestamp: '2016-01-04T01:56:05Z', lastTimestamp: '2026-08-31T01:47:35Z',
    frameCount: FRAME_COUNT, coverage: manifest.coverage,
  };
}
function drawFrame(frame) {
  const nodes = [];
  const nodeByIndex = new Map();
  const frameData = baked[frame];
  for (let offset = 0; offset < frameData.length; offset += 8) {
    const index = frameData[offset];
    const alpha = frameData[offset + 4];
    if (alpha <= 0) continue;
    const node = {index, position: [frameData[offset + 1], frameData[offset + 2], 0],
      size: frameData[offset + 3], alpha, glow: frameData[offset + 5],
      departure: frameData[offset + 6], effectAlpha: frameData[offset + 7]};
    nodes.push(node);
    nodeByIndex.set(index, node);
  }
  const edges = connections[frame].flatMap(edge => {
    const source = nodeByIndex.get(edge.source);
    const target = nodeByIndex.get(edge.target);
    if (!source || !target) return [];
    const settled = edge.visibility;
    if (settled <= 0 || [source, target].some(node =>
      node.position[0] < 16 || node.position[0] > width - 16 ||
      node.position[1] < 16 || node.position[1] > height - 16)) return [];
    const segment = getConnectorSegment(source, target);
    if (!segment) return [];
    const alpha = Math.sqrt(source.alpha * target.alpha) * settled;
    return [{...edge, ...segment, alpha, ...getConnectorStyle(edge.strength, edge.pulse, alpha)}];
  });
  const common = {coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    pickable: false, parameters: {depthCompare: 'always', depthWriteEnabled: false}};
  const glows = nodes.filter(node => node.glow > 0.01);
  const departures = nodes.filter(node => node.departure > 0.66).map(node => ({...node,
    effect: getDepartureEffect(node.departure, director.nodes[node.index].seed)}));
  const sparks = departures.flatMap(node => {
    if (node.effect.sparkOpacity <= 0.001) return [];
    return Array.from({length: 6}, (_, index) => {
      const angle = director.nodes[node.index].seed * Math.PI * 2 + index * 2.399963229728653;
      const radius = node.size * 0.52 + node.effect.spread * (15 + index * 3);
      return {position: [node.position[0] + Math.cos(angle) * radius,
        node.position[1] + Math.sin(angle) * radius, 0],
      radius: (1.1 + index % 3 * 0.45) * (1 - node.effect.spread * 0.6),
      alpha: node.effect.sparkOpacity * node.effectAlpha};
    });
  });
  deck.setProps({layers: [
    new LineLayer({...common, id: 'social-connection-soft-edge', data: edges,
      getSourcePosition: item => item.source, getTargetPosition: item => item.target,
      getColor: item => [57, 211, 110, item.opacity * 0.14],
      getWidth: item => item.width + 3, widthUnits: 'pixels'}),
    new LineLayer({...common, id: 'social-connections', data: edges,
      getSourcePosition: item => item.source, getTargetPosition: item => item.target,
      getColor: item => [89, 231, 153, item.opacity],
      getWidth: item => item.width, widthUnits: 'pixels'}),
    new ScatterplotLayer({...common, id: 'portrait-rims', data: nodes,
      getPosition: item => item.position, getRadius: item => item.size / 2 + 1.6,
      radiusUnits: 'pixels', filled: false, stroked: true,
      getLineColor: item => [57, 211, 83, (item.size > 32 ? 116 : 48) * item.alpha],
      getLineWidth: item => item.size > 70 ? 1.8 : 0.8, lineWidthUnits: 'pixels'}),
    new ScatterplotLayer({...common, id: 'contribution-glow', data: glows,
      getPosition: item => item.position, getRadius: item => item.size / 2 + 4 + item.glow * 4,
      radiusUnits: 'pixels', filled: false, stroked: true,
      getLineColor: item => [57, 211, 83, 105 * item.glow * item.alpha],
      getLineWidth: item => 2 + 3 * item.glow, lineWidthUnits: 'pixels'}),
    new ScatterplotLayer({...common, id: 'contribution-edge', data: glows,
      getPosition: item => item.position, getRadius: item => item.size / 2 + 1.5,
      radiusUnits: 'pixels', filled: false, stroked: true,
      getLineColor: item => [90, 255, 125, 255 * item.glow * item.alpha],
      getLineWidth: 1.8, lineWidthUnits: 'pixels'}),
    new IconLayer({...common, id: 'portraits', data: nodes,
      iconAtlas: atlas, iconMapping, getIcon: item => item.index,
      getPosition: item => item.position, getSize: item => item.size,
      getColor: item => [255, 255, 255, 255 * item.alpha], sizeUnits: 'pixels', billboard: false}),
    new ScatterplotLayer({...common, id: 'departure-flash', data: departures,
      getPosition: item => item.position, getRadius: item => item.size / 2 + 2 + item.effect.flash * 4,
      radiusUnits: 'pixels', filled: false, stroked: true,
      getLineColor: item => [148, 255, 185, 255 * item.effect.flash * item.effectAlpha],
      getLineWidth: item => 1.5 + item.effect.flash * 3, lineWidthUnits: 'pixels'}),
    new ScatterplotLayer({...common, id: 'departure-sparks', data: sparks,
      getPosition: item => item.position, getRadius: item => item.radius, radiusUnits: 'pixels',
      filled: true, stroked: false, getFillColor: item => [131, 255, 177, 240 * item.alpha]}),
  ]});
  handoff.style.opacity = String(1 - ease(frame / 59));
  deck.redraw('deterministic-social-orb');
}
window.__DECKGL_LIVING_LADDER__ = {
  ready, setFrame: async frame => {await ready; drawFrame(frame);},
  getDiagnostics: () => diagnostics,
};
