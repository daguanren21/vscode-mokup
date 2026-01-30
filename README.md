# Mokup

VS Code extension for mokup: config detection, OpenAPI/d.ts import/export, mock preview.

## Features

- Detect mokup entries from Vite config and workspace structure (single repo + monorepo).
- Import OpenAPI (local yaml/json) and write mock files into entries dirs (TS handler or JSON).
- Import d.ts (with Zod support) to generate schemas and mock routes.
- Export OpenAPI from mock routes and schemas.
- Preview mock response in a Webview panel.
- Browse mock routes in the side bar.
- Start/stop mock server with configurable command.
- Status bar indicator for running mock instances.

## Commands

- Mokup: Import OpenAPI
- Mokup: Export OpenAPI
- Mokup: Import DTS
- Mokup: Rescan Workspace
- Mokup: Start Mock
- Mokup: Start All
- Mokup: Stop Mock
- Mokup: Stop All
- Mokup: Show Running Instances
- Mokup: Preview Import Template
- Mokup: Preview Mock Response

Testing View:
- Use the Testing panel to run "Build (CLI)" and "Preview Response" profiles.

## Configuration

- `mokup.openapi.import.writeFiles` (boolean, default: true)
- `mokup.openapi.import.conflict` (prompt | overwrite | skip | backup, default: prompt)
- `mokup.openapi.import.format` (ts | json, default: ts)
- `mokup.openapi.import.tsTemplate` (inline template string)
- `mokup.openapi.import.tsTemplatePath` (template file path)
- `mokup.openapi.import.jsonTemplate` (inline template string)
- `mokup.openapi.import.jsonTemplatePath` (template file path)

模板占位符：
`{{method}}` `{{methodLower}}` `{{path}}` `{{pathRaw}}` `{{params}}` `{{paramsList}}` `{{query}}` `{{body}}` `{{bodyReturn}}` `{{json}}` `{{schemaName}}` `{{schemaJson}}`
其中 `{{path}}` 会移除路径参数段（`/users/{id}` → `/users`），`{{pathRaw}}` 保留原始路径。
- `mokup.openapi.scanGlobs` (string[], default: `**/*.{yaml,yml,json}`)
- `mokup.dts.scanGlobs` (string[], default: `**/*.d.ts`)
- `mokup.workspace.monorepoMode` (auto | on | off)
- `mokup.entries.preferViteConfig` (boolean, default: true)
- `mokup.runner.command` (string, default: `mokup`)
- `mokup.runner.mode` (server | sw, default: server, injects `--mode sw` when set to sw)
- `mokup.runner.args` (string[], supports `{packageRoot} {entryDir} {prefix}`)
- `mokup.build.command` (string, default: `mokup`)
- `mokup.build.args` (string[], default: `build`, supports `{packageRoot} {entryDir} {prefix}`)

## License

[MIT](./LICENSE.md)
