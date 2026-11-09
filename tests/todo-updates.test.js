const assert = require('node:assert/strict');
const { test } = require('node:test');
const { todoUpdatePlan, applyTodoUpdate } = require('../miniprogram/utils/todo');
const createTodoPage = require('../miniprogram/pages/todo/page');

function fixture() {
  const page = {
    data: { items: [
      { id: 1, title: 'Open', done: false },
      { id: 2, title: 'Done', done: true },
      { id: 3, title: 'Last', done: false }
    ], remaining: 2, draft: '', updateMode: 'incremental' },
    nextTodoId: 3,
    pending: [],
    calls: [],
    spliceArrayDataOnPath(path, index, deleteCount, inserts) {
      this.calls.push({ api: 'splice', path, index, deleteCount, inserts });
      this.pending.push({ index, deleteCount, inserts });
    },
    setData(patch, callback) {
      this.calls.push({ api: 'setData', patch });
      this.pending.splice(0).forEach(({ index, deleteCount, inserts }) => {
        this.data.items.splice(index, deleteCount, ...inserts);
      });
      for (const [key, value] of Object.entries(patch)) {
        const match = /^items\[(\d+)\](\.done)?$/.exec(key);
        if (!match) this.data[key] = value;
        else if (match[2]) this.data.items[Number(match[1])].done = value;
        else this.data.items[Number(match[1])] = value;
      }
      if (callback) callback();
    }
  };
  return page;
}

test('deleting an active or completed middle item sends only one splice and the correct count', () => {
  for (const [id, expectedRemaining] of [[1, 1], [2, 2], [3, 1]]) {
    const page = fixture();
    const items = page.data.items;
    const before = JSON.stringify(items);
    const plan = todoUpdatePlan(page, 'remove', id);
    assert.equal(JSON.stringify(items), before);
    assert.deepEqual(plan.patch, { remaining: expectedRemaining });
    assert.equal(plan.splice.index, id - 1);
    let completed = false;
    applyTodoUpdate(page, plan, () => { completed = true; });
    assert.equal(completed, true);
    assert.equal(page.data.items, items);
    assert.deepEqual(page.data.items.map((item) => item.id), [1, 2, 3].filter((value) => value !== id));
    assert.equal(page.data.remaining, expectedRemaining);
    assert.deepEqual(page.calls.map((call) => call.api), ['splice', 'setData']);
    assert.deepEqual(page.calls[1].patch, { remaining: expectedRemaining });
  }
});

test('addition and toggling preserve path setData updates and never use splice', () => {
  const page = fixture();
  applyTodoUpdate(page, todoUpdatePlan(page, 'add', ' New item '));
  assert.deepEqual(page.data.items[3], { id: 4, title: 'New item', done: false });
  assert.equal(page.data.remaining, 3);
  applyTodoUpdate(page, todoUpdatePlan(page, 'toggle', 2));
  assert.equal(page.data.items[1].done, false);
  assert.equal(page.data.remaining, 4);
  assert.ok(page.calls.every((call) => call.api === 'setData'));
  assert.equal(todoUpdatePlan(page, 'add', '  '), null);
  assert.equal(todoUpdatePlan(page, 'remove', 999), null);
});

test('manual Todo removal uses incremental deletion, preserves empty state and explicitly reports unsupported APIs', () => {
  const previousWx = global.wx;
  const messages = [];
  global.wx = { showToast: (options) => messages.push(options) };
  try {
    const page = Object.assign(fixture(), createTodoPage('B'));
    page.data = fixture().data;
    page.onRemove({ currentTarget: { dataset: { id: '2' } } });
    assert.deepEqual(page.data.items.map((item) => item.id), [1, 3]);
    assert.equal(page.data.remaining, 2);
    page.updateTodo('remove', 1);
    page.updateTodo('remove', 3);
    assert.deepEqual(page.data.items, []);
    assert.equal(page.data.remaining, 0);

    const unsupported = fixture();
    Object.assign(unsupported, { updateTodo: createTodoPage('B').updateTodo });
    delete unsupported.spliceArrayDataOnPath;
    const original = JSON.stringify(unsupported.data);
    unsupported.updateTodo('remove', 1);
    assert.equal(JSON.stringify(unsupported.data), original);
    assert.deepEqual(unsupported.calls, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0].title, /数组增量更新不可用/);
    assert.equal(messages[0].icon, 'none');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('uniform deletion uses a copied remaining array and never requires glass-easel', () => {
  const page = fixture();
  page.data.updateMode = 'uniform';
  delete page.spliceArrayDataOnPath;
  const before = page.data.items;
  const plan = todoUpdatePlan(page, 'remove', 2);
  assert.equal(plan.splice, undefined);
  assert.notEqual(plan.patch.items, before);
  assert.deepEqual(plan.patch.items.map((item) => item.id), [1, 3]);
  applyTodoUpdate(page, plan);
  assert.equal(page.data.remaining, 2);
  assert.deepEqual(page.calls.map((call) => call.api), ['setData']);
  assert.throws(() => todoUpdatePlan(page, 'remove', 1, 'wrong'), /更新模式/);
});

test('manual add, toggle and delete converge to the same result across all five variant/mode combinations', () => {
  for (const [variant, mode] of [
    ['A', 'uniform'], ['B', 'uniform'], ['C', 'uniform'],
    ['B', 'incremental'], ['C', 'incremental']
  ]) {
    const page = Object.assign(fixture(), createTodoPage(variant));
    page.data = fixture().data;
    page.data.updateMode = mode;
    if (variant === 'A') delete page.spliceArrayDataOnPath;
    page.onInput({ detail: { value: ' New todo ' } });
    page.onAdd({ type: 'tap' });
    assert.equal(page.data.items[3].title, 'New todo');
    page.onToggle({ currentTarget: { dataset: { id: '2' } } });
    page.onToggle({ currentTarget: { dataset: { id: '1' } } });
    page.run = {};
    page.onRemove({ currentTarget: { dataset: { id: '2' } } });
    assert.equal(page.data.items.length, 4);
    page.run = null;
    for (const id of [2, 3, 1, 4]) page.onRemove({ currentTarget: { dataset: { id: String(id) } } });
    assert.deepEqual(page.data.items, []);
    assert.equal(page.data.remaining, 0);
    assert.equal(page.calls.filter((call) => call.api === 'splice').length, mode === 'incremental' ? 4 : 0);
    assert.equal(page.calls.filter((call) => call.api === 'setData').length, 8);
  }
});
