import { createRoot } from 'react-dom/client';
import { NavSide } from './NavSide';
import { registerNavPanel } from './panel-registry';

// 插件面板注册（每个插件 navside/register.ts 副作用注册）
import '../../plugins/note/navside/register';
import '../../plugins/graph/navside/register';
// 以下 3 个面板物理位置尚未迁移（M4/M5），暂保持就地 import
import { EBookPanel } from './EBookPanel';
import { WebPanel } from '../../plugins/web/navside/WebPanel';
import { AIServicesPanel } from '../../plugins/web/navside/AIServicesPanel';

registerNavPanel('ebook-bookshelf', EBookPanel);
registerNavPanel('web-bookmarks', WebPanel);
registerNavPanel('ai-services', AIServicesPanel);

const root = createRoot(document.getElementById('root')!);
root.render(<NavSide />);
