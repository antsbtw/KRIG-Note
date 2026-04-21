import type { CodeLanguagePlugin, CodePluginContext } from './types';

/**
 * JavaScript/JSX Code Plugin — 浮窗沙箱执行
 *
 * 支持语言：javascript, typescript, jsx, tsx
 *
 * Preview 按钮点击 → 弹出居中浮窗（模态），iframe 沙箱执行代码。
 * 关闭浮窗回到代码编辑。
 *
 * 执行策略：
 * - 纯 JS：直接 eval，捕获 console 输出 + 返回值
 * - JSX/React：注入 React 18 + ReactDOM + Babel Standalone CDN
 */

const REACT_CDN = 'https://unpkg.com/react@18/umd/react.production.min.js';
const REACT_DOM_CDN = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
const BABEL_CDN = 'https://unpkg.com/@babel/standalone@7/babel.min.js';

/** 检测代码是否包含 JSX / React 特征 */
function isReactCode(code: string): boolean {
  return /(<\w[\s\S]*?>|useState|useEffect|useRef|useCallback|useMemo|useReducer|useContext|import\s+React|React\.|ReactDOM\.|createRoot|render\()/.test(code);
}

/** 构建纯 JS 执行器 HTML */
function buildPlainRunnerHTML(code: string): string {
  return `<!DOCTYPE html>
<html><head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;
    font-size: 13px; line-height: 1.5; color: #e8eaed;
    background: #1e1e1e; padding: 12px 16px;
  }
  .log { padding: 3px 0; white-space: pre-wrap; word-break: break-all; }
  .log-warn { color: #f0c674; }
  .log-error { color: #f87171; }
  .log-info { color: #8ab4f8; }
  .result { color: #98c379; padding: 6px 0; border-top: 1px solid #333; margin-top: 6px; }
  .error-msg { color: #f87171; padding: 6px 0; }
</style>
</head><body>
<script>
(function() {
  var output = document.body;
  function fmt(a) {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'object') { try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); } }
    return String(a);
  }
  function append(cls, args) {
    var div = document.createElement('div');
    div.className = 'log ' + cls;
    div.textContent = args.map(fmt).join(' ');
    output.appendChild(div);
  }
  console.log = function() { append('', [].slice.call(arguments)); };
  console.warn = function() { append('log-warn', [].slice.call(arguments)); };
  console.error = function() { append('log-error', [].slice.call(arguments)); };
  console.info = function() { append('log-info', [].slice.call(arguments)); };

  try {
    var __result = (0, eval)(${JSON.stringify(code)});
    if (__result !== undefined) {
      var div = document.createElement('div');
      div.className = 'result';
      div.textContent = '→ ' + fmt(__result);
      output.appendChild(div);
    }
  } catch(e) {
    var div = document.createElement('div');
    div.className = 'error-msg';
    div.textContent = (e.name || 'Error') + ': ' + e.message;
    output.appendChild(div);
  }
})();
<\/script>
</body></html>`;
}

/**
 * 从 import 语句中提取被导入的标识符名称。
 * 例：import { Button } from "..." → ['Button']
 *     import { Card, CardContent } from "..." → ['Card', 'CardContent']
 *     import Foo from "..." → ['Foo']
 */
function extractImportedNames(code: string): string[] {
  const names: string[] = [];
  // 带花括号的 named imports：import { A, B as C } from "..."
  const namedRe = /^\s*import\s+\{([^}]+)\}\s+from\s+['"](?!react).*?['"];?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(code)) !== null) {
    for (const part of m[1].split(',')) {
      // "A as B" → 取 B
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias) names.push(alias);
    }
  }
  // default import：import Foo from "..."（排除 React 系列）
  const defaultRe = /^\s*import\s+([A-Z]\w*)\s+from\s+['"](?!react).*?['"];?\s*$/gm;
  while ((m = defaultRe.exec(code)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** 构建 React/JSX 执行器 HTML */
function buildReactRunnerHTML(code: string): string {
  // 提取第三方 import 的组件名（用于降级）
  const thirdPartyNames = extractImportedNames(code);

  const cleanedCode = code
    .replace(/^\s*import\s+.*?from\s+['"]react['"];?\s*$/gm, '')
    .replace(/^\s*import\s+.*?from\s+['"]react-dom['"];?\s*$/gm, '')
    .replace(/^\s*import\s+.*?from\s+['"]react-dom\/client['"];?\s*$/gm, '')
    .replace(/^\s*import\s+.*?from\s+['"].*?['"];?\s*$/gm, '');

  return `<!DOCTYPE html>
<html><head>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
  #root { min-height: 40px; }
  .error-overlay {
    padding: 12px 16px; background: #2d1b1b; color: #f87171;
    font-family: monospace; font-size: 13px; white-space: pre-wrap;
  }
  .loading { padding: 24px; color: #888; font-size: 13px; text-align: center; }
</style>
</head><body>
<div id="root"><div class="loading">Loading React...</div></div>
<script src="${REACT_CDN}"><\/script>
<script src="${REACT_DOM_CDN}"><\/script>
<script src="${BABEL_CDN}"><\/script>
<script>
(function() {
  var root = document.getElementById('root');

  function ready() {
    return typeof React !== 'undefined' && typeof ReactDOM !== 'undefined' && typeof Babel !== 'undefined';
  }

  // 将未知组件降级为原生 HTML 元素的透传组件
  function makeFallback(name) {
    // 首字母大写 → 当作容器组件，渲染为 div
    // 名含 Button/Btn → button，Input → input，等等
    var lower = name.toLowerCase();
    var tag = 'div';
    if (lower.indexOf('button') >= 0 || lower.indexOf('btn') >= 0) tag = 'button';
    else if (lower.indexOf('input') >= 0) tag = 'input';
    else if (lower.indexOf('label') >= 0) tag = 'label';
    else if (lower.indexOf('image') >= 0 || lower.indexOf('img') >= 0) tag = 'img';
    else if (lower.indexOf('link') >= 0 || lower === 'a') tag = 'a';
    else if (lower.indexOf('select') >= 0) tag = 'select';
    else if (lower.indexOf('textarea') >= 0) tag = 'textarea';

    return function FallbackComponent(props) {
      var p = Object.assign({}, props);
      // className 保留（虽然无 Tailwind，但不报错）
      delete p.children;
      // 透传 onClick 等事件
      return React.createElement(tag, p, props.children);
    };
  }

  function run() {
    if (!ready()) { setTimeout(run, 100); return; }

    try {
      var useState = React.useState, useEffect = React.useEffect,
          useRef = React.useRef, useCallback = React.useCallback,
          useMemo = React.useMemo, useReducer = React.useReducer,
          useContext = React.useContext, createContext = React.createContext,
          Fragment = React.Fragment;

      // 为第三方组件生成降级替身
      var fallbacks = {};
      var thirdParty = ${JSON.stringify(thirdPartyNames)};
      for (var i = 0; i < thirdParty.length; i++) {
        fallbacks[thirdParty[i]] = makeFallback(thirdParty[i]);
      }

      var userCode = ${JSON.stringify(cleanedCode)};
      var transformed = Babel.transform(userCode, {
        presets: ['react', ['env', { modules: 'commonjs' }]],
        filename: 'canvas.jsx',
      }).code;

      var module = { exports: {} };
      var exports = module.exports;

      // 构建参数列表：React 核心 + 降级组件
      var paramNames = [
        'React', 'useState', 'useEffect', 'useRef', 'useCallback',
        'useMemo', 'useReducer', 'useContext', 'createContext', 'Fragment',
        'module', 'exports'
      ];
      var paramValues = [
        React, useState, useEffect, useRef, useCallback,
        useMemo, useReducer, useContext, createContext, Fragment,
        module, exports
      ];
      for (var k in fallbacks) {
        paramNames.push(k);
        paramValues.push(fallbacks[k]);
      }

      var fnBody = transformed + '\\nreturn typeof exports.default !== "undefined" ? exports.default : (typeof module.exports.default !== "undefined" ? module.exports.default : (typeof App !== "undefined" ? App : undefined));';
      var fn = new Function(paramNames.join(','), fnBody);
      var evalResult = fn.apply(null, paramValues);

      if (typeof evalResult === 'function') {
        root.innerHTML = '';
        ReactDOM.createRoot(root).render(React.createElement(evalResult));
      } else if (React.isValidElement && React.isValidElement(evalResult)) {
        root.innerHTML = '';
        ReactDOM.createRoot(root).render(evalResult);
      } else {
        root.innerHTML = '<div style="padding:16px;color:#666;font-size:13px;">No React component found.<br>Define a function named <code>App</code> or use <code>export default</code>.</div>';
      }
    } catch(e) {
      root.innerHTML = '';
      var errDiv = document.createElement('div');
      errDiv.className = 'error-overlay';
      errDiv.textContent = (e.name || 'Error') + ': ' + e.message;
      root.appendChild(errDiv);
    }
  }
  run();
})();
<\/script>
</body></html>`;
}

/** 打开浮窗执行代码 */
function openPreviewModal(code: string, title: string): void {
  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'js-preview-backdrop';

  // Modal
  const modal = document.createElement('div');
  modal.className = 'js-preview-modal';

  // Header
  const header = document.createElement('div');
  header.className = 'js-preview-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'js-preview-title';
  titleEl.textContent = title || 'Preview';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'js-preview-close';
  closeBtn.textContent = '✕';
  closeBtn.title = '关闭 (Esc)';

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // iframe — 用 srcdoc 注入内容，sandbox 允许脚本执行和外部 CDN 加载
  const useReact = isReactCode(code);
  const iframe = document.createElement('iframe');
  iframe.className = 'js-preview-iframe';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  if (!useReact) {
    iframe.style.background = '#1e1e1e';
  }

  const html = useReact ? buildReactRunnerHTML(code) : buildPlainRunnerHTML(code);
  iframe.srcdoc = html;

  // 自适应高度
  const adjustHeight = () => {
    try {
      const body = iframe.contentDocument?.body;
      const docEl = iframe.contentDocument?.documentElement;
      if (body && docEl) {
        const h = Math.max(body.scrollHeight, docEl.scrollHeight);
        const clamped = Math.min(Math.max(h + 4, 80), window.innerHeight * 0.7);
        iframe.style.height = `${clamped}px`;
        // modal 也设最小高度让 header 不被挤压
        modal.style.maxHeight = `${clamped + 50}px`;
      }
    } catch { /* ignore */ }
  };
  iframe.addEventListener('load', () => {
    adjustHeight();
    // React 异步渲染，延迟再调整
    if (useReact) {
      setTimeout(adjustHeight, 800);
      setTimeout(adjustHeight, 2000);
    }
  });

  modal.appendChild(iframe);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // 关闭逻辑
  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });

  // 入场动画
  requestAnimationFrame(() => backdrop.classList.add('js-preview-backdrop--visible'));
}

export const jsPlugin: CodeLanguagePlugin = {
  languages: ['javascript', 'typescript', 'jsx', 'tsx'],
  hasPreview: true,

  openFullscreen(ctx: CodePluginContext) {
    openPreviewModal(ctx.getCode(), ctx.node.attrs.title || '');
  },

  activate(ctx: CodePluginContext) {
    // Canvas Preview 按钮也走浮窗
    openPreviewModal(ctx.getCode(), ctx.node.attrs.title || '');
  },

  deactivate() {
    // 浮窗由自身的 close 管理，这里无需操作
  },
};
