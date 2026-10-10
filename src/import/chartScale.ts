export type DivergingScale = {
  step: number;
  positiveMax: number;
  negativeMax: number;
  totalRange: number;
  ticks: number[];
};

export type StackTotals = {
  positiveTotal: number;
  negativeTotal: number;
};

function niceStep(roughRange: number, targetTicks: number): number {
  if (roughRange <= 0) {
    return 1;
  }

  const roughStep = roughRange / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;

  let stepMultiple = 1;
  if (residual > 5) {
    stepMultiple = 10;
  } else if (residual > 2) {
    stepMultiple = 5;
  } else if (residual > 1) {
    stepMultiple = 2;
  }

  return stepMultiple * magnitude;
}

export function computeDivergingScale(buckets: StackTotals[]): DivergingScale {
  const rawPositiveMax = Math.max(0, ...buckets.map((bucket) => bucket.positiveTotal));
  const rawNegativeMax = Math.max(0, ...buckets.map((bucket) => bucket.negativeTotal));
  const step = niceStep(Math.max(rawPositiveMax, rawNegativeMax), 4);

  const positiveMax = Math.ceil(rawPositiveMax / step) * step || step;
  const negativeMax = rawNegativeMax === 0 ? 0 : Math.ceil(rawNegativeMax / step) * step;
  const totalRange = positiveMax + negativeMax;

  const ticks: number[] = [];
  for (let tick = -negativeMax; tick <= positiveMax; tick += step) {
    ticks.push(Math.round(tick / step) * step);
  }

  return { step, positiveMax, negativeMax, totalRange, ticks };
}
