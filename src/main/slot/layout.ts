import { Bounds } from '../../shared/types';
import { APP_CONFIG } from '../../shared/app-config';

const { topBarHeight: TOP_BAR_HEIGHT, toggleWidth: TOGGLE_WIDTH, dividerWidth: DIVIDER_WIDTH } = APP_CONFIG.layout;
const NAVSIDE_MIN_WIDTH = 180;
const NAVSIDE_MAX_WIDTH = 400;
const NAVSIDE_DEFAULT_WIDTH = APP_CONFIG.layout.navSideWidth;

/**
 * Slot 布局计算器
 *
 * 布局结构：
 * ┌─ Toggle ─┬─ WorkspaceBar ──────────────────────────┐
 * ├─ NavSide ─┤─ Slot Area ───────────────────────────┤
 * │           │                                        │
 * └───────────┴────────────────────────────────────────┘
 */
export interface LayoutResult {
  toggle: Bounds;
  workspaceBar: Bounds;
  navSide: Bounds | null;
  leftSlot: Bounds;
  rightSlot: Bounds | null;
  divider: Bounds | null;
}

/** 当前 NavSide 宽度（可拖拽调整） */
let navSideWidth = NAVSIDE_DEFAULT_WIDTH;

export function getNavSideWidth(): number {
  return navSideWidth;
}

export function setNavSideWidth(width: number): void {
  navSideWidth = Math.max(NAVSIDE_MIN_WIDTH, Math.min(NAVSIDE_MAX_WIDTH, width));
}

/** macOS 红绿灯占用的宽度（非全屏时） */
const TRAFFIC_LIGHT_WIDTH = 72;

export function calculateLayout(
  windowWidth: number,
  windowHeight: number,
  navSideVisible: boolean,
  hasRightSlot: boolean,
  dividerRatio: number,
  isFullScreen: boolean = false,
): LayoutResult {
  // 非全屏时，Toggle 在红绿灯右边；全屏时在左上角
  const toggleX = (!isFullScreen && process.platform === 'darwin') ? TRAFFIC_LIGHT_WIDTH : 0;

  const toggle: Bounds = {
    x: toggleX,
    y: 0,
    width: TOGGLE_WIDTH,
    height: TOP_BAR_HEIGHT,
  };

  const navSideColumnWidth = navSideVisible ? navSideWidth : 0;
  const toggleRight = toggleX + TOGGLE_WIDTH;

  // WorkspaceBar 始终从 Toggle 右边开始
  const workspaceBarX = Math.max(navSideColumnWidth, toggleRight);

  const workspaceBar: Bounds = {
    x: workspaceBarX,
    y: 0,
    width: windowWidth - workspaceBarX,
    height: TOP_BAR_HEIGHT,
  };

  const contentTop = TOP_BAR_HEIGHT;
  const contentHeight = windowHeight - TOP_BAR_HEIGHT;

  const navSide: Bounds | null = navSideVisible
    ? { x: 0, y: contentTop, width: navSideWidth, height: contentHeight }
    : null;

  // Slot Area：NavSide 展开时从 NavSide 右边开始，收起时从 0 开始（全宽）
  const slotAreaX = navSideVisible ? navSideColumnWidth : 0;
  const slotAreaWidth = windowWidth - slotAreaX;

  if (!hasRightSlot) {
    return {
      toggle,
      workspaceBar,
      navSide,
      leftSlot: { x: slotAreaX, y: contentTop, width: slotAreaWidth, height: contentHeight },
      rightSlot: null,
      divider: null,
    };
  }

  const leftWidth = Math.floor((slotAreaWidth - DIVIDER_WIDTH) * dividerRatio);
  const rightWidth = slotAreaWidth - DIVIDER_WIDTH - leftWidth;

  return {
    toggle,
    workspaceBar,
    navSide,
    leftSlot: { x: slotAreaX, y: contentTop, width: leftWidth, height: contentHeight },
    divider: { x: slotAreaX + leftWidth, y: contentTop, width: DIVIDER_WIDTH, height: contentHeight },
    rightSlot: { x: slotAreaX + leftWidth + DIVIDER_WIDTH, y: contentTop, width: rightWidth, height: contentHeight },
  };
}
