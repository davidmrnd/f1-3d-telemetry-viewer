export function upperBound(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function intervalIndexAt(sorted: ArrayLike<number>, value: number): number {
  return Math.max(0, Math.min(sorted.length - 2, upperBound(sorted, value) - 1));
}
