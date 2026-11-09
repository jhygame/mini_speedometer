const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scoreRound, summarizeScores } = require('../miniprogram/utils/score');
const { todoScoreDetails } = require('../miniprogram/utils/todo-score-details');

const STEPS = [
  { id: 'Adding100Items', label: '新增 100 项' },
  { id: 'CompletingAllItems', label: '完成全部' },
  { id: 'DeletingAllItems', label: '删除全部' }
];

function reportFor(samples, options = {}) {
  const rounds = samples.map((times, index) => ({
    attempt: options.attempts ? options.attempts[index] : index + 3,
    steps: times.map((elapsedMs, stepIndex) => ({
      id: STEPS[stepIndex].id,
      syncMs: elapsedMs / 2,
      asyncMs: elapsedMs / 2,
      elapsedMs
    })),
    scoring: scoreRound(times, 'suite-total')
  }));
  return {
    protocol: 'native-todo-v4',
    measuredTarget: 10,
    warmupCompleted: 2,
    invalidRounds: options.invalidRounds || [],
    rounds,
    summary: samples.length ? STEPS : [],
    scoring: summarizeScores(rounds.map((round) => round.scoring), samples.length === 10, 'suite-total')
  };
}

test('Todo calculation metadata comes from the same unrounded score statistics', () => {
  const report = reportFor([[20, 30, 50], [40, 60, 100]]);
  const { scoring } = report;
  assert.equal(scoring.mean, 7.5);
  assert.deepEqual(scoring.calculation, {
    scoreSum: 15,
    squaredDeviationSum: 12.5,
    variance: 12.5,
    standardDeviation: Math.sqrt(12.5),
    standardError: 2.5,
    degreesOfFreedom: 1,
    tCritical: 12.706205,
    lowerBound: scoring.mean - scoring.delta,
    upperBound: scoring.mean + scoring.delta
  });
  assert.equal(scoring.delta, scoring.calculation.tCritical * scoring.calculation.standardError);
  const phaseScoring = summarizeScores(report.rounds.map((round) => round.scoring));
  assert.equal(phaseScoring.calculation, undefined);
  assert.equal(phaseScoring.mean, scoring.mean);
  assert.equal(phaseScoring.delta, scoring.delta);
});

test('Todo details show step sums, suite totals, round scores and score averaging without changing the report', () => {
  const report = reportFor([[20, 30, 50], [40, 60, 100]], {
    attempts: [3, 5],
    invalidRounds: [{ attempt: 4, warmup: false, reason: 'test failure' }]
  });
  const original = JSON.stringify(report);
  const details = todoScoreDetails(report);
  assert.deepEqual(details.rounds.map((round) => [round.number, round.attempt]), [[1, 3], [2, 5]]);
  assert.deepEqual(details.rounds[0].steps[0], {
    id: 'Adding100Items',
    label: '新增 100 项',
    equation: '10.0000 + 10.0000 ≈ 20.0000 ms'
  });
  assert.equal(details.rounds[0].totalEquation, 'T = 20.0000 + 30.0000 + 50.0000 ≈ 100.0000 ms');
  assert.equal(details.rounds[0].scoreEquation, 'S1 = 1000 / G = 1000 / 100.0000 ≈ 10.0000');
  assert.equal(details.rounds[1].scoreEquation, 'S2 = 1000 / G = 1000 / 200.0000 ≈ 5.0000');
  assert.deepEqual(details.meanLines, [
    '分数总和 = 10.0000 + 5.0000 ≈ 15.0000',
    '平均分 = 分数总和 / n ≈ 15.0000 / 2 ≈ 7.5000'
  ]);
  assert.match(details.meanTitle, /临时/);
  assert.match(details.sampleNote, /正式有效 2 \/ 10/);
  assert.match(details.sampleNote, /预热 2 轮/);
  assert.match(details.sampleNote, /无效尝试 1 轮/);
  assert.ok(details.confidenceLines.includes('自由度 = 1，t(0.975, 1) = 12.706205'));
  assert.ok(details.confidenceLines.includes('半宽 Δ = t × SE ≈ 12.706205 × 2.5000 ≈ 31.7655'));
  assert.ok(details.confidenceLines.includes('95% 置信区间 = 平均分 ± Δ ≈ [-24.2655, 39.2655]'));
  assert.equal(JSON.stringify(report), original);
});

test('Todo details distinguish no samples, a single temporary sample and a complete zero-variance run', () => {
  const empty = reportFor([]);
  const noSamples = todoScoreDetails(empty);
  assert.equal(empty.scoring.mean, null);
  assert.equal(empty.scoring.calculation.scoreSum, 0);
  assert.equal(empty.scoring.calculation.standardError, null);
  assert.equal(noSamples.sampleCount, 0);
  assert.deepEqual(noSamples.rounds, []);
  assert.deepEqual(noSamples.meanLines, []);
  assert.deepEqual(noSamples.confidenceLines, []);
  assert.doesNotMatch(JSON.stringify(noSamples), /NaN|Infinity/);

  const single = reportFor([[20, 30, 50]]);
  const singleDetails = todoScoreDetails(single);
  assert.equal(single.scoring.calculation.variance, null);
  assert.equal(single.scoring.calculation.tCritical, null);
  assert.match(singleDetails.meanTitle, /临时/);
  assert.deepEqual(singleDetails.confidenceLines, []);
  assert.match(singleDetails.confidenceNote, /至少需要 2 个/);

  const complete = reportFor(Array.from({ length: 10 }, () => [20, 30, 50]));
  const completeDetails = todoScoreDetails(complete);
  assert.match(completeDetails.meanTitle, /最终/);
  assert.equal(complete.scoring.delta, 0);
  assert.equal(complete.scoring.calculation.variance, 0);
  assert.equal(complete.scoring.calculation.degreesOfFreedom, 9);
  assert.equal(complete.scoring.calculation.tCritical, 2.262157);
  assert.equal(completeDetails.confidenceLines.length, 8);
  assert.ok(completeDetails.confidenceLines.includes('95% 置信区间 = 平均分 ± Δ ≈ [10.0000, 10.0000]'));
});

test('display precision never changes scoring or disguises a tiny positive denominator as zero', () => {
  const report = reportFor([[0, 0.000001, 0.000002], [1.23456789, 2.34567891, 3.45678912]]);
  const original = JSON.stringify(report);
  const details = todoScoreDetails(report);
  assert.equal(details.rounds[0].steps[0].equation, '0.0000 + 0.0000 ≈ 0.0000 ms');
  assert.match(details.rounds[0].scoreEquation, /1000 \/ 3\.000e-6/);
  assert.match(details.rounds[0].scoreEquation, /3\.333e\+8/);
  assert.equal(report.rounds[1].scoring.suiteTotalMs, 1.23456789 + 2.34567891 + 3.45678912);
  assert.equal(report.scoring.calculation.scoreSum, report.scoring.values.reduce((sum, score) => sum + score, 0));
  assert.equal(JSON.stringify(report), original);
});

test('Todo details explicitly report unavailable confidence intervals and reject incompatible data', () => {
  const unsupported = todoScoreDetails(reportFor(Array.from({ length: 11 }, () => [20, 30, 50])));
  assert.deepEqual(unsupported.confidenceLines, []);
  assert.match(unsupported.confidenceNote, /支持范围/);

  const incompatible = reportFor([[20, 30, 50]]);
  incompatible.scoring.aggregation = 'phase-geomean';
  assert.throws(() => todoScoreDetails(incompatible), /缺少套件汇总数据/);
  const invalid = reportFor([[20, 30, 50]]);
  invalid.rounds[0].steps[0].syncMs = NaN;
  assert.throws(() => todoScoreDetails(invalid), /无效数值/);
});
