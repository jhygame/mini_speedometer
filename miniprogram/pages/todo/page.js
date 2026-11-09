const { todoUpdatePlan, applyTodoUpdate } = require('../../utils/todo');
const { createRunControl, runBenchmark } = require('../../utils/benchmark');
const { reportProgress, reportEnvironment } = require('../../utils/benchmark-page');
const { todoScoreDetails } = require('../../utils/todo-score-details');
const { TODO_VARIANTS, TODO_MODES, todoVariant, todoMode, todoUrl, todoRuntimeInfo } = require('../../utils/todo-config');

module.exports = (variantId = 'A') => ({
  data: {
    variant: todoVariant(variantId).id,
    variantLabel: todoVariant(variantId).label,
    configuredComponentFramework: todoVariant(variantId).framework,
    variants: TODO_VARIANTS,
    modes: TODO_MODES,
    updateMode: 'uniform',
    configurationError: '',
    arraySpliceAvailable: false,
    ready: false,
    running: false,
    progress: '',
    draft: '',
    items: [],
    remaining: 0,
    hasReport: false,
    reportDetails: '',
    scoring: null,
    scoreDetails: null,
    showScoreDetails: false,
    summary: []
  },

  onLoad(options = {}) {
    this.nextTodoId = 0;
    this.report = null;
    try {
      const mode = todoMode(options.mode === undefined ? 'uniform' : options.mode, variantId);
      this.setData({ updateMode: mode.id });
    } catch (error) {
      this.setData({ configurationError: error.message, progress: error.message });
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  onReady() {
    const runtime = todoRuntimeInfo(this);
    const error = this.data.configurationError || runtime.error;
    this.setData({ ready: !error, arraySpliceAvailable: runtime.arraySpliceAvailable, configurationError: error, progress: error });
  },

  clearTodoReport(patch = {}) {
    this.report = null;
    this.setData({
      hasReport: false, summary: [], scoring: null, scoreDetails: null,
      showScoreDetails: false, reportDetails: '', progress: '', ...patch
    });
  },

  onVariantChange(event) {
    if (this.run || this.data.running) return;
    try {
      const target = todoVariant(event.detail.value);
      const url = todoUrl(target.id, this.data.updateMode);
      if (target.id === variantId) return;
      wx.redirectTo({
        url,
        fail: () => wx.showToast({ title: '切换 Todo 配置失败', icon: 'none' })
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  onModeChange(event) {
    if (this.run || this.data.running) return;
    try {
      const mode = todoMode(event.detail.value, variantId);
      if (mode.id !== this.data.updateMode || this.data.configurationError) {
        const runtime = todoRuntimeInfo(this);
        this.clearTodoReport({
          updateMode: mode.id, ready: !runtime.error,
          configurationError: runtime.error, progress: runtime.error
        });
      }
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
    }
  },

  onHide() {
    if (this.run) this.run.stop('页面切入后台');
  },

  onUnload() {
    this.unloaded = true;
    if (this.run) this.run.stop('页面已卸载');
  },

  onInput(event) {
    if (!this.run) this.setData({ draft: event.detail.value });
  },

  onAdd(event) {
    this.updateTodo('add', event.type === 'confirm' ? event.detail.value : this.data.draft);
  },

  onToggle(event) {
    this.updateTodo('toggle', Number(event.currentTarget.dataset.id));
  },

  onRemove(event) {
    this.updateTodo('remove', Number(event.currentTarget.dataset.id));
  },

  updateTodo(action, value) {
    if (this.run) return;
    try {
      const plan = todoUpdatePlan(this, action, value);
      if (plan) applyTodoUpdate(this, plan);
    } catch (error) {
      wx.showToast({ title: `待办更新失败：${error.message}`, icon: 'none' });
    }
  },

  async onRun() {
    if (this.run || !this.data.ready) return;
    const { items, remaining, draft } = this.data;
    const manualState = { items: items.map((item) => ({ ...item })), remaining, draft };
    const manualNextId = this.nextTodoId;
    const run = createRunControl();
    this.run = run;
    this.report = null;

    let progress;
    let scoreDetails = null;
    try {
      this.setData({
        running: true, progress: '准备测试', hasReport: false, summary: [], scoring: null,
        reportDetails: '', scoreDetails: null, showScoreDetails: false
      });
      this.report = await runBenchmark(this, run);
      scoreDetails = todoScoreDetails(this.report);
      progress = reportProgress(this.report);
    } catch (error) {
      progress = `测试失败 · ${error.message}`;
    } finally {
      this.run = null;
      this.nextTodoId = manualNextId;
      if (!this.unloaded) {
        const report = this.report;
        this.setData({
          ...manualState,
          running: false,
          progress,
          hasReport: Boolean(report),
          summary: report ? report.summary : [],
          scoring: report ? report.scoring : null,
          scoreDetails,
          reportDetails: report ? reportEnvironment(report) : ''
        });
      }
    }
  },

  onStop() {
    if (this.run) this.run.stop('手动停止');
  },

  onToggleScoreDetails() {
    if (this.run || !this.data.scoreDetails) return;
    this.setData({ showScoreDetails: !this.data.showScoreDetails });
  },

  onCopyReport() {
    if (!this.report) return;
    wx.setClipboardData({
      data: JSON.stringify(this.report),
      fail: () => wx.showToast({ title: '复制结果失败', icon: 'none' })
    });
  }
});
