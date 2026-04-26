import { createRoot } from 'react-dom/client';
import { NavSide } from './NavSide';

// 插件面板注册（每个插件 navside/register.ts 副作用注册）
import '../../plugins/note/navside/register';
import '../../plugins/graph/navside/register';
import '../../plugins/ebook/navside/register';
import '../../plugins/web/navside/register';

const root = createRoot(document.getElementById('root')!);
root.render(<NavSide />);
