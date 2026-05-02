// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

// 阶段 01 J5.2: 跨插件 import 禁令 — 逐插件生成 config object
// 参考 ls src/plugins/ 的当前 9 个插件目录
const PLUGIN_DIRS = [
  'ai-note-bridge',
  'browser-capability',
  'demo',
  'ebook',
  'graph',
  'note',
  'thought',
  'web',
  'web-bridge',
];

const crossPluginImportConfigs = PLUGIN_DIRS.map((self) => ({
  files: [`src/plugins/${self}/**`],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: PLUGIN_DIRS.filter((other) => other !== self).flatMap((other) => [
          `@plugins/${other}`,
          `@plugins/${other}/*`,
          `@plugins/${other}/**`,
          `**/plugins/${other}`,
          `**/plugins/${other}/*`,
          `**/plugins/${other}/**`,
        ]),
        message: '跨插件 import 禁止 — 共享逻辑走 src/capabilities/ 或 src/shared/。见总纲 § 4.4',
      }],
    }],
  },
}));

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
  // ── 阶段 01 J5.2: 跨插件 import 禁令(逐插件展开) ──
  ...crossPluginImportConfigs,
  // ── 阶段 01 J5.3: src/shared/** 禁止 import electron ──
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'electron',
          message: 'shared 是跨进程契约层,禁止 import electron — 见总纲 § 6 数据模型四层',
        }],
      }],
    },
  },
  // ── 阶段 01 J5.4: 视图层禁止 import 非白名单 npm 包(warn 级,波次 3 升 error) ──
  // 白名单单一真值见 tools/lint/pure-utility-allowlist.ts(.ts 文件无法在
  // .mjs ESLint config 中直接 import,需 ts loader;故仅作注释引用,
  // 实际拦截规则用下方正向黑名单实现)
  {
    files: ['src/plugins/**/views/**'],
    rules: {
      'no-restricted-imports': ['warn', {
        patterns: [{
          // 通用模式:禁止 import 任何不以 @shared/ @capabilities/ 或相对路径开头的包
          // 排除白名单(从 tools/lint/pure-utility-allowlist.ts 同步:dayjs/lodash/clsx/...)
          group: [
            // 拦截非白名单 npm 包(简化实现:列出禁止的高风险包,白名单包不出现在 group 中)
            'three', 'three/*',
            'prosemirror-*',
            'pdfjs-dist', 'pdfjs-dist/*',
            'epubjs',
            '@anthropic-ai/sdk',
            'openai',
            'elkjs',
          ],
          message: 'L5 视图层禁止直接 import 重型外部依赖,必须经 src/capabilities/ 封装 — 见总纲 § 1.3 抽象原则',
        }],
      }],
    },
  },
);
