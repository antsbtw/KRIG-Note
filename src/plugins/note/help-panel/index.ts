/**
 * help-panel — 统一 Help Panel 框架
 *
 * 重导出 core API 和类型，供面板模块和集成点使用。
 */

export type { HelpPanelConfig, HelpPanelShell } from './help-panel-types';

export {
  createHelpPanel,
  showHelpPanel,
  hideHelpPanel,
  activeHelpPanelId,
  registerExternalPanel,
  unregisterExternalPanel,
  notifyExternalShow,
  notifyExternalHide,
} from './help-panel-core';
