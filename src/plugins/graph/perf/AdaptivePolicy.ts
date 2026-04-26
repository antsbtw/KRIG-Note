/**
 * AdaptivePolicy：监控 PerfStats，触发退化动作（v1.3 § 10.3）。
 *
 * 状态机：
 *   normal → (fps < fpsLow 持续 1s) → degraded
 *   degraded → (fps >= fpsRecover 持续 1s) → normal
 *
 * 退化动作（按 PerfConfig.actions 开关）：
 *   - pauseHoverOnLowFps: 暂停 raycaster hover 检测，cursor 默认
 *   - lodOnHighNodeCount: nodeCount > lodNodeCount 时启用 LOD（独立于 fps，跟节点数量走）
 *
 * 由 GraphEngine 持有，每帧 update 一次。
 */
import type { PerfConfig } from './PerfConfig';

const FPS_TRIGGER_DURATION_MS = 1000;

export interface AdaptiveState {
  /** 当前是否处于 fps 退化态（hover 暂停） */
  hoverPaused: boolean;
  /** 当前是否启用 LOD（节点数过多） */
  lodEnabled: boolean;
}

export interface AdaptivePolicyCallbacks {
  /** 退化态变化通知（用于 PerfPanel 显示徽章 / 录入 PerfHistory） */
  onStateChange?: (state: AdaptiveState) => void;
  /** hover 暂停状态变化（GraphEngine 转发到 InteractionController） */
  onHoverPauseChange?: (paused: boolean) => void;
  /** LOD 状态变化（GraphEngine 决定是否启用，影响 NodeRenderer.createNode） */
  onLodChange?: (enabled: boolean) => void;
}

export class AdaptivePolicy {
  private state: AdaptiveState = { hoverPaused: false, lodEnabled: false };
  private fpsLowSince: number | null = null;
  private fpsHighSince: number | null = null;

  constructor(
    private getConfig: () => PerfConfig,
    private callbacks: AdaptivePolicyCallbacks = {},
  ) {}

  /** GraphEngine 每帧 rAF 调用 */
  update(fps: number, nodeCount: number): void {
    const cfg = this.getConfig();
    if (cfg.mode === 'off') {
      this.forceState({ hoverPaused: false, lodEnabled: false });
      return;
    }

    const now = performance.now();

    // ── fps 退化（影响 hover）──
    if (cfg.actions.pauseHoverOnLowFps) {
      this.updateHoverPause(fps, cfg, now);
    } else if (this.state.hoverPaused) {
      // 关掉了 pauseHoverOnLowFps：恢复 hover
      this.setHoverPaused(false);
    }

    // ── 节点数 LOD（不依赖 fps，按节点数）──
    if (cfg.actions.lodOnHighNodeCount) {
      const wantLod = nodeCount > cfg.thresholds.lodNodeCount;
      if (wantLod !== this.state.lodEnabled) {
        this.setLod(wantLod);
      }
    } else if (this.state.lodEnabled) {
      this.setLod(false);
    }
  }

  private updateHoverPause(fps: number, cfg: PerfConfig, now: number): void {
    const { fpsLow, fpsRecover } = cfg.thresholds;

    if (!this.state.hoverPaused) {
      // 当前 normal: 检测连续低 fps
      if (fps > 0 && fps < fpsLow) {
        if (this.fpsLowSince === null) this.fpsLowSince = now;
        else if (now - this.fpsLowSince >= FPS_TRIGGER_DURATION_MS) {
          this.setHoverPaused(true);
          this.fpsLowSince = null;
        }
      } else {
        this.fpsLowSince = null;
      }
    } else {
      // 当前 degraded: 检测连续高 fps 恢复
      if (fps >= fpsRecover) {
        if (this.fpsHighSince === null) this.fpsHighSince = now;
        else if (now - this.fpsHighSince >= FPS_TRIGGER_DURATION_MS) {
          this.setHoverPaused(false);
          this.fpsHighSince = null;
        }
      } else {
        this.fpsHighSince = null;
      }
    }
  }

  private setHoverPaused(v: boolean): void {
    if (this.state.hoverPaused === v) return;
    this.state = { ...this.state, hoverPaused: v };
    this.callbacks.onHoverPauseChange?.(v);
    this.callbacks.onStateChange?.(this.state);
  }

  private setLod(v: boolean): void {
    if (this.state.lodEnabled === v) return;
    this.state = { ...this.state, lodEnabled: v };
    this.callbacks.onLodChange?.(v);
    this.callbacks.onStateChange?.(this.state);
  }

  /** mode=off 时强制清状态 */
  private forceState(s: AdaptiveState): void {
    if (s.hoverPaused !== this.state.hoverPaused) {
      this.state = { ...this.state, hoverPaused: s.hoverPaused };
      this.callbacks.onHoverPauseChange?.(s.hoverPaused);
    }
    if (s.lodEnabled !== this.state.lodEnabled) {
      this.state = { ...this.state, lodEnabled: s.lodEnabled };
      this.callbacks.onLodChange?.(s.lodEnabled);
    }
    this.fpsLowSince = null;
    this.fpsHighSince = null;
  }

  getState(): AdaptiveState {
    return { ...this.state };
  }
}
