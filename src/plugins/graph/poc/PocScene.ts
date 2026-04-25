import * as THREE from 'three';
import { CircleShape } from './shapes/CircleShape';
import { SvgGeometryContent } from './contents/SvgGeometryContent';
import { NodeRenderer } from './NodeRenderer';
import type { PocNode } from './types';

const NODE_COLOR_DEFAULT = 0x4a90e2;
const NODE_COLOR_HOVER = 0xffaa3b;

export class PocScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private nodeRenderer: NodeRenderer;
  private container: HTMLElement;
  private rafId = 0;
  private nodeGroups: THREE.Group[] = [];

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private hoveredGroup: THREE.Group | null = null;
  onHoverChange?: (id: string | null) => void;

  perfStats = { lastNodeMs: 0, totalNodes: 0, totalSetupMs: 0, fps: 0 };
  private fpsFrames = 0;
  private fpsLastT = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x1e1e1e);

    const { clientWidth: w, clientHeight: h } = container;
    this.camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -1000, 1000);
    this.camera.position.z = 10;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.nodeRenderer = new NodeRenderer(new CircleShape(), new SvgGeometryContent());

    this.startLoop();
    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('mousemove', this.handlePointerMove);
    this.renderer.domElement.addEventListener('mouseleave', this.handlePointerLeave);
  }

  async loadNodes(nodes: PocNode[]): Promise<void> {
    const t0 = performance.now();
    for (const node of nodes) {
      const tNode = performance.now();
      const group = await this.nodeRenderer.createNode(node);
      this.scene.add(group);
      this.nodeGroups.push(group);
      this.perfStats.lastNodeMs = performance.now() - tNode;
    }
    this.perfStats.totalNodes = nodes.length;
    this.perfStats.totalSetupMs = performance.now() - t0;
  }

  private startLoop = () => {
    const tick = () => {
      this.renderer.render(this.scene, this.camera);
      this.fpsFrames++;
      const now = performance.now();
      const dt = now - this.fpsLastT;
      if (dt >= 500) {
        this.perfStats.fps = (this.fpsFrames * 1000) / dt;
        this.fpsFrames = 0;
        this.fpsLastT = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  };

  private handleResize = () => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private handlePointerMove = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.updateHover();
  };

  private handlePointerLeave = () => {
    this.setHovered(null);
  };

  private updateHover(): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 只命中节点 group 的第一个 child（CircleShape 的圆）
    const shapeMeshes = this.nodeGroups
      .map((g) => g.children[0])
      .filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    const hits = this.raycaster.intersectObjects(shapeMeshes, false);
    const hitGroup = hits.length > 0 ? (hits[0].object.parent as THREE.Group | null) : null;
    this.setHovered(hitGroup);
  }

  private setHovered(group: THREE.Group | null): void {
    if (group === this.hoveredGroup) return;
    if (this.hoveredGroup) {
      const mesh = this.hoveredGroup.children[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(NODE_COLOR_DEFAULT);
    }
    if (group) {
      const mesh = group.children[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(NODE_COLOR_HOVER);
    }
    this.hoveredGroup = group;
    this.renderer.domElement.style.cursor = group ? 'pointer' : 'default';
    this.onHoverChange?.((group?.userData.id as string) ?? null);
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.domElement.removeEventListener('mousemove', this.handlePointerMove);
    this.renderer.domElement.removeEventListener('mouseleave', this.handlePointerLeave);
    for (const g of this.nodeGroups) this.nodeRenderer.dispose(g);
    this.nodeGroups = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
