const { scoreRound, summarizeScores } = require('./score');
const { rendererInfo } = require('./renderer-page');

const WARMUP_ROUNDS = 2;
const MEASURED_ROUNDS = 10;
const EXTRA_ATTEMPTS = 3;
const CALLBACK_TIMEOUT_MS = 5000;

function createRunControl() {
  return {
    reason: '',
    cancelPending: null,
    stop(reason) {
      if (this.reason) return;
      this.reason = reason;
      if (this.cancelPending) this.cancelPending(new Error(reason));
    }
  };
}

function waitForCallback(run, label, start) {
  return new Promise((resolve, reject) => {
    if (run.reason) {
      reject(new Error(run.reason));
      return;
    }

    const timer = setTimeout(() => finish(new Error(`${label}超时`)), CALLBACK_TIMEOUT_MS);
    function finish(error, value) {
      if (run.cancelPending !== finish) return;
      clearTimeout(timer);
      run.cancelPending = null;
      if (error) reject(error);
      else resolve(value);
    }

    run.cancelPending = finish;
    try {
      start((value) => finish(null, value), (message) => finish(new Error(message || label)));
    } catch (error) {
      finish(error);
    }
  });
}

function updatePage(page, run, patch) {
  return waitForCallback(run, '等待 setData 回调', (finish) => page.setData(patch, finish));
}

// Measure a serial series at the API boundary selected by the workload.
async function measureSeries(run, now, count, start) {
  const operations = [];
  let phaseStart;
  let phaseEnd;
  for (let i = 0; i < count; i++) {
    let started;
    const finished = await waitForCallback(run, '等待操作完成', (finish, fail) => {
      started = now();
      start(i, () => finish(now()), fail);
    });
    if (!(started <= finished) || (i > 0 && started < phaseEnd)) {
      throw new Error('计时时钟异常');
    }
    if (i === 0) phaseStart = started;
    phaseEnd = finished;
    operations.push([Number((finished - started).toFixed(3))]);
  }
  return { elapsedMs: phaseEnd - phaseStart, operations };
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(rounds, steps, responseColumn) {
  if (!rounds.length) return [];
  return steps.map((step, index) => {
    const samples = [];
    const phases = rounds.map((round) => {
      const phase = round.steps[index];
      if (phase.operations) phase.operations.forEach((operation) => samples.push(operation[responseColumn]));
      return phase;
    });
    samples.sort((a, b) => a - b);
    const phaseTimes = phases.map((phase) => phase.elapsedMs).sort((a, b) => a - b);
    const summary = {
      id: step.id,
      label: step.label,
      phaseMedianMs: median(phaseTimes).toFixed(2),
      sampleCount: phases.length
    };
    if (phases[0].syncMs !== undefined) {
      summary.syncMedianMs = median(phases.map((phase) => phase.syncMs).sort((a, b) => a - b)).toFixed(2);
      summary.asyncMedianMs = median(phases.map((phase) => phase.asyncMs).sort((a, b) => a - b)).toFixed(2);
    } else {
      summary.responseP50Ms = median(samples).toFixed(2);
      summary.responseP95Ms = samples[Math.ceil(samples.length * 0.95) - 1].toFixed(2);
      summary.sampleCount = samples.length;
    }
    if (phases[0].setDataCalls !== undefined) {
      summary.setDataCallsPerRound = phases[0].setDataCalls;
      summary.payloadBytesPerRound = Math.round(phases.reduce((sum, phase) => sum + phase.estimatedPayloadBytes, 0) / phases.length);
      if (phases[0].spliceArrayCalls !== undefined) {
        summary.spliceArrayCallsPerRound = phases[0].spliceArrayCalls;
        summary.payloadKind = phases[0].payloadKind;
      }
    }
    return summary;
  });
}

function getEnvironment(page) {
  const device = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
  const app = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
  return {
    model: device.model,
    system: device.system,
    platform: device.platform,
    wechatVersion: app.version,
    sdkVersion: app.SDKVersion,
    ...rendererInfo(page)
  };
}

async function runSuite(page, run, suite) {
  const highResolution = typeof performance !== 'undefined' && typeof performance.now === 'function';
  const now = highResolution ? () => performance.now() : Date.now;
  const operationColumns = suite.operationColumns || ['responseMs'];
  const scoreAggregation = suite.scoreAggregation || 'phase-geomean';
  const report = {
    protocol: suite.protocol,
    startedAt: new Date().toISOString(),
    environment: getEnvironment(page),
    clock: highResolution ? 'performance.now' : 'Date.now',
    ...(suite.metadata ? suite.metadata(page) : {}),
    warmupTarget: WARMUP_ROUNDS,
    measuredTarget: MEASURED_ROUNDS,
    warmupCompleted: 0,
    operationColumns,
    rounds: [],
    invalidRounds: []
  };

  const maxAttempts = WARMUP_ROUNDS + MEASURED_ROUNDS + EXTRA_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts && !run.reason && report.rounds.length < MEASURED_ROUNDS; attempt++) {
    const warmup = report.warmupCompleted < WARMUP_ROUNDS;
    const progress = warmup
      ? `预热 ${report.warmupCompleted + 1} / ${WARMUP_ROUNDS}`
      : `正式测量 ${report.rounds.length + 1} / ${MEASURED_ROUNDS}`;
    let currentStep = 'reset';
    const steps = [];
    try {
      await suite.prepare(page, run, progress);
      for (const step of suite.steps) {
        currentStep = step.id;
        const result = await suite.measure(page, run, step, now);
        if (run.reason) throw new Error(run.reason);
        steps.push({ id: step.id, ...result });
      }
      const phaseTimesMs = steps.map((step) => {
        if (!Number.isFinite(step.elapsedMs) || step.elapsedMs < 0 ||
          (step.elapsedMs === 0 && scoreAggregation !== 'suite-total')) {
          throw new Error('阶段耗时无效，无法计分');
        }
        return step.elapsedMs;
      });
      const scoring = scoreRound(phaseTimesMs, scoreAggregation);
      if (warmup) report.warmupCompleted++;
      else report.rounds.push({ attempt, steps, scoring });
    } catch (error) {
      report.invalidRounds.push({ attempt, warmup, step: currentStep, reason: error.message });
    }
  }

  report.finishedAt = new Date().toISOString();
  report.status = run.reason ? 'stopped' : report.rounds.length === MEASURED_ROUNDS ? 'complete' : 'incomplete';
  report.stopReason = run.reason;
  report.summary = summarize(report.rounds, suite.steps, operationColumns.indexOf('responseMs'));
  report.scoring = summarizeScores(report.rounds.map((round) => round.scoring), report.status === 'complete', scoreAggregation);
  return report;
}

module.exports = { createRunControl, waitForCallback, updatePage, measureSeries, runSuite };
