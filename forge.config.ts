import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'KRIG Note',
    icon: './build/icon',
    executableName: 'KRIG Note',
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
      ],
      renderer: [
        {
          name: 'shell',
          config: 'vite.shell.config.mts',
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
      ],
    }),
  ],
};

export default config;
