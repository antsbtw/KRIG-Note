/**
 * paste-media — 剪贴板图片粘贴插件
 *
 * 检测 clipboardData 中的图片文件，自动创建 image block。
 * 智能插入位置：
 * - 当前在空 textBlock → 替换为 image
 * - 否则 → 在当前 block 之后插入
 * 用 $from.depth 定位当前 block，能正确处理 2column 等嵌套容器。
 */

import { Plugin } from 'prosemirror-state';

export function pasteMediaPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const cd = event.clipboardData;
        const items = cd?.items;
        if (!cd || !items) return false;

        // 找到图片文件
        let imageFile: File | null = null;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            imageFile = items[i].getAsFile();
            if (imageFile) break;
          }
        }
        if (!imageFile) return false;

        // Word / Excel copy a structured region and bundle a PNG render
        // as a fallback next to text/html. Without this check we'd always
        // insert the bitmap, losing the actual table/heading structure.
        // Only yield to smart-paste when the HTML has structural markup
        // (tables or headings) — a plain-formatted text snippet would
        // mis-render as fragmented text nodes (the Wikipedia case).
        const html = cd.getData('text/html') || '';
        if (/<\s*(table|thead|tbody|tr|th|td|h[1-6])\b/i.test(html)) {
          return false; // defer to smart-paste
        }

        // 读取为 data URL
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const { state } = view;
          const { $from } = state.selection;
          const schema = state.schema;

          // 确认 schema 有 image 节点
          if (!schema.nodes.image) return;

          // 创建 image node（含 caption paragraph）
          const captionNode = schema.nodes.textBlock?.create() || schema.nodes.paragraph?.create();
          if (!captionNode) return;
          const imageNode = schema.nodes.image.create({ src: dataUrl }, captionNode);

          // 智能插入位置：用 $from.depth 而非硬编码 1，
          // 这样在 2column 等嵌套容器里也能落到"当前光标所在的那一段/那一列"。
          const depth = Math.max(1, $from.depth);
          const blockPos = $from.before(depth);
          const blockNode = state.doc.nodeAt(blockPos);

          let tr = state.tr;

          if (
            blockNode &&
            blockNode.type.name === 'textBlock' &&
            blockNode.textContent.length === 0 &&
            !blockNode.attrs.isTitle
          ) {
            // 空 textBlock → 替换
            tr = tr.replaceWith(blockPos, blockPos + blockNode.nodeSize, imageNode);
          } else {
            // 在当前 block 之后插入
            const afterPos = blockPos + (blockNode?.nodeSize || 0);
            tr = tr.insert(afterPos, imageNode);
          }

          view.dispatch(tr);
        };
        reader.readAsDataURL(imageFile);

        // 阻止默认粘贴行为
        return true;
      },
    },
  });
}
