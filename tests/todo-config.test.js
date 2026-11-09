const assert = require('node:assert/strict');
const { test } = require('node:test');
const { todoVariant, todoMode, todoUrl, todoRuntimeInfo } = require('../miniprogram/utils/todo-config');

test('Todo variants allow three uniform and two incremental combinations with explicit route validation', () => {
  for (const [id, entry, renderer, framework] of [
    ['A', 'index', 'webview', 'exparser'],
    ['B', 'glass', 'webview', 'glass-easel'],
    ['C', 'skyline', 'skyline', 'glass-easel']
  ]) {
    assert.equal(todoVariant(id).renderer, renderer);
    assert.equal(todoVariant(id).framework, framework);
    assert.equal(todoUrl(id, 'uniform'), `/pages/todo/${entry}?mode=uniform`);
    if (id !== 'A') assert.equal(todoUrl(id, 'incremental'), `/pages/todo/${entry}?mode=incremental`);
  }
  assert.throws(() => todoUrl('A', 'incremental'), /A 不支持/);
  assert.throws(() => todoVariant('wrong'), /未知 Todo 配置/);
  assert.throws(() => todoMode('wrong', 'B'), /未知 Todo 更新模式/);
  assert.throws(() => todoMode('uniform', 'wrong'), /未知 Todo 配置/);
});

test('runtime checks report capability evidence, never an inferred actual component framework', () => {
  const native = todoRuntimeInfo({ data: { variant: 'A' }, renderer: 'webview' });
  assert.deepEqual(native, { actualRenderer: 'webview', arraySpliceAvailable: false, error: '' });
  const glass = todoRuntimeInfo({
    data: { variant: 'B' }, renderer: 'webview', spliceArrayDataOnPath() {}
  });
  assert.deepEqual(glass, { actualRenderer: 'webview', arraySpliceAvailable: true, error: '' });
  assert.match(todoRuntimeInfo({ data: { variant: 'A' } }).error, /未知/);
  assert.match(todoRuntimeInfo({ data: { variant: 'B' }, renderer: 'webview' }).error, /不可用/);
  assert.match(todoRuntimeInfo({
    data: { variant: 'C' }, renderer: 'webview', spliceArrayDataOnPath() {}
  }).error, /不一致/);
  assert.match(todoRuntimeInfo({
    data: { variant: 'A' }, renderer: 'webview', spliceArrayDataOnPath() {}
  }).error, /可能实际启用了/);
});
