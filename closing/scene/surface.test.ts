import {afterEach, describe, expect, it} from 'vitest';
import {meshHeightAt, registerBridgeSurfaces, roadHeightAt} from './surface';

function stackedRoadAndRailing() {
  return {
    cartographicOrigin: [0, 0, -20],
    gltf: {
      nodes: [{mesh: 0}],
      meshes: [{primitives: [{attributes: {POSITION: {value: [
        -10, -10, 0, 10, -10, 0, 0, 10, 0,
        -10, -10, 1.1, 10, -10, 1.1, 0, 10, 1.1
      ]}}}]}]
    }
  };
}

afterEach(() => registerBridgeSurfaces([]));

describe('road-only surface registration', () => {
  it('uses the road beneath a railing instead of treating the railing as the floor', () => {
    const content = stackedRoadAndRailing();
    registerBridgeSurfaces([content]);
    expect(meshHeightAt(content, [0, 0])).toBeCloseTo(-18.9);
    expect(roadHeightAt([0, 0], -20)).toBeCloseTo(-20);
  });

  it('returns no invented height when no provider triangle covers the foot point', () => {
    registerBridgeSurfaces([stackedRoadAndRailing()]);
    expect(roadHeightAt([1, 1], -20)).toBeNull();
    registerBridgeSurfaces([]);
    expect(roadHeightAt([0, 0], -20)).toBeNull();
  });
});
