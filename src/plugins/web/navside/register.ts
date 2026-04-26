/**
 * Web 插件 NavSide 面板注册入口（v1.4 NavSide 重构 M5）。
 *
 * 由 src/renderer/navside/renderer.tsx 在启动时 import 触发副作用注册。
 *
 * Web 工作模式有两个 contentType：
 * - web-bookmarks：网页书签 + 文件夹（FolderTree 消费者）
 * - ai-services：AI 服务列表（极简静态展示）
 */
import { registerNavPanel } from '../../../renderer/navside/panel-registry';
import { WebPanel } from './WebPanel';
import { AIServicesPanel } from './AIServicesPanel';

registerNavPanel('web-bookmarks', WebPanel);
registerNavPanel('ai-services', AIServicesPanel);
