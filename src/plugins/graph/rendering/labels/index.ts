/**
 * Basic LabelLayout 库 —— 6 种内置布局。
 *
 * 注册表用法：
 *   const layout = labelLayoutRegistry.get('below-center');
 *   const { anchor } = layout.compute({ shapeBounds, labelBounds, margin });
 *
 * 注：basic label layout 是 KRIG 系统级注册表，不允许用户在画布上扩展
 * （仅系统 / 主题包级别可加新 layout）。
 */
import type { LabelLayout } from './types';
import { InsideCenterLabel } from './InsideCenterLabel';
import { InsideTopLabel } from './InsideTopLabel';
import { AboveCenterLabel } from './AboveCenterLabel';
import { BelowCenterLabel } from './BelowCenterLabel';
import { LeftOfLabel } from './LeftOfLabel';
import { RightOfLabel } from './RightOfLabel';

export {
  InsideCenterLabel,
  InsideTopLabel,
  AboveCenterLabel,
  BelowCenterLabel,
  LeftOfLabel,
  RightOfLabel,
};
export type {
  LabelLayout,
  LabelLayoutInput,
  LabelLayoutOutput,
} from './types';

class LabelLayoutRegistry {
  private store = new Map<string, LabelLayout>();
  register(layout: LabelLayout): void {
    this.store.set(layout.id, layout);
  }
  /** 取 layout，未注册时回退 below-center */
  get(id: string): LabelLayout {
    return this.store.get(id) ?? this.store.get('below-center')!;
  }
  has(id: string): boolean {
    return this.store.has(id);
  }
  list(): LabelLayout[] {
    return Array.from(this.store.values());
  }
}

export const labelLayoutRegistry = new LabelLayoutRegistry();

// 内置注册（v1）
labelLayoutRegistry.register(InsideCenterLabel);
labelLayoutRegistry.register(InsideTopLabel);
labelLayoutRegistry.register(AboveCenterLabel);
labelLayoutRegistry.register(BelowCenterLabel);
labelLayoutRegistry.register(LeftOfLabel);
labelLayoutRegistry.register(RightOfLabel);
