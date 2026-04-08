/**
 * viewAPI 类型声明 — EBook 渲染进程统一入口
 *
 * 由 preload 脚本注入到 window 上。所有组件/hooks 共享此声明。
 */

/** 统一的阅读位置/视图状态 */
interface ReadingPosition {
  page?: number;
  scale?: number;
  fitWidth?: boolean;
  cfi?: string;
}

interface EBookLoadedInfo {
  bookId: string;
  fileName: string;
  fileType: string;
  lastPosition?: ReadingPosition;
}

declare const viewAPI: {
  ebookGetData: () => Promise<{ filePath: string; fileName: string; data: ArrayBuffer } | null>;
  ebookClose: () => Promise<void>;
  ebookRestore: () => Promise<EBookLoadedInfo | null>;
  ebookSetActiveBook: (bookId: string | null) => Promise<void>;
  ebookSaveProgress: (bookId: string, position: ReadingPosition) => Promise<void>;
  ebookBookmarkToggle: (bookId: string, page: number) => Promise<number[]>;
  ebookBookmarkList: (bookId: string) => Promise<number[]>;
  ebookCFIBookmarkAdd: (bookId: string, cfi: string, label: string) => Promise<Array<{ cfi: string; label: string }>>;
  ebookCFIBookmarkRemove: (bookId: string, cfi: string) => Promise<Array<{ cfi: string; label: string }>>;
  ebookCFIBookmarkList: (bookId: string) => Promise<Array<{ cfi: string; label: string }>>;
  ebookAnnotationList: (bookId: string) => Promise<any[]>;
  ebookAnnotationAdd: (bookId: string, ann: unknown) => Promise<any>;
  ebookAnnotationRemove: (bookId: string, annotationId: string) => Promise<void>;
  onEbookLoaded: (callback: (info: EBookLoadedInfo) => void) => () => void;
};
