/**
 * v2 渲染层入口。
 *
 * 数据流：
 *   viewAPI.graphLoadFull → { graph, geometries, intensions, presentations }
 *      ↓
 *   layout.compute(...) → positions
 *      ↓
 *   GraphRenderer.setData({ geometries, intensions, presentations, positions })
 *      ↓
 *   compose() → RenderableGeometry[]
 *      ↓
 *   PointMesh / LineMesh / SurfaceMesh → Three.js scene
 */
export { GraphRenderer } from './GraphRenderer';
export type { GraphRendererInput } from './GraphRenderer';
export type { RenderableGeometry, ResolvedVisual } from './types';
