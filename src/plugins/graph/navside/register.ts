/**
 * Graph 插件 NavSide 面板注册入口（v1.4 NavSide 重构 M3）。
 *
 * 由 src/renderer/navside/renderer.tsx 在启动时 import 触发副作用注册。
 */
import { registerNavPanel } from '../../../renderer/navside/panel-registry';
import { GraphPanel } from './GraphPanel';

registerNavPanel('graph-list', GraphPanel);
