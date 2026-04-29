import { useEffect, useRef, useState } from 'react';
import { SceneManager } from './scene/SceneManager';
import { ShapeRegistry, shapeToThree } from '../library/shapes';
import { SubstanceRegistry } from '../library/substances';

/**
 * CanvasView — Graph view 主组件(canvas variant)
 *
 * 结构:Toolbar(顶部 36px,M1.4a 完成)+ 全屏 Canvas 容器 + Empty overlay
 *
 * 关键约束(对齐 memory):
 * - canvas-container div 始终 mount(empty/canvas 用 overlay 切换),否则
 *   ref 时机错过让 SceneManager 永远不挂(feedback_canvas_container_must_always_render)
 * - SceneManager 内部处理 Retina + ResizeObserver(feedback_threejs_retina_setsize)
 */

export function CanvasView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneManagerRef = useRef<SceneManager | null>(null);
  const [sceneReady, setSceneReady] = useState(false);

  // SceneManager 生命周期
  useEffect(() => {
    if (!containerRef.current) return;
    // bootstrap library(幂等,多次调用安全)
    ShapeRegistry.bootstrap();
    SubstanceRegistry.bootstrap();

    const sm = new SceneManager(containerRef.current);
    sceneManagerRef.current = sm;
    setSceneReady(true);

    // M1.2a 自检:挂一个测试 mesh(M1.2b 完成后改成真正的 instance 渲染)
    addDevSelfCheck(sm);

    return () => {
      sm.dispose();
      sceneManagerRef.current = null;
      setSceneReady(false);
    };
  }, []);

  return (
    <div style={styles.container}>
      {/* Toolbar — M1.4a 完成,这里先占位 */}
      <div style={styles.toolbar}>
        <span style={styles.toolbarTitle}>Canvas</span>
        <div style={{ flex: 1 }} />
        <span style={styles.toolbarHint}>{sceneReady ? 'scene ready' : 'loading…'}</span>
      </div>

      {/* Canvas 容器:始终 mount,SceneManager 在 useEffect 里挂 renderer */}
      <div style={styles.canvasWrap}>
        <div ref={containerRef} style={styles.canvasContainer} />
      </div>
    </div>
  );
}

/**
 * Dev self-check:挂一个 roundRect 测试 mesh + fitToContent
 * M1.2b 完成后改成基于 instance JSON 的真渲染管线。
 */
function addDevSelfCheck(sm: SceneManager): void {
  const shape = ShapeRegistry.get('krig.basic.roundRect');
  if (!shape) {
    console.warn('[CanvasView dev-self-check] roundRect missing');
    return;
  }
  const out = shapeToThree(shape, { width: 200, height: 100 });
  // 摆在画板坐标 (100, 80) 处
  out.group.position.set(100, 80, 0);
  sm.scene.add(out.group);

  // 再加一个 ellipse 在右边
  const ellipse = ShapeRegistry.get('krig.basic.ellipse');
  if (ellipse) {
    const out2 = shapeToThree(ellipse, { width: 120, height: 120 });
    out2.group.position.set(380, 80, 0);
    sm.scene.add(out2.group);
  }

  // 一定要主动 fit(memory: feedback_canvas_must_show_all_content)
  // 用包含两个 mesh 的 box;不直接 fitToContent(scene) 因为 scene 还有 background/light
  sm.fitToBox({ minX: 50, minY: 50, maxX: 550, maxY: 250 });
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1e1e1e',
    color: '#e8eaed',
  },
  // Toolbar:对齐 NoteView 视觉(36px / #252525 / #333 边框 / 4px gap)
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 36,
    padding: '0 12px',
    borderBottom: '1px solid #333',
    background: '#252525',
    flexShrink: 0,
  },
  toolbarTitle: {
    fontSize: 13,
    fontWeight: 500,
  },
  toolbarHint: {
    fontSize: 11,
    color: '#888',
  },
  canvasWrap: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  canvasContainer: {
    width: '100%',
    height: '100%',
  },
};
