/** MenuItem 注册 */
export interface MenuItemRegistration {
  id: string;
  label: string;
  accelerator?: string;        // 快捷键（如 'CmdOrCtrl+S'）
  separator?: boolean;          // 分隔线
  enabled?: boolean;
  handler: () => void;
}

/** Menu 注册（全局稳定，不随 WorkMode 变化） */
export interface MenuRegistration {
  id: string;
  label: string;
  order: number;                // 排列顺序
  items: MenuItemRegistration[];
}
