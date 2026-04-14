import { createRoot } from 'react-dom/client';
import { NavSide } from './NavSide';
import { registerNavPanel } from './panel-registry';
import { EBookPanel } from './EBookPanel';
import { WebPanel } from '../../plugins/web/navside/WebPanel';
import { AIServicesPanel } from '../../plugins/web/navside/AIServicesPanel';

// 插件面板注册
registerNavPanel('ebook-bookshelf', EBookPanel);
registerNavPanel('web-bookmarks', WebPanel);
registerNavPanel('ai-services', AIServicesPanel);

const root = createRoot(document.getElementById('root')!);
root.render(<NavSide />);
