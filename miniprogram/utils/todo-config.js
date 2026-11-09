const TODO_VARIANTS = [
  { id: 'A', label: 'A · WebView + exparser', renderer: 'webview', framework: 'exparser', entry: 'index' },
  { id: 'B', label: 'B · WebView + glass-easel', renderer: 'webview', framework: 'glass-easel', entry: 'glass' },
  { id: 'C', label: 'C · Skyline + glass-easel', renderer: 'skyline', framework: 'glass-easel', entry: 'skyline' }
];
const TODO_MODES = [
  { id: 'uniform', label: '统一 setData（主基准）' },
  { id: 'incremental', label: '增量删除（B/C 扩展）' }
];
const WORKLOAD_WIDTH_PX = 320;

function todoVariant(id) {
  const variant = TODO_VARIANTS.find((item) => item.id === id);
  if (!variant) throw new Error('未知 Todo 配置');
  return variant;
}

function todoMode(id, variantId) {
  const variant = todoVariant(variantId);
  const mode = TODO_MODES.find((item) => item.id === id);
  if (!mode) throw new Error('未知 Todo 更新模式');
  if (mode.id === 'incremental' && variant.framework !== 'glass-easel') {
    throw new Error('A 不支持增量删除，请先选择统一 setData');
  }
  return mode;
}

function todoUrl(variantId, modeId) {
  const variant = todoVariant(variantId);
  todoMode(modeId, variantId);
  return `/pages/todo/${variant.entry}?mode=${modeId}`;
}

function todoRuntimeInfo(page) {
  const variant = todoVariant(page.data.variant);
  const actualRenderer = page.renderer || 'unknown';
  const arraySpliceAvailable = typeof page.spliceArrayDataOnPath === 'function';
  let error = '';
  if (actualRenderer === 'unknown') error = '实际渲染器未知，无法验证 A/B/C 配置';
  else if (actualRenderer !== variant.renderer) error = '配置与实际渲染器不一致，不能记录为所选 A/B/C 结果';
  else if (variant.framework === 'glass-easel' && !arraySpliceAvailable) {
    error = '数组增量更新不可用，请检查 glass-easel；WebView 基础库需至少 3.8.12';
  } else if (variant.framework === 'exparser' && arraySpliceAvailable) {
    error = 'A 配置检测到增量接口，可能实际启用了 glass-easel，不能记录为 exparser 结果';
  }
  return { actualRenderer, arraySpliceAvailable, error };
}

module.exports = { TODO_VARIANTS, TODO_MODES, WORKLOAD_WIDTH_PX, todoVariant, todoMode, todoUrl, todoRuntimeInfo };
