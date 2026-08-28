import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Trading logic shared between the browser engine and the Deno worker.
      // One implementation, so the backtest, the browser engine and the server
      // worker cannot drift apart. Copied into the function bundle at deploy
      // time by `npm run sync:functions`.
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
});
