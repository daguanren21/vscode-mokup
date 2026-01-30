export type WorkspacePackage = {
  name: string
  root: string
  configFiles: string[]
}

export type WorkspaceScanResult = {
  root: string
  packages: WorkspacePackage[]
  warnings: string[]
}
