const { createRunControl, runSuite } = require('./runner');

function reportProgress(report) {
  const { status, rounds, measuredTarget, invalidRounds, stopReason } = report;
  const counts = `${rounds.length} / ${measuredTarget} 轮有效 · ${invalidRounds.length} 轮无效`;
  if (status === 'stopped') return `已停止（${stopReason}） · ${counts}`;
  if (status === 'incomplete') return `测试未达到目标轮数 · ${counts}`;
  return `测试完成 · ${counts}`;
}

function reportEnvironment(report) {
  const { configuredRenderer, renderer } = report.environment;
  const description = `配置 ${configuredRenderer} · 实际 ${renderer} · ${report.clock}`;
  return report.variant
    ? `${report.variantLabel} · ${report.updateModeLabel} · ${description} · 测试区 ${report.workloadWidthPx}px`
    : description;
}

function benchmarkPage(suite, data = {}) {
  return {
    data: {
      ready: false,
      running: false,
      progress: '',
      hasReport: false,
      reportDetails: '',
      lastError: '',
      summary: [],
      scoring: null,
      ...data
    },

    onHide() {
      if (this.run) this.run.stop('页面切入后台');
    },

    onUnload() {
      this.unloaded = true;
      if (this.run) this.run.stop('页面已卸载');
    },

    async onRun() {
      if (this.run || !this.data.ready) return;
      const run = createRunControl();
      this.run = run;
      this.report = null;
      let progress;
      let savedState;
      try {
        this.setData({ running: true, progress: '准备测试', hasReport: false, summary: [], scoring: null, reportDetails: '', lastError: '' });
        if (suite.capture) savedState = await suite.capture(this, run);
        this.report = await runSuite(this, run, suite);
        progress = reportProgress(this.report);
      } catch (error) {
        progress = run.reason ? `已停止（${run.reason}）` : `测试失败 · ${error.message}`;
      } finally {
        if (savedState && !this.unloaded) {
          try {
            await suite.restore(this, createRunControl(), savedState);
          } catch (error) {
            progress += ` · 恢复编辑内容失败：${error.message}`;
          }
        }
        this.run = null;
        if (!this.unloaded) {
          const report = this.report;
          const lastInvalidRound = report && report.invalidRounds[report.invalidRounds.length - 1];
          this.setData({
            running: false,
            progress,
            hasReport: Boolean(report),
            summary: report ? report.summary : [],
            scoring: report ? report.scoring : null,
            reportDetails: report ? reportEnvironment(report) : '',
            lastError: report && report.status === 'incomplete' && lastInvalidRound ? lastInvalidRound.reason : ''
          });
        }
      }
    },

    onStop() {
      if (this.run) this.run.stop('手动停止');
    },

    onCopyReport() {
      if (!this.report) return;
      wx.setClipboardData({
        data: JSON.stringify(this.report),
        fail: () => wx.showToast({ title: '复制结果失败', icon: 'none' })
      });
    }
  };
}

module.exports = { benchmarkPage, reportProgress, reportEnvironment };
