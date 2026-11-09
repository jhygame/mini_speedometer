const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRunControl, runBenchmark } = require('../miniprogram/utils/benchmark');
const createTodoPage = require('../miniprogram/pages/todo/page');
const { rendererComponent } = require('../miniprogram/utils/renderer-page');
const { todoVariant } = require('../miniprogram/utils/todo-config');

async function fixture(options = {}) {
  const previousWx = global.wx;
  const run = createRunControl();
  const pending = [];
  let submitted = 0;
  let batches = 0;
  let layouts = 0;
  let ticks = 0;
  const detailUpdates = [];
  const splices = [];
  const stagedSplices = [];
  const submissions = [];
  const variantId = options.variant || (options.renderer === 'skyline' ? 'C' : 'B');
  const variant = todoVariant(variantId);
  const renderer = options.renderer || variant.renderer;
  const mode = options.mode || 'incremental';
  const messages = [];
  const navigations = [];
  const definition = rendererComponent(createTodoPage(variantId), 'todo', variant.renderer);
  const page = {
    ...definition.methods,
    data: definition.data,
    renderer,
    spliceArrayDataOnPath(path, index, deleteCount, inserts) {
      assert.deepEqual(path, ['items']);
      assert.equal(deleteCount, 1);
      assert.deepEqual(inserts, []);
      assert.equal(stagedSplices.length, 0);
      assert.ok(index >= 0 && index < this.data.items.length);
      stagedSplices.push({ path, index, deleteCount, inserts });
      splices.push(index);
    },
    setData(patch, callback) {
      if ('scoreDetails' in patch) {
        detailUpdates.push({ batches, hasDetails: Boolean(patch.scoreDetails) });
        if (patch.scoreDetails) assert.equal(this.run, null);
      }
      const splice = stagedSplices.shift();
      if (splice) {
        assert.deepEqual(Object.keys(patch), ['remaining']);
        this.data.items.splice(splice.index, splice.deleteCount, ...splice.inserts);
      }
      for (const [key, value] of Object.entries(patch)) {
        const path = /^items\[(\d+)\](\.done)?$/.exec(key);
        if (!path) this.data[key] = value;
        else if (path[2]) this.data.items[Number(path[1])].done = value;
        else this.data.items[Number(path[1])] = value;
      }
      if (!callback) return;
      if ('progress' in patch) {
        setImmediate(callback);
        return;
      }
      submissions.push({
        patch: JSON.parse(JSON.stringify(patch)),
        splice: splice && JSON.parse(JSON.stringify(splice))
      });
      submitted++;
      if (options.synchronousCallbacks) {
        callback();
        if (submitted === 100) {
          batches++;
          submitted = 0;
        }
        return;
      }
      pending.push(callback);
      if (submitted === 100) {
        batches++;
        setImmediate(() => {
          assert.equal(submitted, 100);
          submitted = 0;
          const callbacks = pending.splice(0).reverse();
          if (options.changeModeAtBatch === batches) page.data.updateMode = 'uniform';
          if (options.stop || options.stopAtBatch === batches) (page.run || run).stop('test stop');
          callbacks.forEach((finish) => finish());
        });
      }
    }
  };
  if (options.missingSplice || (variantId === 'A' && !options.forceSplice)) delete page.spliceArrayDataOnPath;
  global.wx = {
    getDeviceInfo: () => ({ model: 'test' }),
    getAppBaseInfo: () => ({ version: 'test', SDKVersion: 'test' }),
    showToast: (message) => messages.push(message),
    redirectTo: (navigation) => navigations.push(navigation),
    nextTick(callback) {
      assert.equal(pending.length, 0);
      ticks++;
      setImmediate(callback);
    },
    createSelectorQuery() {
      const query = {
        selectAll() { return this; },
        select() { return this; },
        fields() { return this; },
        boundingClientRect(callback) {
          if (callback) this.layoutCallback = callback;
          return this;
        },
        exec(callback) {
          setImmediate(() => {
            if (this.layoutCallback) {
              assert.equal(ticks, layouts + 1);
              layouts++;
              this.layoutCallback(options.missingLayout ? null : { height: 600 });
            } else {
              callback([
                page.data.items.map((item) => ({ dataset: { id: item.id, state: item.done ? 'done' : 'open' } })),
                { dataset: { remaining: page.data.remaining } },
                page.data.items.length ? null : { id: 'todo-empty' },
                { width: options.workloadWidth === undefined ? 320 : options.workloadWidth }
              ]);
            }
          });
        }
      };
      return query;
    }
  };
  try {
    page.onLoad(options.loadOptions || { mode });
    page.onReady();
    if (options.exercisePage) {
      await options.exercisePage(page, { messages, navigations });
      return { report: page.report, batches, layouts, ticks, detailUpdates, splices, submissions, messages, navigations };
    }
    return { report: await runBenchmark(page, run), batches, layouts, ticks, splices, submissions };
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
}

test('Todo submits entire steps before callbacks and measures Sync plus Async once per step', async () => {
  const { report, batches, layouts, ticks, splices, submissions } = await fixture();
  assert.equal(report.status, 'complete');
  assert.equal(batches, 36);
  assert.equal(layouts, batches);
  assert.equal(ticks, batches);
  assert.equal(report.protocol, 'native-todo-v4');
  assert.equal(report.variant, 'B');
  assert.equal(report.configuredComponentFramework, 'glass-easel');
  assert.deepEqual(report.frameworkEvidence, { arraySpliceAvailable: true });
  assert.equal(report.updateMode, 'incremental');
  assert.equal(report.comparisonGroup, 'todo-abc-v1/incremental');
  assert.equal(report.deletionUpdate, 'spliceArrayDataOnPath+setData');
  assert.equal(report.measurementGranularity, 'step');
  assert.equal(report.scoring.aggregation, 'suite-total');
  assert.equal(report.scoring.protocol, 'native-score-v3');
  assert.deepEqual(report.operationColumns, []);
  for (const round of report.rounds) {
    assert.equal(round.steps.length, 3);
    assert.equal(round.scoring.suiteTotalMs, round.steps.reduce((sum, step) => sum + step.elapsedMs, 0));
    assert.equal(round.scoring.score, 1000 / round.scoring.suiteTotalMs);
    for (const step of round.steps) {
      assert.equal(step.setDataCalls, 100);
      assert.equal(step.spliceArrayCalls, step.id === 'DeletingAllItems' ? 100 : 0);
      assert.equal(step.elapsedMs, step.syncMs + step.asyncMs);
      assert.ok(step.syncMs >= 0);
      assert.ok(step.asyncMs > 0);
      assert.equal(step.operations, undefined);
    }
  }
  assert.equal(splices.length, 1200);
  for (let round = 0; round < 12; round++) {
    assert.deepEqual(splices.slice(round * 100, (round + 1) * 100), Array.from({ length: 100 }, (_, i) => 99 - i));
    const updates = submissions.slice(round * 300, (round + 1) * 300);
    assert.ok(updates.slice(0, 200).every((update) => !update.splice));
    assert.ok(updates.slice(200).every((update) => update.splice && !('items' in update.patch)));
    if (round >= 2) {
      const deletion = report.rounds[round - 2].steps[2];
      const estimate = updates.slice(200).reduce((sum, update) =>
        sum + Buffer.byteLength(JSON.stringify({ patch: update.patch, splice: update.splice }), 'utf8'), 0);
      assert.equal(deletion.estimatedPayloadBytes, estimate);
      assert.ok(estimate < 12000, `Deletion descriptors unexpectedly large: ${estimate}`);
      assert.equal(deletion.payloadKind, 'splice+setData-descriptor');
    }
  }
  assert.equal(report.summary[2].spliceArrayCallsPerRound, 100);
  assert.equal(report.summary[0].spliceArrayCallsPerRound, 0);
  for (const summary of report.summary) {
    assert.equal(summary.sampleCount, 10);
    assert.equal(typeof summary.syncMedianMs, 'string');
    assert.equal(typeof summary.asyncMedianMs, 'string');
    assert.equal(summary.responseP50Ms, undefined);
  }
});

test('uniform ABC runs submit exactly identical primary workloads and use no incremental API', async () => {
  let primarySubmissions;
  for (const variant of ['A', 'B', 'C']) {
    const { report, submissions, splices, batches, layouts } = await fixture({ variant, mode: 'uniform' });
    assert.equal(report.status, 'complete');
    assert.equal(report.variant, variant);
    assert.equal(report.updateMode, 'uniform');
    assert.equal(report.comparisonGroup, 'todo-abc-v1/uniform');
    assert.equal(report.deletionUpdate, 'setData-full-array');
    assert.equal(report.workloadWidthPx, 320);
    assert.equal(report.navigationStyle, 'custom');
    assert.equal(batches, 36);
    assert.equal(layouts, 36);
    assert.deepEqual(splices, []);
    if (primarySubmissions) assert.deepEqual(submissions, primarySubmissions);
    else primarySubmissions = submissions;
    for (const round of report.rounds) {
      assert.equal(round.scoring.score, 1000 / round.scoring.suiteTotalMs);
      assert.equal(round.steps[0].estimatedPayloadBytes, 9074);
      assert.equal(round.steps[1].estimatedPayloadBytes, 3780);
      assert.equal(round.steps[2].estimatedPayloadBytes, 254096);
      assert.ok(round.steps.every((step) => step.spliceArrayCalls === 0 && step.setDataCalls === 100));
      assert.equal(round.steps[2].payloadKind, 'setData-patch');
    }
  }
});

test('both BC incremental runs retain the smaller deletion workload and separate comparison group', async () => {
  for (const variant of ['B', 'C']) {
    const { report, splices } = await fixture({ variant, mode: 'incremental' });
    assert.equal(report.status, 'complete');
    assert.equal(report.comparisonGroup, 'todo-abc-v1/incremental');
    assert.equal(splices.length, 1200);
    assert.ok(report.rounds.every((round) => round.steps[2].estimatedPayloadBytes === 9290));
  }
});

test('configuration mismatches, invalid modes and A incremental URLs cannot generate results', async () => {
  for (const options of [
    { variant: 'A', mode: 'incremental' },
    { variant: 'A', mode: 'uniform', forceSplice: true },
    { variant: 'C', mode: 'uniform', renderer: 'webview' },
    { variant: 'B', mode: 'uniform', renderer: 'unknown' },
    { variant: 'B', mode: 'uniform', missingSplice: true },
    { variant: 'B', loadOptions: { mode: 'wrong' } }
  ]) {
    const { batches } = await fixture({
      ...options,
      async exercisePage(page) {
        assert.equal(page.data.ready, false);
        assert.ok(page.data.configurationError);
        await page.onRun();
        assert.equal(page.report, null);
        assert.equal(page.data.hasReport, false);
        assert.equal(page.data.scoring, null);
        assert.throws(() => runBenchmark(page, createRunControl()));
      }
    });

    assert.equal(batches, 0);
  }
});

test('the benchmark freezes its selected mode rather than reading mutable page data during measurement', async () => {
  const { report, splices } = await fixture({ mode: 'incremental', changeModeAtBatch: 1 });
  assert.equal(report.updateMode, 'incremental');
  assert.equal(report.status, 'complete');
  assert.equal(splices.length, 1200);
  assert.ok(report.rounds.every((round) => round.steps[2].estimatedPayloadBytes === 9290));
});

test('all entries default to uniform, and an invalid incoming mode can be corrected explicitly', async () => {
  for (const variant of ['A', 'B', 'C']) {
    await fixture({
      variant, loadOptions: {},
      async exercisePage(page) {
        assert.equal(page.data.updateMode, 'uniform');
        assert.equal(page.data.ready, true);
      }
    });
  }
  await fixture({
    variant: 'B', loadOptions: { mode: 'invalid' },
    async exercisePage(page) {
      assert.equal(page.data.ready, false);
      page.onModeChange({ detail: { value: 'uniform' } });
      assert.equal(page.data.ready, true);
      assert.equal(page.data.configurationError, '');
      await page.onRun();
      assert.equal(page.report.status, 'complete');
      assert.equal(page.report.updateMode, 'uniform');
    }
  });
});

test('a workload-width mismatch invalidates measurements instead of producing a comparable score', async () => {
  const { report } = await fixture({ mode: 'uniform', workloadWidth: 300 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.rounds.length, 0);
  assert.match(report.invalidRounds[0].reason, /宽度/);
});

test('mode switching clears only the report, preserves manual state and is disabled during a run', async () => {
  await fixture({
    variant: 'B', mode: 'uniform',
    async exercisePage(page) {
      const saved = { items: [{ id: 77, title: 'Saved', done: true }], remaining: 0, draft: 'Draft' };
      page.setData(saved);
      page.nextTodoId = 77;
      await page.onRun();
      assert.match(page.data.reportDetails, /B · WebView \+ glass-easel/);
      assert.match(page.data.reportDetails, /统一 setData/);
      page.onToggleScoreDetails();
      page.onModeChange({ detail: { value: 'incremental' } });
      assert.equal(page.data.updateMode, 'incremental');
      assert.equal(page.report, null);
      assert.equal(page.data.hasReport, false);
      assert.equal(page.data.scoreDetails, null);
      assert.equal(page.data.showScoreDetails, false);
      assert.deepEqual(page.data.items, saved.items);
      assert.equal(page.data.draft, saved.draft);
      assert.equal(page.nextTodoId, 77);
      page.run = {};
      page.onModeChange({ detail: { value: 'uniform' } });
      assert.equal(page.data.updateMode, 'incremental');
      page.run = null;
      page.data.running = true;
      page.onModeChange({ detail: { value: 'uniform' } });
      assert.equal(page.data.updateMode, 'incremental');
      page.data.running = false;
      await page.onRun();
      assert.equal(page.report.updateMode, 'incremental');
      assert.match(page.data.reportDetails, /增量删除/);
      page.onModeChange({ detail: { value: 'uniform' } });
      assert.equal(page.data.updateMode, 'uniform');
    }
  });
});

test('variant switching preserves the mode, reports failures and never silently substitutes A incremental', async () => {
  const { navigations, messages } = await fixture({
    variant: 'B', mode: 'incremental',
    async exercisePage(page, { navigations }) {
      page.onVariantChange({ detail: { value: 'A' } });
      page.onVariantChange({ detail: { value: 'C' } });
      navigations[0].fail();
      page.onVariantChange({ detail: { value: 'invalid' } });
      page.run = {};
      page.onVariantChange({ detail: { value: 'C' } });
      page.run = null;
      page.data.running = true;
      page.onVariantChange({ detail: { value: 'C' } });
    }
  });
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/todo/skyline?mode=incremental');
  assert.match(messages[0].title, /A 不支持/);
  assert.match(messages[1].title, /切换 Todo 配置失败/);
  assert.match(messages[2].title, /未知 Todo 配置/);
});

test('incremental deletion completion handles synchronous callbacks without waiting forever', async () => {
  const { report, splices } = await fixture({ synchronousCallbacks: true });
  assert.equal(report.status, 'complete');
  assert.equal(report.rounds.length, 10);
  assert.equal(splices.length, 1200);
});

test('missing incremental capability fails before measurement instead of falling back to full arrays', async () => {
  const { batches, submissions } = await fixture({
    missingSplice: true,
    async exercisePage(page) {
      await page.onRun();
      assert.equal(page.report, null);
      assert.equal(page.data.hasReport, false);
      assert.match(page.data.progress, /数组增量更新不可用/);
      assert.match(page.data.progress, /3.8.12/);
    }
  });
  assert.equal(batches, 0);
  assert.deepEqual(submissions, []);
});

test('stopping during deletion does not record a partial round', async () => {
  const { report, splices, layouts } = await fixture({
    stopAtBatch: 3,
    async exercisePage(page) { await page.onRun(); }
  });
  assert.equal(report.status, 'stopped');
  assert.equal(report.rounds.length, 0);
  assert.equal(splices.length, 100);
  assert.equal(layouts, 2);
});

test('Todo stops while waiting for batch callbacks without recording a partial step', async () => {
  const { report, layouts } = await fixture({ stop: true });
  assert.equal(report.status, 'stopped');
  assert.equal(report.rounds.length, 0);
  assert.equal(layouts, 0);
  assert.equal(report.scoring.mean, null);
});

test('Todo rejects an unavailable layout instead of scoring callback completion alone', async () => {
  const { report } = await fixture({ missingLayout: true });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.invalidRounds.length, 15);
  assert.equal(report.rounds.length, 0);
  assert.match(report.invalidRounds[0].reason, /布局不可用/);
});

test('both Todo renderers publish calculations only after measurement, restore manual state and reset details on rerun', async () => {
  for (const renderer of ['webview', 'skyline']) {
    const result = await fixture({
      renderer,
      async exercisePage(page) {
        const manualState = { items: [{ id: 77, title: 'Saved todo', done: true }], remaining: 0, draft: 'Saved draft' };
        page.setData(manualState);
        page.nextTodoId = 77;
        page.onToggleScoreDetails();
        assert.equal(page.data.showScoreDetails, false);

        await page.onRun();
        assert.equal(page.report.status, 'complete');
        assert.equal(page.report.environment.renderer, renderer);
        assert.equal(page.data.scoreDetails.sampleCount, 10);
        assert.equal(page.data.scoreDetails.rounds.length, 10);
        assert.equal(page.data.scoreDetails.confidenceLines.length, 8);
        assert.equal(page.data.showScoreDetails, false);
        assert.deepEqual(page.data.items, manualState.items);
        assert.equal(page.data.remaining, manualState.remaining);
        assert.equal(page.data.draft, manualState.draft);
        assert.equal(page.nextTodoId, 77);

        const originalReport = JSON.stringify(page.report);
        page.onToggleScoreDetails();
        assert.equal(page.data.showScoreDetails, true);
        assert.equal(JSON.stringify(page.report), originalReport);
        page.run = {};
        page.onToggleScoreDetails();
        assert.equal(page.data.showScoreDetails, true);
        page.run = null;
        page.onToggleScoreDetails();
        assert.equal(page.data.showScoreDetails, false);
        page.onToggleScoreDetails();

        const firstDetails = page.data.scoreDetails;
        await page.onRun();
        assert.equal(page.data.showScoreDetails, false);
        assert.notEqual(page.data.scoreDetails, firstDetails);
        assert.equal(page.data.scoreDetails.rounds[0].attempt, 3);
        assert.deepEqual(page.data.items, manualState.items);
        assert.equal(page.nextTodoId, 77);
      }
    });
    assert.equal(result.batches, 72);
    assert.equal(result.layouts, 72);
    assert.deepEqual(result.detailUpdates, [
      { batches: 0, hasDetails: false },
      { batches: 36, hasDetails: true },
      { batches: 36, hasDetails: false },
      { batches: 72, hasDetails: true }
    ]);
  }
});

test('stopped Todo pages explain empty and single-round provisional scores', async () => {
  for (const stopAtBatch of [1, 10]) {
    await fixture({
      stopAtBatch,
      async exercisePage(page) {
        await page.onRun();
        const samples = stopAtBatch === 1 ? 0 : 1;
        assert.equal(page.report.status, 'stopped');
        assert.equal(page.data.scoreDetails.sampleCount, samples);
        assert.equal(page.data.scoreDetails.rounds.length, samples);
        assert.equal(page.data.scoring.complete, false);
        assert.deepEqual(page.data.scoreDetails.confidenceLines, []);
        assert.match(page.data.scoreDetails.meanTitle, /临时/);
        page.onToggleScoreDetails();
        assert.equal(page.data.showScoreDetails, true);
      }
    });
  }
});

test('a failed Todo rerun cannot leave previous calculations visible', async () => {
  await fixture({
    async exercisePage(page) {
      await page.onRun();
      page.onToggleScoreDetails();
      assert.equal(page.data.showScoreDetails, true);
      global.wx.getDeviceInfo = () => { throw new Error('test environment failure'); };
      await page.onRun();
      assert.equal(page.data.hasReport, false);
      assert.equal(page.data.scoreDetails, null);
      assert.equal(page.data.showScoreDetails, false);
      assert.match(page.data.progress, /test environment failure/);
      page.onToggleScoreDetails();
      assert.equal(page.data.showScoreDetails, false);
    }
  });
});