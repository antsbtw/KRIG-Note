import * as THREE from 'three';
import { CircleShape } from './shapes/CircleShape';
import { SvgGeometryContent } from './contents/SvgGeometryContent';
import { NodeRenderer } from './NodeRenderer';
import type { PocNode } from './types';

export class PocScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private nodeRenderer: NodeRenderer;
  private container: HTMLElement;
  private rafId = 0;
  private nodeGroups: THREE.Group[] = [];

  perfStats = { lastNodeMs: 0, totalNodes: 0, totalSetupMs: 0 };

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

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    for (const g of this.nodeGroups) this.nodeRenderer.dispose(g);
    this.nodeGroups = [];
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
