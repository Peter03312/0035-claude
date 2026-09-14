#!/usr/bin/env bash
# 一次性校验：单元测试 → 生产构建 → 端到端测试（Vite preview 由 Playwright webServer 自行启动）
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/3 Vitest 单元测试 =="
npm run test:unit

echo "== 2/3 生产构建 =="
npm run build

echo "== 3/3 Playwright 端到端测试 =="
npm run test:e2e

echo "== verify 通过：测试与生产构建全部成功 =="
