import { EventEmitter, TreeItem, TreeItemCollapsibleState, type TreeDataProvider } from 'vscode'
import { collectWorkspaceEntries } from '../scan/collect'
import { scanMockRoutes, type MockRoute } from '../mock/routes'

type PackageNode = {
  type: 'package'
  name: string
  root: string
}

type EntryNode = {
  type: 'entry'
  label: string
  entry: Awaited<ReturnType<typeof collectWorkspaceEntries>>[number]
}

type RouteNode = {
  type: 'route'
  route: MockRoute
}

type TreeNode = PackageNode | EntryNode | RouteNode

export class MokupRoutesProvider implements TreeDataProvider<TreeNode> {
  private readonly emitter = new EventEmitter<TreeNode | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  refresh() {
    this.emitter.fire(undefined)
  }

  getTreeItem(element: TreeNode): TreeItem {
    if (element.type === 'package') {
      return new TreeItem(element.name, TreeItemCollapsibleState.Collapsed)
    }
    if (element.type === 'entry') {
      const item = new TreeItem(element.label, TreeItemCollapsibleState.Collapsed)
      item.description = element.entry.source
      return item
    }
    const item = new TreeItem(`${element.route.method.toUpperCase()} ${element.route.path}`, TreeItemCollapsibleState.None)
    item.description = element.route.sourceFile
    item.command = {
      command: 'mokup.previewMock',
      title: 'Preview Mock',
      arguments: [element.route],
    }
    return item
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    const entries = await collectWorkspaceEntries()
    if (!element) {
      const seen = new Map<string, PackageNode>()
      for (const entry of entries) {
        if (!seen.has(entry.packageRoot)) {
          seen.set(entry.packageRoot, {
            type: 'package',
            name: entry.packageName,
            root: entry.packageRoot,
          })
        }
      }
      return Array.from(seen.values())
    }

    if (element.type === 'package') {
      return entries
        .filter(entry => entry.packageRoot === element.root)
        .map(entry => ({
          type: 'entry',
          label: entry.prefix ? `${entry.dir} (${entry.prefix})` : entry.dir,
          entry,
        }))
    }

    if (element.type === 'entry') {
      const scan = await scanMockRoutes([element.entry])
      return scan.routes.map(route => ({ type: 'route', route }))
    }

    return []
  }
}
