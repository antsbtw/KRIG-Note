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

export function calculateLayout(
  windowWidth: number,
  windowHeight: number,
  navSideVisible: boolean,
  hasRightSlot: boolean,
  dividerRatio: number,
): LayoutResult {
  const toggle: Bounds = {
    x: 0,
    y: 0,
    width: TOGGLE_WIDTH,
    height: TOP_BAR_HEIGHT,
  };

  const navSideColumnWidth = navSideVisible ? navSideWidth : 0;
  const contentLeft = Math.max(navSideColumnWidth, TOGGLE_WIDTH);

  const workspaceBar: Bounds = {
    x: contentLeft,
    y: 0,
    width: windowWidth - contentLeft,
    height: TOP_BAR_HEIGHT,
  };

  const contentTop = TOP_BAR_HEIGHT;
  const contentHeight = windowHeight - TOP_BAR_HEIGHT;

  const navSide: Bounds | null = navSideVisible
    ? { x: 0, y: contentTop, width: navSideWidth, height: contentHeight }
    : null;

  const slotAreaX = contentLeft;
  const slotAreaWidth = windowWidth - contentLeft;

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
