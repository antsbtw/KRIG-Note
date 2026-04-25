import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 按目标平台/架构挑 surreal 二进制塞进 resources/
// （electron-forge 通过 --platform / --arch 传入，env var 读不到时取当前机器）
function surrealBinaryForTarget(): string[] {
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const key = platform === 'win32' ? 'win32-x64'
    : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
    : platform === 'linux' ? 'linux-x64'
    : null;
  if (!key) return [];
  const filename = platform === 'win32' ? 'surreal.exe' : 'surreal';
  const p = path.resolve(__dirname, 'build', 'surreal', key, filename);
  return existsSync(p) ? [p] : [];
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'KRIG Note',
    icon: './build/icon',
    executableName: 'KRIG Note',
    extraResource: surrealBinaryForTarget(),
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/app.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/main/preload/shell.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/main/preload/navside.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/main/preload/view.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/main/preload/divider.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
        {
          entry: 'src/main/preload/web-content.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'shell',
          config: 'vite.shell.config.mts',
        },
        {
          name: 'overlay',
          config: 'vite.overlay.config.mts',
        },
        {
          name: 'navside',
          config: 'vite.navside.config.mts',
        },
        {
          name: 'demo_view',
          config: 'vite.demo-view.config.mts',
        },
        {
          name: 'note_view',
          config: 'vite.note.config.mts',
        },
        {
          name: 'ebook_view',
          config: 'vite.ebook.config.mts',
        },
        {
          name: 'web_view',
          config: 'vite.web.config.mts',
        },
        {
          name: 'thought_view',
          config: 'vite.thought.config.mts',
        },
      ],
    }),
  ],
};

export default config;
