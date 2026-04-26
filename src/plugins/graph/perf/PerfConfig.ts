/**
 * GraphView 性能配置（v1.3 § 10.3 退化策略）。
 *
 * 三层来源（优先级从高到低）：
 *   1. 用户在 PerfPanel 手动设置（manual mode）
 *   2. AutoTuner 根据 PerfHistory 推荐（auto mode）
 *   3. DEFAULT_PERF_CONFIG 内置默认值
 *
 * 持久化：localStorage，key = "krig.graph.perf.config"。
 * 跨 graph 实例共享（同 app 一份配置）。
 */

export interface PerfThresholds {
  /** fps 低于此值持续 1s → 触发退化（默认 45） */
  fpsLow: number;
  /** fps 高于此值 → 取消退化（滞后避免抖动；默认 55） */
  fpsRecover: number;
  /** 节点数超过此值 → 启用 LOD（默认 1000） */
  lodNodeCount: number;
  /** 字体加载超时阈值 ms（默认 5000） */
  fontLoadTimeoutMs: number;
}

export interface PerfActions {
  /** fps 退化时是否暂停 hover 检测 */
  pauseHoverOnLowFps: boolean;
  /** 节点数过多时是否启用 LOD（远距离节点不渲染 content） */
  lodOnHighNodeCount: boolean;
  /** 字体加载超时是否回退到 SVG 纹理（v2.0 范围，当前未实施） */
  fontFallbackOnTimeout: boolean;
}

export type PerfMode = 'auto' | 'manual' | 'off';

export interface PerfConfig {
  /** 'auto' = AutoTuner 自动调；'manual' = 用户固定；'off' = 关闭所有退化 */
  mode: PerfMode;
  thresholds: PerfThresholds;
  actions: PerfActions;
}

export const DEFAULT_PERF_CONFIG: PerfConfig = {
  mode: 'auto',
  thresholds: {
    fpsLow: 45,
    fpsRecover: 55,
    lodNodeCount: 1000,
    fontLoadTimeoutMs: 5000,
  },
  actions: {
    pauseHoverOnLowFps: true,
    lodOnHighNodeCount: true,
    fontFallbackOnTimeout: false,
  },
};

const STORAGE_KEY = 'krig.graph.perf.config';

/**
 * 加载用户保存的 PerfConfig；解析失败 / 不存在 → 默认。
 *
 * 兼容增量字段：旧版本配置中缺失的字段从 DEFAULT 补齐（嵌套 merge）。
 */
export function loadPerfConfig(): PerfConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PERF_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERF_CONFIG };
    const parsed = JSON.parse(raw) as Partial<PerfConfig>;
    return mergeConfig(DEFAULT_PERF_CONFIG, parsed);
  } catch (e) {
    console.warn('[perf-config] load failed, using default', e);
    return { ...DEFAULT_PERF_CONFIG };
  }
}

export function savePerfConfig(config: PerfConfig): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('[perf-config] save failed', e);
  }
}

export function resetPerfConfig(): PerfConfig {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { ...DEFAULT_PERF_CONFIG };
}

/** 嵌套 merge：partial 覆盖 base 的字段，缺失字段保留 base */
function mergeConfig(base: PerfConfig, partial: Partial<PerfConfig>): PerfConfig {
  return {
    mode: partial.mode ?? base.mode,
    thresholds: { ...base.thresholds, ...(partial.thresholds ?? {}) },
    actions: { ...base.actions, ...(partial.actions ?? {}) },
  };
}
