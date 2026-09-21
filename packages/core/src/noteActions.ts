import { newId } from './id.js';
import type { AppData, AppSettings, Note } from './types.js';

export const addNote = (data: AppData, body: string): { data: AppData; note: Note | null } => {
  const text = body.trim();
  if (!text) return { data, note: null };

  const now = new Date().toISOString();
  const note: Note = {
    id: newId(),
    body: text,
    pinned: false,
    done: false,
    createdAt: now,
    updatedAt: now,
  };
  return { data: { ...data, notes: [note, ...data.notes] }, note };
};

export const updateNote = (data: AppData, id: string, patch: Partial<Note>): AppData => ({
  ...data,
  notes: data.notes.map((n) =>
    n.id === id ? { ...n, ...patch, id: n.id, updatedAt: new Date().toISOString() } : n,
  ),
});

export const deleteNote = (data: AppData, id: string): AppData => ({
  ...data,
  notes: data.notes.filter((n) => n.id !== id),
});

export const updateSettings = (data: AppData, settings: Partial<AppSettings>): AppData => ({
  ...data,
  settings: { ...data.settings, ...settings },
});
