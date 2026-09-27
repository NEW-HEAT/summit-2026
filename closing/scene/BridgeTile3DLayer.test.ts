import {describe, expect, it} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {traversalIsCurrent} from './BridgeTile3DLayer';
describe('current-view tile capture gate', () => {
  const a = new WebMercatorViewport({width: 1280, height: 720, zoom: 18});
  const b = new WebMercatorViewport({width: 1280, height: 720, zoom: 19});
  it('rejects queued traversal, active traversal and an old draw', () => {
    expect(traversalIsCurrent({frameNumber: 2, updatePromise: Promise.resolve()}, 2, a, a)).toBe(false);
    expect(traversalIsCurrent({frameNumber: 2, traverseCounter: 1}, 2, a, a)).toBe(false);
    expect(traversalIsCurrent({frameNumber: 3}, 2, a, a)).toBe(false);
  });
  it('rejects a different camera even when the prior tiles are loaded', () => {
    expect(traversalIsCurrent({frameNumber: 2}, 2, b, a)).toBe(false);
    expect(traversalIsCurrent({frameNumber: 2}, 2, b, b)).toBe(true);
  });
});
