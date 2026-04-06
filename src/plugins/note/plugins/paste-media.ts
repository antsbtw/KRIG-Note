/**
 * paste-media — 剪贴板图片粘贴插件
 *
 * 检测 clipboardData 中的图片文件，自动创建 image block。
 * 智能插入位置：
 * - 当前在空 textBlock → 替换为 image
 * - 否则 → 在当前 block 之后插入
 */

import { Plugin } from 'prosemirror-state';

export function pasteMediaPlugin(): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;

        // 找到图片文件
        let imageFile: File | null = null;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            imageFile = items[i].getAsFile();
            if (imageFile) break;
          }
        }
        if (!imageFile) return false;

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

          // 智能插入位置
          const blockPos = $from.before(1);
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
