import { useEffect, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { blockRegistry } from '../registry';

/**
 * NoteEditor — ProseMirror 编辑器 React 组件
 *
 * 从 BlockRegistry 自动构建 Schema、NodeView、Plugin。
 * 这是 NoteView 的核心渲染组件。
 */

export function NoteEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorRef.current || viewRef.current) return;

    // 从 BlockRegistry 构建 Schema
    const schema = blockRegistry.buildSchema();

    // 从 BlockRegistry 收集 NodeView
    const nodeViews = blockRegistry.buildNodeViews();

    // 从 BlockRegistry 收集 Block Plugin
    const blockPlugins = blockRegistry.buildBlockPlugins();

    // 初始文档：一个空段落
    const doc = schema.node('doc', null, [
      schema.node('paragraph'),
    ]);

    // 构建编辑器状态
    const state = EditorState.create({
      doc,
      plugins: [
        // 框架插件（优先级从高到低）
        keymap({
          'Mod-z': undo,
          'Mod-Shift-z': redo,
          'Mod-y': redo,
        }),
        keymap(baseKeymap),
        history(),
        dropCursor(),
        gapCursor(),

        // Block 插件（从注册表收集）
        ...blockPlugins,
      ],
    });

    // 创建编辑器视图
    const view = new EditorView(editorRef.current, {
      state,
      nodeViews,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr);
        view.updateState(newState);
      },
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return (
    <div style={styles.container}>
      <div ref={editorRef} style={styles.editor} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflow: 'auto',
    background: '#1e1e1e',
  },
  editor: {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '24px 32px',
    minHeight: '100%',
    outline: 'none',
  },
};
