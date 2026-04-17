import type { IBrowserCoreAPI } from '../types';
import { LifecycleMonitor } from './lifecycle-monitor';

export class BrowserCoreService implements IBrowserCoreAPI {
  constructor(private readonly lifecycle: LifecycleMonitor) {}

  async subscribeLifecycle(
    listener: Parameters<IBrowserCoreAPI['subscribeLifecycle']>[0],
  ): Promise<() => void> {
    return this.lifecycle.subscribe(listener);
  }
}

