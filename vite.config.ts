/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strips any `<script type="importmap">` blocks from built HTML bundles so
 * browser extensions injecting module scripts at `document_start` never trigger
 * `TypeError: An import map is added after module script load was triggered`.
 */
function stripImportmapsForBundlePlugin(): Plugin {
  let isBuild = false;
  return {
    name: 'strip-importmaps-for-bundle',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    transformIndexHtml: {
      order: 'post',
      handler(html: string) {
        if (!isBuild) return html;
        return html.replace(
          /<script\b[^>]*\btype\s*=\s*['"]importmap['"][^>]*>[\s\S]*?<\/script>\s*/gi,
          ''
        );
      },
    },
  };
}

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    plugins: [react(), stripImportmapsForBundlePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
