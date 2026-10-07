const KERNEL_SIGMAS = 3;

export function gaussianSmooth(values: Float64Array, sigmaInSamples: number): Float64Array {
  const count = values.length;
  if (sigmaInSamples <= 0 || count < 3) {
    return Float64Array.from(values);
  }

  const last = count - 1;
  const radius = Math.min(last, Math.ceil(sigmaInSamples * KERNEL_SIGMAS));
  const weights = new Float64Array(radius + 1);
  for (let offset = 0; offset <= radius; offset += 1) {
    weights[offset] = Math.exp(-0.5 * (offset / sigmaInSamples) ** 2);
  }

  const reflectedValue = (index: number): number => {
    if (index < 0) {
      return 2 * values[0] - values[-index];
    }
    if (index > last) {
      return 2 * values[last] - values[2 * last - index];
    }
    return values[index];
  };

  const smoothed = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    let weightedSum = weights[0] * values[index];
    let weightTotal = weights[0];
    for (let offset = 1; offset <= radius; offset += 1) {
      weightedSum += weights[offset] * (reflectedValue(index - offset) + reflectedValue(index + offset));
      weightTotal += 2 * weights[offset];
    }
    smoothed[index] = weightedSum / weightTotal;
  }

  return smoothed;
}
