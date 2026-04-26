/**
 * PerfHistory：每次 GraphView 会话的性能摘要持久化（v1.3 § 10.3）。
 *
 * 一个"会话"= 一个 GraphEngine 实例的生命周期（mount → dispose）。
 * dispose 时把会话期间的 perf 摘要 push 到 history 末尾，超容量淘汰队首。
 *
 * AutoTuner 启动时读取 history 决定是否调整 PerfConfig.thresholds。
 */

const STORAGE_KEY = 'krig.graph.perf.history';
const HISTORY_CAPACITY = 50;

export interface SessionSummary {
  /** 会话开始时间戳（ms） */
  startedAt: number;
  /** 会话持续时长（ms） */
  durationMs: number;
  /** 会话期间最大节点数 */
  maxNodes: number;
  /** 会话期间 fps 统计 */
  fps: {
    min: number;
    max: number;
    /** 均值（仅采样有节点的帧，避免空场景拉高均值） */
    avg: number;
    /** 低 fps 事件计数（fps < 30 出现的次数） */
    lowFpsEvents: number;
  };
  /** 退化触发次数 */
  degradationCount: number;
  /** 设备识别信息（仅用 userAgent 简化判断；不上报） */
  ua?: string;
}

export class SessionRecorder {
  private startedAt = Date.now();
  private maxNodes = 0;
  private fpsMin = Infinity;
  private fpsMax = 0;
  private fpsSum = 0;
  private fpsSamples = 0;
  private lowFpsEvents = 0;
  private degradationCount = 0;

  /** rAF 循环每帧调一次（含当前 fps 和 nodeCount） */
  recordFrame(fps: number, nodeCount: number): void {
    if (nodeCount > 0 && fps > 0) {
      this.fpsMin = Math.min(this.fpsMin, fps);
      this.fpsMax = Math.max(this.fpsMax, fps);
      this.fpsSum += fps;
      this.fpsSamples++;
      if (fps < 30) this.lowFpsEvents++;
    }
    this.maxNodes = Math.max(this.maxNodes, nodeCount);
  }

  recordDegradation(): void {
    this.degradationCount++;
  }

  finalize(): SessionSummary {
    return {
      startedAt: this.startedAt,
      durationMs: Date.now() - this.startedAt,
      maxNodes: this.maxNodes,
      fps: {
        min: this.fpsMin === Infinity ? 0 : this.fpsMin,
        max: this.fpsMax,
        avg: this.fpsSamples > 0 ? this.fpsSum / this.fpsSamples : 0,
        lowFpsEvents: this.lowFpsEvents,
      },
      degradationCount: this.degradationCount,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    };
  }
}

export function loadHistory(): SessionSummary[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionSummary[];
  } catch (e) {
    console.warn('[perf-history] load failed', e);
    return [];
  }
}

export function appendHistory(summary: SessionSummary): void {
  if (typeof localStorage === 'undefined') return;
  // 极短会话（< 3s 或无 fps 样本）不记录，避免噪声
  if (summary.durationMs < 3000 || summary.fps.avg === 0) return;
  try {
    const history = loadHistory();
    history.push(summary);
    if (history.length > HISTORY_CAPACITY) {
      history.splice(0, history.length - HISTORY_CAPACITY);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.warn('[perf-history] save failed', e);
  }
}

export function clearHistory(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}
