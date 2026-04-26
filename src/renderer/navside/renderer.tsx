import { createRoot } from 'react-dom/client';
import { NavSide } from './NavSide';
import { registerNavPanel } from './panel-registry';

// 插件面板注册（每个插件 navside/register.ts 副作用注册）
import '../../plugins/note/navside/register';
// 以下 4 个面板物理位置尚未迁移（M3/M4/M5），暂保持就地 import
import { EBookPanel } from './EBookPanel';
import { WebPanel } from '../../plugins/web/navside/WebPanel';
import { AIServicesPanel } from '../../plugins/web/navside/AIServicesPanel';
import { GraphPanel } from './GraphPanel';

registerNavPanel('ebook-bookshelf', EBookPanel);
registerNavPanel('web-bookmarks', WebPanel);
registerNavPanel('ai-services', AIServicesPanel);
registerNavPanel('graph-list', GraphPanel);

const root = createRoot(document.getElementById('root')!);
root.render(<NavSide />);
