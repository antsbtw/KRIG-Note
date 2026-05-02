// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // 全局忽略：构建产物 / 依赖 / 本仓库特殊产物
    ignores: [
      'node_modules/**',
      'out/**',
      '.webpack/**',
      'dist/**',
      'build/**',
      'tmp/**',
      'docs/tmp/**',
      'scripts/**',
      '.vscode/**',
      '.git/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // 阶段 00 仅装工具链,不定义项目规则——以下为最小化降噪,不算规则
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': 'off',
    },
  },
  // ── 阶段 01 J5.1: L5 插件禁止 import 布局特权 API ──
  {
    files: ['src/plugins/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/window/shell', '**/slot/*', '@main/window/*'],
          importNames: ['openCompanion', 'ensureCompanion', 'closeRightSlot', 'openRightSlot'],
          message: 'L5 插件禁止直接调布局特权 API。改用 dispatch(IntentEvent) — 见 docs/refactor/00-总纲.md § 1.1 分层原则',
        }],
      }],
    },
  },
);
