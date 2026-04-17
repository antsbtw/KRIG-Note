import type { PageLifecycleEvent } from '../types';

type LifecycleListener = (event: PageLifecycleEvent) => void | Promise<void>;

/**
 * In-memory lifecycle event hub.
 * Concrete Electron bindings can publish page/frame/navigation events here.
 */
export class LifecycleMonitor {
  private listeners = new Set<LifecycleListener>();

  async subscribe(listener: LifecycleListener): Promise<() => void> {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: PageLifecycleEvent): void {
    for (const listener of Array.from(this.listeners)) {
      void Promise.resolve(listener(event)).catch(() => {
        // Keep lifecycle delivery isolated from individual listener failures.
      });
    }
  }
}
