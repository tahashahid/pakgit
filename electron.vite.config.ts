import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'

// The renderer is an Angular application built by the Angular CLI (see angular.json);
// electron-vite only builds the main and preload bundles here.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
