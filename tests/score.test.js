const assert = require('node:assert/strict');
const { test } = require('node:test');
const { scoreRound, summarizeScores } = require('../miniprogram/utils/score');
const { createRunControl, runSuite } = require('../miniprogram/utils/runner');

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('round score uses the geometric mean of phase times in milliseconds', () => {
  const result = scoreRound([10, 40]);
  assert.deepEqual(result.phaseTimesMs, [10, 40]);
  close(result.geomeanMs, 20);
  close(result.score, 50);
  close(scoreRound([20]).score, 50);
  close(scoreRound([5, 20]).score, result.score * 2);
});

test('final score averages round scores, not round times', () => {
  const result = summarizeScores([scoreRound([10]), scoreRound([40])], true);
  close(result.mean, 62.5);
  assert.equal(result.complete, true);
  assert.equal(result.formattedMean, '62.50');
  close(result.delta, 12.706205 * 37.5);
});

test('ten identical rounds have no confidence interval width', () => {
  const result = summarizeScores(Array.from({ length: 10 }, () => scoreRound([20])), true);
  close(result.mean, 50);
  close(result.delta, 0);
  assert.equal(result.sampleCount, 10);
});

test('empty and partial runs do not become complete scores', () => {
  const empty = summarizeScores([], true);
  assert.equal(empty.mean, null);
  assert.equal(empty.delta, null);
  assert.equal(empty.complete, false);
  const partial = summarizeScores([scoreRound([20])]);
  close(partial.mean, 50);
  assert.equal(partial.delta, null);
  assert.equal(partial.complete, false);
});

test('invalid durations and samples cannot produce scores', () => {
  for (const totals of [[], [0], [-1], [NaN], [Infinity], [10, 0]]) {
    assert.throws(() => scoreRound(totals));
  }
  assert.throws(() => summarizeScores([{ score: Infinity }]));
});

async function fixture(measure, stopAtAttempt, page = { renderer: 'webview' }, options = {}) {
  const previousWx = global.wx;
  global.wx = {
    getDeviceInfo: () => ({ model: 'test', system: 'test', platform: 'test' }),
    getAppBaseInfo: () => ({ version: 'test', SDKVersion: 'test' })
  };
  const run = createRunControl();
  let attempt = 0;
  try {
    return await runSuite(page, run, {
      protocol: 'test-v1',
      ...options,
      steps: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }],
      async prepare() {
        attempt++;
        if (attempt === stopAtAttempt) run.stop('test stop');
      },
      async measure(page, control, step) {
        const elapsedMs = measure(attempt, step.id);
        return { elapsedMs, operations: [[elapsedMs]] };
      }
    });
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

test('runner excludes warmups and geometrically averages scene steps before scoring', async () => {
  const report = await fixture((attempt) => attempt <= 2 ? 1000 : 10);
  assert.equal(report.status, 'complete');
  assert.equal(report.warmupCompleted, 2);
  assert.equal(report.rounds.length, 10);
  assert.deepEqual(report.rounds[0].scoring.phaseTimesMs, [10, 10]);
  close(report.rounds[0].scoring.geomeanMs, 10);
  close(report.scoring.mean, 100);
  assert.equal(report.scoring.protocol, 'native-score-v2');
  assert.equal(report.scoring.aggregation, 'phase-geomean');
  assert.equal(report.scoring.complete, true);
  assert.equal(report.summary[0].sampleCount, 10);
  assert.equal(JSON.parse(JSON.stringify(report)).scoring.sampleCount, 10);
});

test('unequal phases use a geometric mean rather than their sum or arithmetic mean', async () => {
  const report = await fixture((attempt, step) => step === 'first' ? 100 : 400);
  assert.deepEqual(report.rounds[0].scoring.phaseTimesMs, [100, 400]);
  close(report.rounds[0].scoring.geomeanMs, 200);
  close(report.scoring.mean, 5);
});

test('Todo-style scoring sums steps as one suite instead of averaging phases', async () => {
  const report = await fixture((attempt, step) => step === 'first' ? 100 : 400,
    undefined, undefined, { scoreAggregation: 'suite-total' });
  const round = report.rounds[0].scoring;
  assert.deepEqual(round.phaseTimesMs, [100, 400]);
  assert.deepEqual(round.suiteTotalsMs, [500]);
  assert.equal(round.suiteTotalMs, 500);
  assert.equal(round.geomeanMs, 500);
  assert.equal(report.scoring.mean, 2);
  assert.equal(report.scoring.protocol, 'native-score-v3');
  assert.equal(report.scoring.aggregation, 'suite-total');
});

test('suite-total accepts a zero step only when the suite total is positive', async () => {
  const options = { scoreAggregation: 'suite-total' };
  const report = await fixture((attempt, step) => step === 'first' ? 0 : 10,
    undefined, undefined, options);
  assert.equal(report.status, 'complete');
  assert.equal(report.scoring.mean, 100);
  const empty = await fixture(() => 0, undefined, undefined, options);
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.scoring.mean, null);
  for (const times of [[-1, 10], [NaN, 10], [Infinity, 10], [0, 0]]) {
    assert.throws(() => scoreRound(times, 'suite-total'));
  }
});

test('suite-total scoring still averages round scores and excludes warmups', async () => {
  const report = await fixture((attempt) => attempt <= 2 ? 1000 : attempt % 2 ? 10 : 40,
    undefined, undefined, { scoreAggregation: 'suite-total' });
  close(report.scoring.mean, 31.25);
  assert.equal(report.scoring.sampleCount, 10);
  assert.equal(report.scoring.complete, true);
});

test('runner averages round scores after computing each rounds phase geomean', async () => {
  const report = await fixture((attempt, step) => {
    const time = step === 'first' ? 10 : 40;
    return attempt % 2 ? time : time * 4;
  });
  close(report.scoring.mean, 31.25);
});

test('runner retries invalid times without counting them in the score', async () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    const report = await fixture((attempt) => attempt === 3 ? invalid : 10);
    assert.equal(report.invalidRounds.length, 1);
    assert.equal(report.invalidRounds[0].attempt, 3);
    assert.equal(report.rounds.length, 10);
    close(report.scoring.mean, 100);
  }
});

test('one invalid phase rejects the round even when the remaining phase is positive', async () => {
  for (const invalid of [0, -1, NaN, Infinity]) {
    const report = await fixture((attempt, step) => attempt === 3 && step === 'first' ? invalid : 10);
    assert.equal(report.invalidRounds.length, 1);
    assert.equal(report.invalidRounds[0].attempt, 3);
    assert.equal(report.rounds.length, 10);
    close(report.scoring.mean, 100);
  }
});

test('stopped runs keep only prior valid scores as provisional', async () => {
  const report = await fixture(() => 10, 4);
  assert.equal(report.status, 'stopped');
  assert.equal(report.scoring.sampleCount, 1);
  assert.equal(report.scoring.complete, false);
  close(report.scoring.mean, 100);
});

test('exhausted or immediately stopped runs have no score', async () => {
  const incomplete = await fixture(() => 0);
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.invalidRounds.length, 15);
  assert.equal(incomplete.scoring.mean, null);
  assert.equal(incomplete.scoring.complete, false);
  const stopped = await fixture(() => 10, 1);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.scoring.mean, null);
});

test('reports preserve Skyline configuration separately from actual renderer', async () => {
  const fallback = await fixture(() => 10, undefined, { route: 'pages/todo/skyline', renderer: 'webview' });
  assert.equal(fallback.environment.configuredRenderer, 'skyline');
  assert.equal(fallback.environment.renderer, 'webview');
  assert.equal(fallback.environment.rendererFallback, true);
  const skyline = await fixture(() => 10, undefined, { configuredRenderer: 'skyline', renderer: 'skyline' });
  assert.equal(skyline.environment.configuredRenderer, 'skyline');
  assert.equal(skyline.environment.rendererFallback, false);
});