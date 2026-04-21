import { ipcMain } from 'electron';
import { IPC } from '../../../shared/types';
import { thoughtStore } from '../../../main/storage/thought-store';
import { graphStore } from '../../../main/association/graph-store';
import { activityStore } from '../../../main/storage/activity-store';
import { isDBReady } from '../../../main/storage/client';

/**
 * Thought Plugin — IPC Handlers
 */

export function registerThoughtIpcHandlers(): void {
  ipcMain.handle(IPC.THOUGHT_CREATE, async (_event, thought: any) => {
    if (!isDBReady()) return null;
    const record = await thoughtStore.create(thought);
    activityStore.log('thought.create', record.id);
    return record;
  });

  ipcMain.handle(IPC.THOUGHT_SAVE, async (_event, id: string, updates: any) => {
    if (!isDBReady()) return;
    await thoughtStore.save(id, updates);
  });

  ipcMain.handle(IPC.THOUGHT_LOAD, async (_event, id: string) => {
    if (!isDBReady()) return null;
    return thoughtStore.get(id);
  });

  ipcMain.handle(IPC.THOUGHT_DELETE, async (_event, id: string) => {
    if (!isDBReady()) return;
    await thoughtStore.delete(id);
    activityStore.log('thought.delete', id);
  });

  ipcMain.handle(IPC.THOUGHT_LIST_BY_NOTE, async (_event, noteId: string) => {
    if (!isDBReady()) return [];
    return thoughtStore.listByNote(noteId);
  });

  ipcMain.handle(IPC.THOUGHT_RELATE, async (_event, noteId: string, thoughtId: string, edge: any) => {
    if (!isDBReady()) return;
    await graphStore.relateNoteToThought(noteId, thoughtId, edge);
  });

  ipcMain.handle(IPC.THOUGHT_UNRELATE, async (_event, noteId: string, thoughtId: string) => {
    if (!isDBReady()) return;
    await graphStore.removeNoteToThought(noteId, thoughtId);
  });
}
