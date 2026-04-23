import { useState, useEffect, useCallback, useRef } from 'react';
import type { ThoughtRecord } from '../../../shared/types/thought-types';
import { THOUGHT_ACTION } from '../thought-protocol';
import { ThoughtPanel } from './ThoughtPanel';
import '../thought.css';

/**
 * ThoughtView — L3 容器
 *
 * NoteView 的变种，作为独立 View 运行在 Right Slot。
 * 管理 Thought 列表状态，监听 ViewMessage 实现与 Note 的联动。
 */

const viewAPI = () => (window as any).viewAPI as {
  thoughtListByNote: (noteId: string) => Promise<ThoughtRecord[]>;
  thoughtSave: (id: string, updates: any) => Promise<void>;
  thoughtLoad: (id: string) => Promise<ThoughtRecord | null>;
  thoughtDelete: (id: string) => Promise<void>;
  thoughtUnrelate: (noteId: string, thoughtId: string) => Promise<void>;
  sendToOtherSlot: (msg: any) => void;
  onMessage: (cb: (msg: any) => void) => () => void;
  isDBReady: () => Promise<boolean>;
  onDBReady: (cb: () => void) => () => void;
  getPrimaryActiveNoteId: () => Promise<string | null>;
} | undefined;

export function ThoughtView() {
  const [thoughts, setThoughts] = useState<ThoughtRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const noteIdRef = useRef<string | null>(null);

  // 加载某笔记的所有 Thoughts
  const loadThoughts = useCallback(async (nId: string) => {
    const api = viewAPI();
    if (!api) return;
    const list = await api.thoughtListByNote(nId);
    setThoughts(list);
  }, []);

  // 启动时主动获取当前笔记 ID 并加载 thoughts
  useEffect(() => {
    const api = viewAPI();
    if (!api) return;

    const init = async () => {
      // 等待 DB 就绪
      const ready = await api.isDBReady();
      if (!ready) {
        // 监听 DB ready 事件
        const unsub = api.onDBReady(() => {
          unsub();
          init();
        });
        return;
      }

      // 跟随主（left）slot 的 activeNoteId —— 不管本 ThoughtView 在哪个 slot
      const nId = await api.getPrimaryActiveNoteId();
      if (nId) {
        setNoteId(nId);
        noteIdRef.current = nId;
        loadThoughts(nId);
      }
    };

    init();
  }, [loadThoughts]);

  // 监听来自 Note 的 ViewMessage
  useEffect(() => {
    const api = viewAPI();
    if (!api) return;

    const unsub = api.onMessage((msg) => {
      if (msg.protocol && msg.protocol !== 'note-thought') return;
      switch (msg.action) {
        case THOUGHT_ACTION.NOTE_LOADED: {
          const nId = (msg.payload as any).noteId;
          setNoteId(nId);
          noteIdRef.current = nId;
          loadThoughts(nId);
          break;
        }
        case THOUGHT_ACTION.CREATE: {
          const p = msg.payload as any;
          console.log('[ThoughtView] CREATE received:', { thoughtId: p.thoughtId, type: p.type, serviceId: p.serviceId });
          // 追加新 Thought 到列表（如果不存在的话）
          setThoughts((prev) => {
            if (prev.some((t) => t.id === p.thoughtId)) return prev;
            const newThought: ThoughtRecord = {
              id: p.thoughtId,
              anchor_type: p.anchorType,
              anchor_text: p.anchorText,
              anchor_pos: p.anchorPos,
              type: p.type || 'thought',
              resolved: false,
              pinned: false,
              doc_content: [],
              serviceId: p.serviceId,
              created_at: Date.now(),
              updated_at: Date.now(),
            };
            return [...prev, newThought];
          });
          setActiveId(p.thoughtId);
          break;
        }
        case THOUGHT_ACTION.ACTIVATE: {
          setActiveId((msg.payload as any).thoughtId);
          break;
        }
        case THOUGHT_ACTION.DELETE: {
          // Note 侧删除标注 → 移除对应卡片
          const delId = (msg.payload as any).thoughtId;
          setThoughts((prev) => prev.filter((t) => t.id !== delId));
          break;
        }
        case THOUGHT_ACTION.SCROLL_SYNC: {
          // Note 滚动时同步：高亮与可见锚点对应的 ThoughtCard
          const visibleIds: string[] = (msg.payload as any).visibleIds || [];
          if (visibleIds.length > 0) {
            // 激活第一个可见锚点对应的 thought（自动跟随滚动）
            setActiveId((prev) => {
              if (prev && visibleIds.includes(prev)) return prev;
              return visibleIds[0];
            });
          }
          break;
        }

        // ── AI Workflow ──

        case THOUGHT_ACTION.AI_RESPONSE_READY: {
          const p = msg.payload as any;
          console.log('[ThoughtView] AI_RESPONSE_READY received:', { thoughtId: p.thoughtId, mdLen: p.markdown?.length ?? 0 });
          // AI 回复就绪 — 从 DB 重新加载 ThoughtRecord（main 已解析 + 保存结构化 Atoms）
          const api2 = viewAPI();
          if (api2) {
            console.log('[ThoughtView] Loading thought from DB:', p.thoughtId);
            api2.thoughtLoad(p.thoughtId).then((loaded: ThoughtRecord | null) => {
              console.log('[ThoughtView] Loaded thought:', loaded ? `${loaded.doc_content?.length ?? 0} atoms` : 'null');
              if (loaded && loaded.doc_content?.length > 0) {
                console.log('[ThoughtView] First atom type:', loaded.doc_content[0]?.type);
              }
              if (!loaded) return;
              setThoughts((prev) =>
                prev.map((t) => t.id === p.thoughtId ? loaded : t),
              );
              setActiveId(p.thoughtId);
            });
          }
          break;
        }
        case THOUGHT_ACTION.AI_ERROR: {
          const p = msg.payload as any;
          console.log('[ThoughtView] AI_ERROR received:', { thoughtId: p.thoughtId, error: p.error });
          // AI 回复失败 — 在 ThoughtCard 中显示错误
          setThoughts((prev) =>
            prev.map((t) => {
              if (t.id !== p.thoughtId) return t;
              return {
                ...t,
                doc_content: [{
                  id: `atom-${Date.now()}`,
                  type: 'paragraph' as const,
                  content: { children: [{ type: 'text', text: `AI 请求失败: ${p.error}` }] },
                  meta: { createdAt: Date.now(), updatedAt: Date.now(), dirty: false },
                }],
                updated_at: Date.now(),
              } as ThoughtRecord;
            }),
          );
          setActiveId(p.thoughtId);
          break;
        }
      }
    });

    return unsub;
  }, [loadThoughts]);

  // 保存 Thought 内容
  const handleSave = useCallback(async (id: string, updates: Partial<ThoughtRecord>) => {
    const api = viewAPI();
    if (!api) return;
    await api.thoughtSave(id, updates);
    setThoughts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates, updated_at: Date.now() } : t)),
    );
  }, []);

  // 删除 Thought
  const handleDelete = useCallback(async (id: string) => {
    const api = viewAPI();
    if (!api) return;

    const nId = noteIdRef.current;
    await api.thoughtDelete(id);
    if (nId) await api.thoughtUnrelate(nId, id);

    setThoughts((prev) => prev.filter((t) => t.id !== id));

    // 通知 Note 移除 mark
    api.sendToOtherSlot({
      protocol: 'note-thought',
      action: THOUGHT_ACTION.DELETE,
      payload: { thoughtId: id },
    });
  }, []);

  // 点击锚点预览 → Note 滚动到锚点
  const handleScrollToAnchor = useCallback((thoughtId: string) => {
    const api = viewAPI();
    if (!api) return;
    api.sendToOtherSlot({
      protocol: 'note-thought',
      action: THOUGHT_ACTION.SCROLL_TO_ANCHOR,
      payload: { thoughtId },
    });
  }, []);

  // 类型变更
  const handleTypeChange = useCallback(async (id: string, newType: ThoughtRecord['type']) => {
    await handleSave(id, { type: newType });
    const api = viewAPI();
    if (api) {
      api.sendToOtherSlot({
        protocol: 'note-thought',
        action: THOUGHT_ACTION.TYPE_CHANGE,
        payload: { thoughtId: id, newType },
      });
    }
  }, [handleSave]);

  return (
    <div className="thought-view">
      {/* Toolbar — 与 NoteView 对齐 */}
      <div className="thought-view__toolbar">
        <span className="thought-view__toolbar-title">💭 Thoughts</span>
        <span className="thought-view__toolbar-count">{thoughts.length}</span>
        <div style={{ flex: 1 }} />
        <button
          className="thought-view__close-btn"
          onClick={() => {
            const api = viewAPI();
            if (api) (api as any).closeSelf();
          }}
          title="关闭此面板"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <ThoughtPanel
        thoughts={thoughts}
        activeId={activeId}
        onActivate={setActiveId}
        onSave={handleSave}
        onDelete={handleDelete}
        onScrollToAnchor={handleScrollToAnchor}
        onTypeChange={handleTypeChange}
      />
    </div>
  );
}
