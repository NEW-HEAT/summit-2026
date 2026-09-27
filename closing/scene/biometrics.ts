import type {BiometricSample} from './types';

export function biometricAt(samples: BiometricSample[], progress: number): BiometricSample {
  const clamped = Math.max(0, Math.min(1, progress));
  const endIndex = samples.findIndex(sample => sample.progress >= clamped);
  if (endIndex <= 0) return samples[0];
  if (endIndex === -1) return samples[samples.length - 1];
  const start = samples[endIndex - 1];
  const end = samples[endIndex];
  const amount =
    (clamped - start.progress) / Math.max(end.progress - start.progress, 0.000001);
  return {
    progress: clamped,
    heartRateBpm: mix(start.heartRateBpm, end.heartRateBpm, amount),
    cadenceSpm: mix(start.cadenceSpm, end.cadenceSpm, amount),
    speedMetersPerSecond: mix(start.speedMetersPerSecond, end.speedMetersPerSecond, amount),
    powerWatts: mix(start.powerWatts, end.powerWatts, amount)
  };
}

export function biometricHeat(sample: BiometricSample): number {
  const heart = range(sample.heartRateBpm, 135, 190);
  const power = range(sample.powerWatts, 300, 850);
  return Math.max(0, Math.min(1, heart * 0.42 + power * 0.58));
}

function range(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}
