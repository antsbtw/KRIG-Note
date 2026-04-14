/**
 * WebView Context Menu — types
 *
 * The base WebView (WebView.tsx) owns the right-click infrastructure:
 * every guest preload forwards right-click events here, and this
 * module renders a single overlay menu. Variants (AIWebView,
 * TranslateWebView, plain WebView) plug their own items into the
 * menu through a registration list, rather than each reimplementing
 * context-menu handling.
 */

import type { RefObject } from 'react';
import type { WebviewTag } from 'electron';

/**
 * Shape of the payload sent from the guest preload via
 * ipcRenderer.sendToHost('krig:context-menu', ...).
 */
export interface GuestContextSignal {
  /** Viewport x coordinate of the click inside the guest. */
  x: number;
  /** Viewport y coordinate of the click inside the guest. */
  y: number;
  /** tagName of the immediate click target (uppercase, or null). */
  targetTag: string | null;
  /**
   * Up to 200 chars of the target's outerHTML — cheap signal for
   * debugging / rough heuristics, not a parse-and-trust payload.
   */
  targetHtml: string;
}

/**
 * Context passed to menu-item visibility / click callbacks. The host
 * enriches the raw signal with the active webview reference and the
 * page URL so callbacks can issue executeJavaScript / query the DOM.
 */
export interface MenuContext extends GuestContextSignal {
  /** The webview element the click originated from. */
  webview: WebviewTag;
  /** Current guest URL (for service detection, etc.). */
  url: string;
}

/**
 * A single item to render in the context menu.
 *
 * `visible` defaults to always-visible. `onClick` is called with the
 * context and is expected to handle its own async work (the menu
 * closes immediately after click).
 */
export interface ContextMenuItem {
  id: string;
  /** Short label shown in the menu. */
  label: string | ((ctx: MenuContext) => string);
  /** Leading icon (emoji / character). */
  icon?: string;
  /** Optional divider above this item. */
  dividerAbove?: boolean;
  /**
   * Should this item appear for the current click? Default: always.
   * Return false to hide.
   */
  visible?: (ctx: MenuContext) => boolean;
  /**
   * Should the item be clickable? Default: enabled. Hidden items don't
   * need this.
   */
  enabled?: (ctx: MenuContext) => boolean;
  /**
   * Invoked when the user clicks the item. The menu auto-closes just
   * before this runs.
   */
  onClick: (ctx: MenuContext) => void | Promise<void>;
}

/** A frozen batch of items provided by one variant. */
export type ContextMenuItems = readonly ContextMenuItem[];

/** The registry ref type — variants pass items down to WebView. */
export interface WebViewContextMenuProps {
  /** Ref to the <webview> DOM element. */
  webviewRef: RefObject<WebviewTag | null>;
  /** Items contributed by the current variant. Built-ins are added by WebView. */
  items?: ContextMenuItems;
}
