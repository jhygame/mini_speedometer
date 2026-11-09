function todoUpdatePlan(page, action, value, mode = page.data.updateMode) {
  if (!['uniform', 'incremental'].includes(mode)) throw new Error('未知 Todo 更新模式');
  const { items, remaining } = page.data;

  if (action === 'add') {
    const title = value.trim();
    if (!title) return null;
    return {
      patch: {
        [`items[${items.length}]`]: { id: ++page.nextTodoId, title, done: false },
        remaining: remaining + 1,
        draft: ''
      }
    };
  }

  const index = items.findIndex((item) => item.id === value);
  if (index === -1) return null;

  const { done } = items[index];
  if (action === 'toggle') {
    return { patch: { [`items[${index}].done`]: !done, remaining: remaining + (done ? 1 : -1) } };
  }

  if (action !== 'remove') throw new Error('未知待办操作');
  const nextRemaining = remaining - (done ? 0 : 1);
  if (mode === 'uniform') {
    const nextItems = items.slice();
    nextItems.splice(index, 1);
    return { patch: { items: nextItems, remaining: nextRemaining } };
  }
  return {
    patch: { remaining: nextRemaining },
    splice: { path: ['items'], index, deleteCount: 1, inserts: [] }
  };
}

function assertIncrementalTodo(page) {
  if (typeof page.spliceArrayDataOnPath !== 'function') {
    throw new Error('数组增量更新不可用，请使用 glass-easel；WebView 基础库需至少 3.8.12');
  }
}

function applyTodoUpdate(page, plan, callback) {
  if (plan.splice) {
    assertIncrementalTodo(page);
    const { path, index, deleteCount, inserts } = plan.splice;
    page.spliceArrayDataOnPath(path, index, deleteCount, inserts);
  }
  // setData applies the staged splice and the count together, and confirms rendering via its callback.
  page.setData(plan.patch, callback);
}

module.exports = { todoUpdatePlan, applyTodoUpdate, assertIncrementalTodo };
