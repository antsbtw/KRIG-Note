import { createRoot } from 'react-dom/client';
import { registerAllBlocks } from './blocks';
import { NoteEditor } from './components/NoteEditor';
import './note.css';
import 'katex/dist/katex.min.css';

/**
 * NoteView — 笔记编辑器 View 插件
 *
 * 启动流程：
 * 1. 注册所有 Block（从 blocks/index.ts）
 * 2. 渲染 NoteEditor 组件（Toolbar + Editor 一体）
 */

// 1. 注册 Block
registerAllBlocks();

// 2. 渲染
const root = createRoot(document.getElementById('root')!);
root.render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', color: '#e8eaed' }}>
    <NoteEditor />
  </div>
);
