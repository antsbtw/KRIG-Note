/**
 * 纯函数工具白名单——视图层与插件层允许直接 import 的 npm 包。
 * 准入标准（见总纲 § 1.3 规则 B）：无状态 / 无生命周期 / 无 UI / 调用即返回。
 * 修订需独立 PR + 评审。
 */
export const PURE_UTILITY_ALLOWLIST = [
  // 时间
  'dayjs',
  'date-fns',
  // 函数式工具
  'lodash',
  'lodash-es',
  // class 拼接
  'clsx',
  'classnames',
  // ID 生成
  'nanoid',
  'uuid',
  // 类型校验
  'zod',
  // UI 框架本身（视图组件天然要 import React）
  'react',
  'react-dom',
  // 状态库（无副作用、无生命周期）
  'zustand',
  'jotai',
] as const;

export type PureUtility = typeof PURE_UTILITY_ALLOWLIST[number];
