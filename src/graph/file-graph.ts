import path from 'path';
import { ParsedImport, ParsedExport } from '../parsers/base';
import { File, Repository, CreateFileDependency, DependencyType } from '../database/models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('file-graph');

export interface FileNode {
  id: number;
  path: string;
  relativePath: string;
  language?: string;
  isTest: boolean;
  isGenerated: boolean;
}

export interface FileEdge {
  from: number;
  to: number;
  importType: 'named' | 'default' | 'namespace' | 'side_effect';
  importedSymbols: string[];
  isDynamic: boolean;
  lineNumber: number;
}

export interface FileGraphData {
  nodes: FileNode[];
  edges: FileEdge[];
}

export class FileGraphBuilder {
  private logger: any;

  constructor() {
    this.logger = logger;
  }

  /**
   * Build file graph from repository files and their import/export relationships
   */
  async buildFileGraph(
    repository: Repository,
    files: File[],
    importsMap: Map<number, ParsedImport[]>,
    exportsMap: Map<number, ParsedExport[]>
  ): Promise<FileGraphData> {
    this.logger.info('Building file graph', {
      repoName: repository.name,
      fileCount: files.length
    });

    const nodes = this.createFileNodes(files, repository.path);
    const edges = this.createFileEdges(files, importsMap, repository.path);

    this.logger.info('File graph built', {
      nodeCount: nodes.length,
      edgeCount: edges.length
    });

    return { nodes, edges };
  }

  /**
   * Create dependencies for database storage
   */
  createFileDependencies(
    fileGraph: FileGraphData,
    fileIdMap: Map<string, number>
  ): CreateFileDependency[] {
    const dependencies: CreateFileDependency[] = [];

    for (const edge of fileGraph.edges) {
      const fromFile = fileGraph.nodes.find(n => n.id === edge.from);
      const toFile = fileGraph.nodes.find(n => n.id === edge.to);

      if (!fromFile || !toFile) continue;

      dependencies.push({
        from_file_id: edge.from,
        to_file_id: edge.to,
        dependency_type: DependencyType.IMPORTS,
        line_number: edge.lineNumber,
        confidence: edge.isDynamic ? 0.8 : 1.0
      });
    }

    return dependencies;
  }

  /**
   * Resolve module path to actual file path
   */
  resolveModulePath(
    importPath: string,
    currentFilePath: string,
    repositoryPath: string
  ): string | null {
    // Handle relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      const currentDir = path.dirname(currentFilePath);
      const resolved = path.resolve(currentDir, importPath);
      return this.resolveFileExtension(resolved);
    }

    // Handle absolute imports from root
    if (importPath.startsWith('/')) {
      const resolved = path.join(repositoryPath, importPath.slice(1));
      return this.resolveFileExtension(resolved);
    }

    // Handle imports from src/
    if (importPath.startsWith('src/') || importPath.startsWith('@/')) {
      const cleanPath = importPath.replace(/^(@\/|src\/)/, '');
      const resolved = path.join(repositoryPath, 'src', cleanPath);
      return this.resolveFileExtension(resolved);
    }

    // Handle Node.js built-in modules
    if (this.isBuiltinModule(importPath)) {
      return null; // We don't track built-in modules in the file graph
    }

    // Handle npm packages (node_modules)
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null; // We don't track external packages in the file graph
    }

    return null;
  }

  /**
   * Get all files that import a specific file
   */
  getImporters(fileId: number, fileGraph: FileGraphData): FileNode[] {
    const importerIds = fileGraph.edges
      .filter(edge => edge.to === fileId)
      .map(edge => edge.from);

    return fileGraph.nodes.filter(node => importerIds.includes(node.id));
  }

  /**
   * Get all files that a specific file imports
   */
  getImports(fileId: number, fileGraph: FileGraphData): FileNode[] {
    const importIds = fileGraph.edges
      .filter(edge => edge.from === fileId)
      .map(edge => edge.to);

    return fileGraph.nodes.filter(node => importIds.includes(node.id));
  }

  /**
   * Calculate the dependency depth of a file (how many layers of imports)
   */
  calculateDependencyDepth(fileId: number, fileGraph: FileGraphData): number {
    const visited = new Set<number>();
    const stack = [{ id: fileId, depth: 0 }];
    let maxDepth = 0;

    while (stack.length > 0) {
      const { id, depth } = stack.pop()!;

      if (visited.has(id)) continue;
      visited.add(id);

      maxDepth = Math.max(maxDepth, depth);

      const imports = this.getImports(id, fileGraph);
      for (const importFile of imports) {
        if (!visited.has(importFile.id)) {
          stack.push({ id: importFile.id, depth: depth + 1 });
        }
      }
    }

    return maxDepth;
  }

  /**
   * Detect circular dependencies in the file graph
   */
  findCircularDependencies(fileGraph: FileGraphData): number[][] {
    const cycles: number[][] = [];
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const dfs = (nodeId: number, path: number[]): void => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        if (cycleStart !== -1) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }

      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const imports = this.getImports(nodeId, fileGraph);
      for (const importFile of imports) {
        dfs(importFile.id, [...path, nodeId]);
      }

      recursionStack.delete(nodeId);
    };

    for (const node of fileGraph.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id, []);
      }
    }

    return cycles;
  }

  private createFileNodes(files: File[], repositoryPath: string): FileNode[] {
    return files.map(file => ({
      id: file.id,
      path: file.path,
      relativePath: path.relative(repositoryPath, file.path),
      language: file.language,
      isTest: file.is_test,
      isGenerated: file.is_generated
    }));
  }

  private createFileEdges(
    files: File[],
    importsMap: Map<number, ParsedImport[]>,
    repositoryPath: string
  ): FileEdge[] {
    const edges: FileEdge[] = [];
    const filePathToIdMap = new Map(files.map(f => [f.path, f.id]));

    for (const file of files) {
      const imports = importsMap.get(file.id) || [];

      for (const importInfo of imports) {
        const resolvedPath = this.resolveModulePath(
          importInfo.source,
          file.path,
          repositoryPath
        );

        if (!resolvedPath) continue;

        const targetFileId = filePathToIdMap.get(resolvedPath);
        if (!targetFileId) continue;

        edges.push({
          from: file.id,
          to: targetFileId,
          importType: importInfo.import_type,
          importedSymbols: importInfo.imported_names,
          isDynamic: importInfo.is_dynamic,
          lineNumber: importInfo.line_number
        });
      }
    }

    return edges;
  }

  private resolveFileExtension(basePath: string): string | null {
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

    // Try the exact path first
    if (this.fileExists(basePath)) {
      return basePath;
    }

    // Try with extensions
    for (const ext of extensions) {
      const pathWithExt = basePath + ext;
      if (this.fileExists(pathWithExt)) {
        return pathWithExt;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexPath = path.join(basePath, `index${ext}`);
      if (this.fileExists(indexPath)) {
        return indexPath;
      }
    }

    return null;
  }

  private fileExists(filePath: string): boolean {
    try {
      // In a real implementation, we'd check the file system
      // For now, we'll assume the file exists if it has a valid extension
      const ext = path.extname(filePath);
      return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext);
    } catch {
      return false;
    }
  }

  private isBuiltinModule(moduleName: string): boolean {
    const builtinModules = [
      'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util',
      'events', 'stream', 'buffer', 'process', 'child_process',
      'cluster', 'net', 'dns', 'tls', 'zlib', 'readline', 'repl'
    ];

    return builtinModules.includes(moduleName) || moduleName.startsWith('node:');
  }
}