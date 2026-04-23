import { useCallback, useEffect, useRef } from 'react';
import { NoteEditor, type NoteEditorHandle } from '../../note/components/NoteEditor';
import type { Atom } from '../../../shared/types/atom-types';
import '../../note/note.css';

/**
 * ThoughtEditor — NoteEditor 的 thought 变体薄包装
 *
 * 作为"NoteView 的真正变体"，完整继承 NoteEditor 的编辑能力（SlashMenu、
 * FloatingToolbar、HandleMenu、ContextMenu、blockHandle、paste-media、
 * smart-paste、heading-collapse、blockSelection、vocab 高亮、block-frame 等），
 * 仅禁用：
 * - noteTitle 节点（Thought 无标题）
 * - titleGuardPlugin（无标题可守护）
 * - thoughtPlugin（自嵌套会递归）
 * - AskAIPanel（Note 专属问 AI 流程）
 * - TOC（单条 thought 文档太短）
 *
 * 保存逻辑：NoteEditor 推 onDocChanged 信号 → 本组件 2s 防抖 →
 * handle.getDocAtoms() 按需拉 → onContentChange(atoms)。
 * 与 NoteView 的推拉契约保持同构。
 */

interface ThoughtEditorProps {
  initialContent: Atom[];
  onContentChange: (atoms: Atom[]) => void;
}

export function ThoughtEditor({ initialContent, onContentChange }: ThoughtEditorProps) {
  const handleRef = useRef<NoteEditorHandle | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onContentChange ref 化，避免外层重 render 导致 onDocChanged 回调身份变化
  // （NoteEditor 已经 ref 化了回调，这里对齐）
  const onContentChangeRef = useRef(onContentChange);
  useEffect(() => { onContentChangeRef.current = onContentChange; }, [onContentChange]);

  const handleReady = useCallback((handle: NoteEditorHandle) => {
    handleRef.current = handle;
    // 初始内容：通过 handle.replaceDoc 装载（NoteEditor 默认是空 doc）
    if (initialContent && initialContent.length > 0) {
      handle.replaceDoc(initialContent);
    }
  }, [initialContent]);

  const handleDocChanged = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const handle = handleRef.current;
      if (!handle) return;
      const atoms = handle.getDocAtoms();
      onContentChangeRef.current(atoms);
    }, 2000);
  }, []);

  // 卸载前 flush 防抖（避免最后一次编辑丢失）
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        const handle = handleRef.current;
        if (handle) {
          const atoms = handle.getDocAtoms();
          onContentChangeRef.current(atoms);
        }
      }
    };
  }, []);

  return (
    <div className="thought-editor">
      <NoteEditor
        variant="thought"
        onReady={handleReady}
        onDocChanged={handleDocChanged}
      />
    </div>
  );
}
