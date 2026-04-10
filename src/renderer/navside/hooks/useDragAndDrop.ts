import { useState, useCallback } from 'react';

interface NoteListItem {
  id: string;
  title: string;
  folder_id: string | null;
  updated_at: number;
}

interface FolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

declare const navSideAPI: {
  noteMoveToFolder: (noteId: string, folderId: string | null) => Promise<void>;
  folderMove: (id: string, parentId: string | null) => Promise<void>;
};

export interface DragAndDropInput {
  noteList: NoteListItem[];
  folderList: FolderRecord[];
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useDragAndDrop(input: DragAndDropInput) {
  const { noteList, folderList, setExpandedFolders } = input;

  const [dragItem, setDragItem] = useState<{ type: 'note' | 'folder'; id: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, type: 'note' | 'folder', id: string) => {
    setDragItem({ type, id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${type}:${id}`);
    const ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;padding:4px 12px;background:#264f78;color:#e8eaed;font-size:12px;border-radius:4px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;';
    const name = type === 'note'
      ? noteList.find((n) => n.id === id)?.title
      : folderList.find((f) => f.id === id)?.title;
    ghost.textContent = name || '';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, [noteList, folderList]);

  const handleDragEnd = useCallback(() => {
    setDragItem(null);
    setDropTargetId(null);
  }, []);

  const isDescendant = useCallback((parentId: string, childId: string): boolean => {
    let current = childId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return false;
      visited.add(current);
      if (current === parentId) return true;
      const folder = folderList.find((f) => f.id === current);
      if (!folder?.parent_id) return false;
      current = folder.parent_id;
    }
    return false;
  }, [folderList]);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    if (!dragItem) return;
    if (dragItem.type === 'folder' && dragItem.id === targetId) return;
    if (dragItem.type === 'folder' && targetId !== 'root' && isDescendant(dragItem.id, targetId)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(targetId);
  }, [dragItem, isDescendant]);

  const handleDragLeave = useCallback((e: React.DragEvent, targetId: string) => {
    if (dropTargetId === targetId && !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropTargetId(null);
    }
  }, [dropTargetId]);

  const handleDrop = useCallback((e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragItem) return;

    if (dragItem.type === 'note') {
      const note = noteList.find((n) => n.id === dragItem.id);
      if (note && note.folder_id !== targetFolderId) {
        navSideAPI.noteMoveToFolder(dragItem.id, targetFolderId);
        if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
      }
    } else {
      const folder = folderList.find((f) => f.id === dragItem.id);
      if (folder && folder.parent_id !== targetFolderId) {
        if (!targetFolderId || !isDescendant(dragItem.id, targetFolderId)) {
          navSideAPI.folderMove(dragItem.id, targetFolderId);
          if (targetFolderId) setExpandedFolders((s) => new Set(s).add(targetFolderId));
        }
      }
    }

    setDragItem(null);
    setDropTargetId(null);
  }, [dragItem, noteList, folderList, isDescendant, setExpandedFolders]);

  return {
    dragItem, dropTargetId,
    handleDragStart, handleDragEnd,
    handleDragOver, handleDragLeave, handleDrop,
  };
}
