/**
 * Note 插件 NavSide 面板注册入口。
 *
 * 由 src/renderer/navside/renderer.tsx 在启动时 import 触发副作用注册。
 */
import { registerNavPanel } from '../../../renderer/navside/panel-registry';
import { NotePanel } from './NotePanel';

registerNavPanel('note-list', NotePanel);
