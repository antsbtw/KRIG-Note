/**
 * AutoTuner：根据 PerfHistory 推荐 PerfConfig.thresholds（v1.3 § 10.3）。
 *
 * 触发：app 启动时（loadPerfConfig 后调一次）。
 * 仅当 PerfConfig.mode === 'auto' 时应用推荐值。
 * manual / off 模式下不动用户配置。
 *
 * 算法（首版规则式，简单可解释）：
 *
 * 取最近 N=5 次会话摘要：
 * - 全部 fps.avg ≥ 60: 设备性能强 → 阈值放宽（更晚退化）
 * - 任一会话 fps.min < 25 或 lowFpsEvents > 10: 设备吃紧 → 阈值收紧
 * - 任一会话 maxNodes > lodNodeCount × 2 但 fps.avg ≥ 50: 当前 LOD 阈值偏低
 * - 默认: 保持当前
 */
import {
  type PerfConfig,
  type PerfThresholds,
  DEFAULT_PERF_CONFIG,
} from './PerfConfig';
import { loadHistory, type SessionSummary } from './PerfHistory';

const RECENT_SESSIONS = 5;

export interface TuneResult {
  applied: boolean;
  reason: string;
  newThresholds?: PerfThresholds;
}

/**
 * 根据历史调整配置；返回新的（可能未变）PerfConfig。
 *
 * 仅在 mode === 'auto' 时应用。其他 mode 直接 return original。
 */
export function autoTune(config: PerfConfig): { config: PerfConfig; result: TuneResult } {
  if (config.mode !== 'auto') {
    return { config, result: { applied: false, reason: `mode=${config.mode}, skip` } };
  }

  const history = loadHistory();
  if (history.length === 0) {
    return { config, result: { applied: false, reason: 'no history yet' } };
  }

  const recent = history.slice(-RECENT_SESSIONS);
  const result = recommend(recent);

  if (!result.newThresholds) {
    return { config, result };
  }

  const newConfig: PerfConfig = {
    ...config,
    thresholds: result.newThresholds,
  };
  return { config: newConfig, result: { ...result, applied: true } };
}

function recommend(sessions: SessionSummary[]): TuneResult {
  if (sessions.length === 0) {
    return { applied: false, reason: 'no recent sessions' };
  }

  const avgFps = sessions.reduce((s, x) => s + x.fps.avg, 0) / sessions.length;
  const minFpsAcrossAll = Math.min(...sessions.map((s) => s.fps.min));
  const totalLowEvents = sessions.reduce((s, x) => s + x.fps.lowFpsEvents, 0);
  const maxNodes = Math.max(...sessions.map((s) => s.maxNodes));

  const base = DEFAULT_PERF_CONFIG.thresholds;

  // 设备吃紧：fps 抖动严重 → 阈值收紧（更早退化）
  if (minFpsAcrossAll < 25 || totalLowEvents > 10) {
    return {
      applied: false, // 由调用方判断 mode 后决定
      reason: `weak device (minFps ${minFpsAcrossAll.toFixed(0)}, lowEvents ${totalLowEvents})`,
      newThresholds: {
        ...base,
        fpsLow: 50,
        fpsRecover: 58,
        lodNodeCount: Math.max(500, Math.floor(maxNodes * 0.7)),
      },
    };
  }

  // 设备强：fps 稳定高 → 阈值放宽
  if (avgFps >= 60 && minFpsAcrossAll >= 50) {
    return {
      applied: false,
      reason: `strong device (avgFps ${avgFps.toFixed(0)}, minFps ${minFpsAcrossAll.toFixed(0)})`,
      newThresholds: {
        ...base,
        fpsLow: 35,
        fpsRecover: 50,
        lodNodeCount: Math.max(2000, maxNodes * 2),
      },
    };
  }

  // 中性：保持默认
  return {
    applied: false,
    reason: `normal (avgFps ${avgFps.toFixed(0)}), keep defaults`,
    newThresholds: base,
  };
}
