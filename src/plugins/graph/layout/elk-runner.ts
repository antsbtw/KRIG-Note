/**
 * ELK 单例 — 所有 layout adapter 共享一个 ELK 实例（WebWorker 模式）。
 *
 * 用 Vite 的 `new URL(..., import.meta.url)` 解析 elk-worker.min.js 的最终 URL，
 * 这样开发期 / 打包后都能正确加载。Worker 用经典模式（type: 'classic'），
 * 因为 elk-worker.min.js 不是 ES module。
 *
 * 详见 docs/graph/KRIG-Graph-Layout-Spec.md §4
 */
import ELK from 'elkjs/lib/elk-api';
import type { ELK as ElkInstance, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';

let elk: ElkInstance | null = null;

/** 获取（或创建）ELK 单例。第一次调用启动 Worker（~50ms）。 */
export function getElk(): ElkInstance {
  if (elk) return elk;
  elk = new ELK({
    workerFactory: () => {
      const url = new URL('elkjs/lib/elk-worker.min.js', import.meta.url);
      return new Worker(url, { type: 'classic' });
    },
  });
  return elk;
}

/** 关停 Worker（测试 / 卸载用）。 */
export function shutdownElk(): void {
  if (elk) {
    elk.terminateWorker();
    elk = null;
  }
}

export type { ElkNode, LayoutOptions };
