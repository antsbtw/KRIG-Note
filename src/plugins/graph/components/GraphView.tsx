import { useEffect, useRef } from 'react';
import { SceneManager } from '../rendering/scene/SceneManager';
import { buildSubstanceCatalogue, disposeSubstanceCatalogue } from '../rendering/SubstanceCatalogueDemo';
import type * as THREE from 'three';

/**
 * GraphView — B1 阶段：Substance 视觉对照表（demo）。
 *
 * 当前阶段策略（按用户要求"先看到 substance + label"）：
 *   - 进入 Graph 模式立刻渲染所有内置 substance 的视觉对照
 *   - 不读 activeGraphId / 不接数据库 / 不接交互
 *   - 不区分 NavSide 选择哪个图谱（永远显示同样的 demo）
 *
 * 后续 B 阶段会逐步加：
 *   B2-B5  缩放 / 平移 / fitView
 *   B6+    label（SVG 几何）
 *   D-*    真实数据流接入（取代 demo）
 */
export function GraphView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const demoRootRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new SceneManager();
    scene.mount(containerRef.current);
    sceneRef.current = scene;

    // 加载 substance 对照表
    const { root } = buildSubstanceCatalogue();
    scene.scene.add(root);
    demoRootRef.current = root;
    // fitToContent 必须在加几何体之后调 — 让画布一定完整显示所有内容
    scene.fitToContent();

    return () => {
      if (demoRootRef.current) {
        scene.scene.remove(demoRootRef.current);
        disposeSubstanceCatalogue(demoRootRef.current);
        demoRootRef.current = null;
      }
      scene.unmount();
      sceneRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#1e1e1e' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={hintStyle}>
        Substance 视觉对照表（B1 阶段 demo）· 4 Point + 5 Line + 1 Surface
      </div>
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  fontSize: 11,
  color: '#888',
  background: 'rgba(0,0,0,0.5)',
  padding: '4px 10px',
  borderRadius: 4,
  pointerEvents: 'none',
  userSelect: 'none',
  zIndex: 10,
};
