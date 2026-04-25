/**
 * 字体资源入口
 *
 * Vite 的 ?url 后缀返回静态资源的 URL 字符串。dev 模式直接返回 dev server 路径，
 * build 模式会被复制到 dist/assets/ 并加 hash。
 *
 * opentype.js 通过 fetch(url).arrayBuffer() 加载后调用 parse()。
 */
import interUrl from './Inter-Regular.ttf?url';
import notoSansScUrl from './NotoSansSC-Regular.ttf?url';

export const FONT_URLS = {
  inter: interUrl,
  notoSansSc: notoSansScUrl,
};

export type FontKey = keyof typeof FONT_URLS;
