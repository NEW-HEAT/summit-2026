import {describe, expect, it} from 'vitest';
import {tileCredits} from './tileCredits';

describe('map data credits', () => {
  it('combines current tile credits and drops credits absent from the next viewport', () => {
    const a = {content: {gltf: {asset: {copyright: 'Provider B; Provider A'}}}};
    const b = {content: {gltf: {json: {asset: {copyright: 'Provider A; Provider C'}}}}};
    expect(tileCredits([a, b, {}])).toBe('Provider A; Provider B; Provider C');
    expect(tileCredits([b])).toBe('Provider A; Provider C');
    expect(tileCredits([])).toBe('');
  });
});
