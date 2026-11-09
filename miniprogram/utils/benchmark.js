const { todoUpdatePlan, applyTodoUpdate } = require('./todo');
const { createRunControl, waitForCallback, updatePage, runSuite } = require('./runner');
const { WORKLOAD_WIDTH_PX, todoVariant, todoMode, todoRuntimeInfo } = require('./todo-config');

const ITEM_COUNT = 100;
const TITLES = Array.from({ length: ITEM_COUNT }, (_, i) =>
  `Benchmark todo ${String(i + 1).padStart(3, '0')}`
);
const STEPS = [
  { id: 'Adding100Items', label: '新增 100 项', action: 'add', size: ITEM_COUNT, remaining: ITEM_COUNT },
  { id: 'CompletingAllItems', label: '完成全部', action: 'toggle', size: ITEM_COUNT, remaining: 0 },
  { id: 'DeletingAllItems', label: '删除全部', action: 'remove', size: 0, remaining: 0 }
];

function utf8Size(text) {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}

async function verifyStep(page, run, step) {
  const { items, remaining } = page.data;
  const done = step.action === 'toggle';
  if (items.length !== step.size || remaining !== step.remaining ||
      items.some((item, i) => item.id !== i + 1 || item.title !== TITLES[i] || item.done !== done)) {
    throw new Error('逻辑层待办状态与预期不符');
  }

  const [rows, count, empty, workload] = await waitForCallback(run, '读取待办视图', (finish) => {
    const query = wx.createSelectorQuery();
    query.selectAll('.todo-row').fields({ dataset: true });
    query.select('.todo-count').fields({ dataset: true });
    query.select('.todo-empty').fields({ id: true });
    query.select('.todo-workload').boundingClientRect();
    query.exec(finish);
  });
  if (!Array.isArray(rows) || rows.length !== step.size ||
      !count || Number(count.dataset.remaining) !== step.remaining ||
      Boolean(empty) !== (step.size === 0) ||
      rows.some((row, i) => Number(row.dataset.id) !== i + 1 ||
        row.dataset.state !== (done ? 'done' : 'open'))) {
    throw new Error('视图层待办状态与预期不符');
  }
  if (!workload || !Number.isFinite(workload.width) || Math.abs(workload.width - WORKLOAD_WIDTH_PX) > 0.5) {
    throw new Error('待办测试区域宽度与固定负载不符');
  }
}

async function measureStep(page, run, step, now, mode) {
  const updates = [];
  await waitForCallback(run, '等待步骤调度', (finish) => setTimeout(finish, 0));
  let syncStart;
  let syncEnd;
  await waitForCallback(run, '等待批量 setData 回调', (finish) => {
    let completed = 0;
    let submitted = false;
    syncStart = now();
    for (let i = 0; i < ITEM_COUNT; i++) {
      let value = i + 1;
      if (step.action === 'add') value = TITLES[i];
      if (step.action === 'remove') value = ITEM_COUNT - i;
      const plan = todoUpdatePlan(page, step.action, value, mode);
      if (!plan) throw new Error(`第 ${i + 1} 次操作无法更新待办`);
      applyTodoUpdate(page, plan, () => {
        completed++;
        if (submitted && completed === ITEM_COUNT) finish();
      });
      updates.push(plan);
    }
    syncEnd = now();
    submitted = true;
    if (completed === ITEM_COUNT) finish();
  });
  await waitForCallback(run, '等待视图更新周期', (finish) => wx.nextTick(finish));
  const asyncEnd = await waitForCallback(run, '读取待办布局', (finish, fail) => {
    wx.createSelectorQuery().select('.screen').boundingClientRect((rect) => {
      const ended = now();
      if (!rect || !Number.isFinite(rect.height)) fail('待办布局不可用');
      else finish(ended);
    }).exec();
  });
  if (!(syncStart <= syncEnd && syncEnd <= asyncEnd)) {
    throw new Error('计时时钟或回调顺序异常');
  }

  await verifyStep(page, run, step);
  return {
    id: step.id,
    syncMs: syncEnd - syncStart,
    asyncMs: asyncEnd - syncEnd,
    elapsedMs: (syncEnd - syncStart) + (asyncEnd - syncEnd),
    setDataCalls: updates.length,
    spliceArrayCalls: updates.filter((plan) => plan.splice).length,
    payloadKind: step.action === 'remove' && mode === 'incremental' ? 'splice+setData-descriptor' : 'setData-patch',
    estimatedPayloadBytes: updates.reduce((total, plan) =>
      total + utf8Size(JSON.stringify(plan.splice ? plan : plan.patch)), 0)
  };
}

function runBenchmark(page, run) {
  if (page.data.configurationError) throw new Error(page.data.configurationError);
  const variant = todoVariant(page.data.variant);
  const mode = todoMode(page.data.updateMode, variant.id);
  const runtime = todoRuntimeInfo(page);
  if (runtime.error) throw new Error(runtime.error);
  return runSuite(page, run, {
    protocol: 'native-todo-v4',
    scoreAggregation: 'suite-total',
    metadata: () => ({
      itemCount: ITEM_COUNT,
      measurementGranularity: 'step',
      execution: 'batched-business-calls',
      variant: variant.id,
      variantLabel: variant.label,
      configuredComponentFramework: variant.framework,
      frameworkEvidence: { arraySpliceAvailable: runtime.arraySpliceAvailable },
      updateMode: mode.id,
      updateModeLabel: mode.label,
      comparisonGroup: `todo-abc-v1/${mode.id}`,
      workloadWidthPx: WORKLOAD_WIDTH_PX,
      navigationStyle: 'custom',
      deletionUpdate: mode.id === 'incremental' ? 'spliceArrayDataOnPath+setData' : 'setData-full-array',
      payloadEstimation: 'utf8-json-update-descriptors-not-wire-bytes',
      completionBoundary: 'setData-callbacks+wx.nextTick+boundingClientRect'
    }),
    operationColumns: [],
    steps: STEPS,
    measure: (target, control, step, now) => measureStep(target, control, step, now, mode.id),
    prepare(target, control, progress) {
      target.nextTodoId = 0;
      return updatePage(target, control, { draft: '', items: [], remaining: 0, progress });
    }
  });
}

module.exports = { createRunControl, runBenchmark };
