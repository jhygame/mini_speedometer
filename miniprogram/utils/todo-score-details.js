function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error('计分计算过程包含无效数值');
  const magnitude = Math.abs(value);
  return magnitude !== 0 && (magnitude < 0.0001 || magnitude >= 1e8)
    ? value.toExponential(3) : value.toFixed(4);
}

function todoScoreDetails(report) {
  const { scoring, rounds, summary } = report;
  if (scoring.aggregation !== 'suite-total' || !scoring.calculation) {
    throw new Error('Todo 计分计算过程缺少套件汇总数据');
  }
  const { sampleCount, calculation } = scoring;
  const confidenceLines = [];
  if (scoring.delta !== null) {
    confidenceLines.push(
      `离差平方和 Q = Σ(Si - 平均分)² ≈ ${formatNumber(calculation.squaredDeviationSum)}`,
      `样本方差 s² = Q / (n - 1) ≈ ${formatNumber(calculation.squaredDeviationSum)} / ${sampleCount - 1} ≈ ${formatNumber(calculation.variance)}`,
      `标准差 s = √s² ≈ ${formatNumber(calculation.standardDeviation)}`,
      `自由度 = ${calculation.degreesOfFreedom}，t(0.975, ${calculation.degreesOfFreedom}) = ${calculation.tCritical}`,
      `标准误 SE = s / √n ≈ ${formatNumber(calculation.standardDeviation)} / √${sampleCount} ≈ ${formatNumber(calculation.standardError)}`,
      `半宽 Δ = t × SE ≈ ${calculation.tCritical} × ${formatNumber(calculation.standardError)} ≈ ${formatNumber(scoring.delta)}`,
      `95% 置信区间 = 平均分 ± Δ ≈ [${formatNumber(calculation.lowerBound)}, ${formatNumber(calculation.upperBound)}]`,
      `相对半宽 = Δ / 平均分 × 100% ≈ ${formatNumber(scoring.percentDelta)}%`
    );
  }
  return {
    protocol: `${report.protocol} / ${scoring.protocol}`,
    sampleCount,
    sampleNote: `正式有效 ${sampleCount} / ${report.measuredTarget} 轮；已完成预热 ${report.warmupCompleted} 轮、无效尝试 ${report.invalidRounds.length} 轮均不参与计分。`,
    rounds: rounds.map((round, index) => ({
      attempt: round.attempt,
      number: index + 1,
      steps: round.steps.map((step, stepIndex) => ({
        id: step.id,
        label: summary[stepIndex].label,
        equation: `${formatNumber(step.syncMs)} + ${formatNumber(step.asyncMs)} ≈ ${formatNumber(step.elapsedMs)} ms`
      })),
      totalEquation: `T = ${round.scoring.phaseTimesMs.map(formatNumber).join(' + ')} ≈ ${formatNumber(round.scoring.suiteTotalMs)} ms`,
      scoreEquation: `S${index + 1} = ${scoring.scale} / G = ${scoring.scale} / ${formatNumber(round.scoring.geomeanMs)} ≈ ${formatNumber(round.scoring.score)}`
    })),
    meanTitle: scoring.complete ? '最终分数：逐轮分数的算术平均' : '临时分数：逐轮分数的算术平均',
    meanLines: sampleCount ? [
      `分数总和 = ${scoring.values.map(formatNumber).join(' + ')} ≈ ${formatNumber(calculation.scoreSum)}`,
      `平均分 = 分数总和 / n ≈ ${formatNumber(calculation.scoreSum)} / ${sampleCount} ≈ ${formatNumber(scoring.mean)}`
    ] : [],
    confidenceLines,
    confidenceNote: sampleCount < 2
      ? '至少需要 2 个有效正式轮次才能计算置信区间。'
      : '当前样本数超出评分模块的置信区间支持范围。'
  };
}

module.exports = { todoScoreDetails };
