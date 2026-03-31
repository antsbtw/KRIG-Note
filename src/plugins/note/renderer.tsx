import { createRoot } from 'react-dom/client';
import { registerAllBlocks } from './blocks';
import { NoteEditor } from './components/NoteEditor';
import './note.css';

/**
 * NoteView — 笔记编辑器 View 插件
 *
 * 启动流程：
 * 1. 注册所有 Block（从 blocks/index.ts）
 * 2. 渲染 NoteEditor 组件（从 BlockRegistry 自动构建编辑器）
 */

// 1. 注册 Block
registerAllBlocks();

// 2. 渲染
function NoteView() {
  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarDot} />
        <span style={styles.toolbarTitle}>Note</span>
      </div>

      {/* Editor */}
      <NoteEditor />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#e8eaed',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '36px',
    padding: '0 16px',
    borderBottom: '1px solid #333',
    background: '#252525',
    flexShrink: 0,
  },
  toolbarDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#4a9eff',
  },
  toolbarTitle: {
    fontSize: '13px',
    fontWeight: 500,
  },
};

const root = createRoot(document.getElementById('root')!);
root.render(<NoteView />);
