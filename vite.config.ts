/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    coverage: { provider: 'v8' }
  }
})
