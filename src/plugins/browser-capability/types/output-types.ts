export type MediaPutInput = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type MediaPutResult = {
  storageRef: string;
};

export type CaptureTraceInput = {
  pageId: string;
  stage: string;
  payload: unknown;
};

export type NoteAppendInput = {
  noteId: string;
  content:
    | {
        kind: 'markdown';
        markdown: string;
      }
    | {
        kind: 'structured';
        blocks: unknown[];
      };
  metadata?: Record<string, unknown>;
};
