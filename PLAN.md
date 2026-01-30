# Mokup VS Code 插件方案（MVP 计划）

> 目标：为 mokup 提供 VS Code 侧的“配置识别 + OpenAPI/d.ts 导入导出 + mock 管理与预览”。

## 1. 背景与约束
- mokup 是文件驱动路由框架，支持 Vite 插件与多运行时适配。
- mock 路由来自文件名与目录结构，支持 method 后缀、index、动态参数与 JSON/JSONC 文件。
- 目录级配置通过 `index.config.ts` 提供 headers/status/delay/ignore 等配置与中间件。
- Vite 插件的 `entries` 支持单对象或数组配置，可声明 `dir`/`prefix`/`watch` 等。

## 2. 借鉴 Simon-He95 插件的“精髓”
1) 开箱即用、低侵入：让用户“安装即用”，减少强制配置步骤。
2) 多场景覆盖：支持多源、多包、多入口，并允许用户在冲突时手动选择。
3) 配置可扩展：支持远程/本地数据源映射，方便私有化或自定义扩展。

> 以上原则将映射为：自动识别 entries、包级隔离、多配置源绑定、可选的手动校正。

## 3. 目标功能（MVP）
### 3.1 项目识别
- 扫描 `vite.config.*`/`vitest.config.*` 中 `mokup/vite` 插件配置，提取 `entries`。
- 支持 `entries` 为对象或数组，兼容多目录与多前缀。
- 识别 `index.config.ts` 与路由文件规则，构建 routes tree。
- 兼容 monorepo（工作区多包独立识别 + 配置隔离）。

### 3.2 OpenAPI（本地文件）
- 本地 yaml/json 导入（OpenAPI 3.1 优先，兼容 3.0）。
- 导入后默认写入 mock 文件（基于 entries 的 dir）。
- 支持保留 `info/servers/tags` 等元数据导出。
- 支持 diff / 覆盖 / 合并 的冲突策略。

### 3.3 d.ts → schema → mock / OpenAPI
- 解析 `.d.ts` 中的 type/interface。
- 兼容 Zod（优先读取 Zod schema，再映射为 JSON Schema）。
- 输出 mock 与 OpenAPI `components.schemas`。

### 3.4 运行与预览
- 提供包级 Start/Stop（可选调用 mokup CLI 或复用 Vite dev）。
- Webview 预览 mock 响应（刷新/复制）。
- 状态栏显示 mock 实例状态。

## 4. 识别与绑定流程（单仓 + monorepo）
1) 扫描工作区 -> 找到 packages（pnpm-workspace.yaml / workspaces）。
2) 每个 package：
   - 解析 Vite config 提取 entries。
   - 若无 entries：扫描 mock 目录与 `index.config.ts` 作为兜底。
3) 绑定 OpenAPI 文件到 package（可多选），用于导入/导出。
4) 生成 routes tree -> 侧边栏显示。

## 5. 数据流设计
- OpenAPI → JSON Schema → Mokup Routes & Handlers
- d.ts / Zod → JSON Schema → Mokup Routes & OpenAPI Schemas
- Mokup Routes → OpenAPI Paths/Components

## 6. 模块拆分（建议目录）
- `src/activation/scan.ts`：工作区扫描与包识别
- `src/config/entries.ts`：entries 解析与缓存
- `src/openapi/loader.ts`：yaml/json 读取
- `src/openapi/compat.ts`：3.1/3.0 兼容
- `src/openapi/mapper.ts`：OpenAPI → Mokup
- `src/openapi/exporter.ts`：Mokup → OpenAPI
- `src/dts/parser.ts`：ts/dts 解析
- `src/dts/zod-mapper.ts`：Zod → Schema
- `src/mock/writer.ts`：mock 文件落盘
- `src/tree/provider.ts`：侧边栏树
- `src/preview/webview.ts`：预览 UI
- `src/runner/process.ts`：启动/停止与日志

## 7. 命令设计（MVP）
- `Mokup: Import OpenAPI`
- `Mokup: Export OpenAPI`
- `Mokup: Import DTS`
- `Mokup: Rescan Workspace`
- `Mokup: Start/Stop Mock`
- `Mokup: Preview Mock Response`

## 8. 配置项（建议默认）
- `mokup.openapi.import.writeFiles`: `true`
- `mokup.openapi.scanGlobs`: `**/*.{yaml,yml,json}`
- `mokup.dts.scanGlobs`: `**/*.d.ts`
- `mokup.workspace.monorepoMode`: `auto`
- `mokup.entries.preferViteConfig`: `true`

## 9. 里程碑
- M1：entries 识别 + routes tree + OpenAPI 导入
- M2：d.ts/Zod 导入 + OpenAPI 导出
- M3：预览 + runner + 状态栏
- M4：冲突解决、Diff UI、文档

## 10. 待确认
- mokup CLI 的调用方式与版本约束
- OpenAPI 导入的默认冲突策略
- 是否需要 Worker/SW 模式配置
- 是否需要 CLI 构建输出的解析与预览
