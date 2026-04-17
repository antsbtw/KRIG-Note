export type NetworkRecord = {
  requestId: string;
  pageId: string;
  frameId?: string | null;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  startedAt: string;
  finishedAt?: string;
  bodyRef?: string;
  bodyBytes?: number;
  providerRequestId?: string;
};

export type NetworkEvent =
  | {
      kind: 'request-start';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      url: string;
      method: string;
      at: string;
    }
  | {
      kind: 'response-chunk';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      mimeType?: string;
      chunkText?: string;
      chunkBytesRef?: string;
      at: string;
    }
  | {
      kind: 'response-complete';
      pageId: string;
      frameId?: string | null;
      requestId: string;
      status?: number;
      bodyRef?: string;
      at: string;
    }
  | {
      kind: 'download-complete';
      pageId: string;
      frameId?: string | null;
      downloadId: string;
      filename: string;
      storageRef?: string;
      at: string;
    };
