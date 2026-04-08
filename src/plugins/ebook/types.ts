/**
 * eBook 渲染引擎类型系统
 *
 * 核心设计：两种渲染模式
 * - FixedPage（PDF、DjVu、CBZ）：固定页面，Canvas 逐页渲染，空间坐标标注
 * - Reflowable（EPUB）：可重排 HTML，iframe 渲染，CFI 定位标注
 *
 * EBookView 通过 renderMode 判断使用哪种 Content 组件。
 */

// ── 基础类型 ──

/** 支持的电子书格式 */
export type EBookFileType = 'pdf' | 'epub' | 'djvu' | 'cbz';

/** 渲染模式：决定使用哪种 Content 组件 */
export type RenderMode = 'fixed-page' | 'reflowable';

/** 页面尺寸（scale=1 时） */
export interface PageDimension {
  width: number;
  height: number;
}

// ── 位置系统 ──

/** 固定页面的位置 */
export interface PagePosition {
  type: 'page';
  page: number;
  scrollOffset?: number;
}

/** 可重排内容的位置（EPUB CFI） */
export interface CFIPosition {
  type: 'cfi';
  cfi: string;
  /** 人类可读描述（"第 3 章 · 42%"） */
  display?: string;
}

/** 统一的位置类型 */
export type BookPosition = PagePosition | CFIPosition;

// ── 标注系统 ──

/** 固定页面的标注锚点（空间坐标） */
export interface SpatialAnchor {
  type: 'spatial';
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
}

/** 可重排内容的标注锚点（CFI 范围） */
export interface CFIAnchor {
  type: 'cfi';
  cfiRange: string;       // 起止 CFI
  textContent?: string;   // 标注的文本内容
}

/** 统一的标注锚点类型 */
export type AnnotationAnchor = SpatialAnchor | CFIAnchor;

// ── Toolbar 配置 ──

export interface ToolbarConfig {
  navigation: 'page' | 'chapter';
  zoom: 'scale' | 'fontSize';
  totalPages: number | null;
  /** 章节列表（EPUB 用） */
  chapters?: { label: string; href: string }[];
}

// ── 目录（TOC） ──

export interface TOCItem {
  label: string;
  position: BookPosition;
  children?: TOCItem[];
}

// ── 渲染引擎接口 ──

/**
 * IBookRenderer — 基础渲染引擎接口
 *
 * 所有格式共享的最小接口。
 */
export interface IBookRenderer {
  readonly fileType: EBookFileType;
  readonly renderMode: RenderMode;

  // 生命周期
  load(data: ArrayBuffer): Promise<void>;
  destroy(): void;

  // Toolbar
  getToolbarConfig(): ToolbarConfig;

  // 导航
  getPosition(): BookPosition;
  goTo(position: BookPosition): void;

  // 目录
  getTOC(): Promise<TOCItem[]>;
}

/**
 * IFixedPageRenderer — 固定页面渲染引擎（PDF、DjVu、CBZ）
 *
 * 扩展基础接口，添加固定页面特有的能力。
 * 由 FixedPageContent 组件使用。
 */
export interface IFixedPageRenderer extends IBookRenderer {
  readonly renderMode: 'fixed-page';

  // 页面信息
  getPageDimensions(): PageDimension[];
  getTotalPages(): number;

  // 缩放
  setScale(scale: number): void;
  getScale(): number;

  // Canvas 渲染
  renderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  invalidateAll(): void;

  // Text Layer（文本选择 + 复制）
  renderTextLayer(pageNum: number, container: HTMLElement, scale: number): Promise<void>;
  clearTextLayer(pageNum: number): void;

  // 文本搜索
  searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>>;
}

/**
 * IReflowableRenderer — 可重排渲染引擎（EPUB）
 *
 * 扩展基础接口，添加可重排格式特有的能力。
 * 由 ReflowableContent 组件使用。
 */
export interface IReflowableRenderer extends IBookRenderer {
  readonly renderMode: 'reflowable';

  // 渲染到 DOM 容器（iframe 或 shadow DOM）
  renderTo(container: HTMLElement): void;

  // 字体大小
  setFontSize(size: number): void;
  getFontSize(): number;

  // 阅读进度
  getProgress(): { chapter: string; percentage: number };

  // 章节导航
  nextChapter(): void;
  prevChapter(): void;

  // 分页 / 滚动模式切换
  setDisplayMode(mode: 'paginated' | 'scrolled'): void;

  // 视口变化时重排
  onResize(): void;

  // 进度保存/恢复
  getLastCFI(): string | null;
  setRestoreLocation(cfi: string): void;

  // 进度变化回调
  onRelocate(callback: (progress: { chapter: string; percentage: number }) => void): void;

  // 搜索
  searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>>;
  clearSearch(): void;
}

// ── 类型守卫 ──

export function isFixedPage(renderer: IBookRenderer): renderer is IFixedPageRenderer {
  return renderer.renderMode === 'fixed-page';
}

export function isReflowable(renderer: IBookRenderer): renderer is IReflowableRenderer {
  return renderer.renderMode === 'reflowable';
}

// ── 工具函数 ──

/** 根据文件扩展名推断格式 */
export function detectFileType(fileName: string): EBookFileType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'epub': return 'epub';
    case 'djvu': return 'djvu';
    case 'cbz': case 'cbr': return 'cbz';
    default: return 'pdf';
  }
}

/** 格式 → 渲染模式映射 */
export function getRenderMode(fileType: EBookFileType): RenderMode {
  switch (fileType) {
    case 'epub': return 'reflowable';
    default: return 'fixed-page';
  }
}
