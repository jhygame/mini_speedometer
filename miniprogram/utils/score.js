const SCALE = 1000;
const T95 = [12.706205, 4.302653, 3.182446, 2.776445, 2.570582, 2.446912, 2.364624, 2.306004, 2.262157];

function scoreRound(phaseTimesMs, aggregation = 'phase-geomean') {
  if (!['phase-geomean', 'suite-total'].includes(aggregation)) throw new Error('Invalid scoring aggregation');
  if (!Array.isArray(phaseTimesMs) || !phaseTimesMs.length ||
      phaseTimesMs.some((time) => !Number.isFinite(time) || time < 0 || (time === 0 && aggregation !== 'suite-total'))) {
    throw new Error('Invalid phase times for scoring');
  }
  const suiteTotalMs = phaseTimesMs.reduce((sum, time) => sum + time, 0);
  const geomeanMs = aggregation === 'suite-total' ? suiteTotalMs
    : Math.exp(phaseTimesMs.reduce((sum, time) => sum + Math.log(time), 0) / phaseTimesMs.length);
  const score = SCALE / geomeanMs;
  if (!Number.isFinite(score) || score <= 0) throw new Error('Invalid round score');
  return {
    phaseTimesMs: phaseTimesMs.slice(),
    ...(aggregation === 'suite-total' ? { suiteTotalMs, suiteTotalsMs: [suiteTotalMs] } : {}),
    geomeanMs,
    score
  };
}

function summarizeScores(roundScores, complete = false, aggregation = 'phase-geomean') {
  const values = roundScores.map((round) => round.score);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Invalid score samples');
  }
  const sampleCount = values.length;
  const scoreSum = values.reduce((sum, value) => sum + value, 0);
  const mean = sampleCount ? scoreSum / sampleCount : null;
  const quantile = T95[sampleCount - 2];
  let delta = null;
  let squaredDeviationSum = null;
  let variance = null;
  let standardError = null;
  if (sampleCount > 1 && quantile !== undefined) {
    squaredDeviationSum = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    variance = squaredDeviationSum / (sampleCount - 1);
    standardError = Math.sqrt(variance / sampleCount);
    delta = quantile * standardError;
  }
  return {
    protocol: aggregation === 'suite-total' ? 'native-score-v3' : 'native-score-v2',
    scope: 'scene',
    aggregation,
    scale: SCALE,
    sampleCount,
    complete: complete && sampleCount > 0,
    values,
    mean,
    confidenceLevel: 0.95,
    delta,
    percentDelta: delta === null ? null : delta * 100 / mean,
    formattedMean: mean === null ? '' : mean.toFixed(2),
    formattedDelta: delta === null ? '' : delta.toFixed(2),
    ...(aggregation === 'suite-total' ? {
      calculation: {
        scoreSum,
        squaredDeviationSum,
        variance,
        standardDeviation: variance === null ? null : Math.sqrt(variance),
        standardError,
        degreesOfFreedom: sampleCount > 1 ? sampleCount - 1 : null,
        tCritical: quantile === undefined ? null : quantile,
        lowerBound: delta === null ? null : mean - delta,
        upperBound: delta === null ? null : mean + delta
      }
    } : {})
  };
}

module.exports = { scoreRound, summarizeScores };