import { BrowserWindow, WebContentsView } from 'electron';
import { ViewType, ViewTypeRegistration, ViewInstanceId, Bounds } from '../../shared/types';

/**
 * View 类型注册表
 *
 * 管理所有已注册的 View 类型。框架不硬编码任何 ViewType，
 * 全部由插件通过 register() 声明。
 */
class ViewTypeRegistry {
  private types: Map<ViewType, ViewTypeRegistration> = new Map();

  register(registration: ViewTypeRegistration): void {
    if (this.types.has(registration.type)) {
      console.warn(`ViewType '${registration.type}' already registered, overwriting.`);
    }
    this.types.set(registration.type, registration);
  }

  get(type: ViewType): ViewTypeRegistration | undefined {
    return this.types.get(type);
  }

  getAll(): ViewTypeRegistration[] {
    return Array.from(this.types.values());
  }
}

export const viewTypeRegistry = new ViewTypeRegistry();

/**
 * View 实例管理器
 *
 * 管理所有活跃的 View 实例（WebContentsView）。
 * 每个 View 实例对应一个独立的 renderer 进程。
 */
export interface ViewInstance {
  instanceId: ViewInstanceId;
  type: ViewType;
  variant?: string;
  webContentsView: WebContentsView;
  created: boolean;
}

class ViewInstanceManager {
  private instances: Map<ViewInstanceId, ViewInstance> = new Map();
  private counter = 0;

  /** 生成 View 实例 ID */
  generateId(type: ViewType, workspaceId: string, variant?: string): ViewInstanceId {
    const suffix = variant ? `${type}-${variant}` : type;
    return `${suffix}-${workspaceId}-${++this.counter}`;
  }

  /** 创建 View 实例（懒创建：创建 WebContentsView 但不加载内容） */
  create(
    instanceId: ViewInstanceId,
    type: ViewType,
    variant: string | undefined,
    htmlPath: string,
    preloadPath: string,
  ): ViewInstance {
    const webContentsView = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    webContentsView.webContents.loadFile(htmlPath);

    const instance: ViewInstance = {
      instanceId,
      type,
      variant,
      webContentsView,
      created: true,
    };

    this.instances.set(instanceId, instance);
    return instance;
  }

  /** 获取 View 实例 */
  get(instanceId: ViewInstanceId): ViewInstance | undefined {
    return this.instances.get(instanceId);
  }

  /** 显示 View 实例 */
  show(instanceId: ViewInstanceId, window: BrowserWindow, bounds: Bounds): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const contentView = window.contentView;
    if (!contentView.children.includes(instance.webContentsView)) {
      contentView.addChildView(instance.webContentsView);
    }
    instance.webContentsView.setBounds(bounds);
    instance.webContentsView.setVisible(true);
  }

  /** 隐藏 View 实例 */
  hide(instanceId: ViewInstanceId): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.webContentsView.setVisible(false);
  }

  /** 销毁 View 实例 */
  destroy(instanceId: ViewInstanceId, window: BrowserWindow): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const contentView = window.contentView;
    if (contentView.children.includes(instance.webContentsView)) {
      contentView.removeChildView(instance.webContentsView);
    }
    instance.webContentsView.webContents.close();
    this.instances.delete(instanceId);
  }

  /** 销毁一组 View 实例 */
  destroyMany(instanceIds: ViewInstanceId[], window: BrowserWindow): void {
    for (const id of instanceIds) {
      this.destroy(id, window);
    }
  }

  /** 获取所有 View 实例 */
  getAll(): ViewInstance[] {
    return Array.from(this.instances.values());
  }
}

export const viewInstanceManager = new ViewInstanceManager();
