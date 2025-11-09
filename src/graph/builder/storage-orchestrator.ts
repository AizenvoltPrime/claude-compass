import fs from 'fs/promises';
import path from 'path';
import type { Knex } from 'knex';
import { File, Symbol, CreateFile, CreateSymbol } from '../../database/models';
import * as FileService from '../../database/services/file-service';
import * as SymbolService from '../../database/services/symbol-service';
import * as RouteService from '../../database/services/route-service';
import { ParseResult } from '../../parsers/base';
import { createComponentLogger } from '../../utils/logger';
import { computeFileHash } from '../../utils/file-hash';

/**
 * Storage Orchestrator
 * Handles database persistence of files, symbols, and their relationships
 */
export class StorageOrchestrator {
  private logger: any;

  constructor(
    private db: Knex,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('storage-orchestrator');
  }

  async storeFiles(
    repositoryId: number,
    files: Array<{ path: string }>,
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<File[]> {
    const fileDataPromises = files.map(async (file, i) => {
      if (!parseResults[i]) return null;

      try {
        const [stats, contentHash] = await Promise.all([
          fs.stat(file.path),
          computeFileHash(file.path),
        ]);
        return { stats, contentHash };
      } catch (error) {
        this.logger.error('Failed to process file', {
          path: file.path,
          error: (error as Error).message,
        });
        return null;
      }
    });

    const allFileData = await Promise.all(fileDataPromises);

    const createFiles: CreateFile[] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileData = allFileData[i];
      const parseResult = parseResults[i];

      if (!parseResult || !fileData) {
        continue;
      }

      const language = this.detectLanguageFromPath(file.path);

      createFiles.push({
        repo_id: repositoryId,
        path: file.path,
        language,
        size: fileData.stats.size,
        last_modified: fileData.stats.mtime,
        content_hash: fileData.contentHash,
        is_generated: this.isGeneratedFile(file.path),
        is_test: this.isTestFile(file.path),
      });

      validIndices.push(i);
    }

    const dbFiles = await FileService.createFilesBatch(this.db, createFiles);
    return dbFiles;
  }

  async storeSymbols(
    files: File[],
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<Symbol[]> {
    const allSymbols: CreateSymbol[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const parseResult = parseResults.find(r => r.filePath === file.path);

      if (!parseResult) continue;

      for (const symbol of parseResult.symbols) {
        allSymbols.push({
          file_id: file.id,
          name: symbol.name,
          qualified_name: symbol.qualified_name,
          parent_symbol_id: symbol.parent_symbol_id,
          symbol_type: symbol.symbol_type,
          entity_type: symbol.entity_type,
          framework: symbol.framework,
          base_class: symbol.base_class,
          namespace: symbol.namespace,
          start_line: symbol.start_line,
          end_line: symbol.end_line,
          is_exported: symbol.is_exported,
          visibility: symbol.visibility as any,
          signature: symbol.signature,
          description: symbol.description,
        });
      }
    }

    return await SymbolService.createSymbols(this.db, allSymbols);
  }

  async linkSymbolHierarchy(repositoryId: number): Promise<void> {
    this.logger.info('Linking symbol parent-child relationships', { repositoryId });

    const symbols = await SymbolService.getSymbolsByRepository(this.db, repositoryId);
    const files = await FileService.getFilesByRepository(this.db, repositoryId);

    const symbolsByFile = new Map<number, Symbol[]>();
    for (const symbol of symbols) {
      if (!symbolsByFile.has(symbol.file_id)) {
        symbolsByFile.set(symbol.file_id, []);
      }
      symbolsByFile.get(symbol.file_id)!.push(symbol);
    }

    let linked = 0;
    const updates: Array<{ id: number; parent_symbol_id: number }> = [];

    for (const [fileId, fileSymbols] of symbolsByFile) {
      const parentTypes = ['class', 'interface', 'trait'];
      const childTypes = ['method', 'property'];

      const potentialParents = fileSymbols.filter(s => parentTypes.includes(s.symbol_type));
      const potentialChildren = fileSymbols.filter(s => childTypes.includes(s.symbol_type));

      for (const child of potentialChildren) {
        for (const parent of potentialParents) {
          if (
            child.start_line >= parent.start_line &&
            child.end_line <= parent.end_line &&
            child.id !== parent.id
          ) {
            updates.push({ id: child.id, parent_symbol_id: parent.id });
            linked++;
            break;
          }
        }
      }
    }

    for (const update of updates) {
      await RouteService.updateSymbolParent(this.db, update.id, update.parent_symbol_id);
    }

    this.logger.info('Symbol hierarchy linkage complete', {
      total: symbols.length,
      linked,
    });
  }

  async linkRouteHandlers(repositoryId: number): Promise<void> {
    this.logger.info('Linking route handlers to symbols', { repositoryId });

    const routes = await RouteService.getRoutesByRepository(this.db, repositoryId);
    const unlinkedRoutes = routes.filter(
      route =>
        route.framework_type === 'laravel' &&
        !route.handler_symbol_id &&
        route.controller_class &&
        route.controller_method
    );

    if (unlinkedRoutes.length === 0) {
      this.logger.info('No Laravel routes need handler linkage');
      return;
    }

    let linked = 0;
    let failed = 0;

    for (const route of unlinkedRoutes) {
      if (this.isClosureRouteLinkedDuringPersistence(route)) {
        continue;
      }

      this.logger.debug('Looking for handler method', {
        repositoryId,
        controllerClass: route.controller_class,
        controllerMethod: route.controller_method,
        routePath: route.path,
      });

      const handlerSymbol = await RouteService.findMethodInController(
        this.db,
        repositoryId,
        route.controller_class!,
        route.controller_method!
      );

      if (handlerSymbol) {
        this.logger.debug('Found handler symbol', {
          symbolId: handlerSymbol.id,
          symbolName: handlerSymbol.name,
          qualifiedName: handlerSymbol.qualified_name,
        });

        const symbolExists = await SymbolService.getSymbol(this.db, handlerSymbol.id);
        if (!symbolExists) {
          this.logger.error('Handler symbol does not exist in database!', {
            symbolId: handlerSymbol.id,
            symbolName: handlerSymbol.name,
            routeId: route.id,
            routePath: route.path,
          });
          failed++;
          continue;
        }

        this.logger.debug('Linking route to symbol', {
          routeId: route.id,
          routePath: route.path,
          symbolId: handlerSymbol.id,
        });

        await RouteService.updateRouteHandlerSymbolId(this.db, route.id, handlerSymbol.id);
        linked++;
      } else {
        this.logger.warn('Handler symbol not found for route', {
          routePath: route.path,
          routeMethod: route.method,
          controllerClass: route.controller_class,
          controllerMethod: route.controller_method,
        });
        failed++;
      }
    }

    this.logger.info('Route handler linkage complete', {
      total: unlinkedRoutes.length,
      linked,
      failed,
    });
  }

  private isTestFile(relativePath: string): boolean {
    const fileName = path.basename(relativePath).toLowerCase();

    if (
      fileName.includes('.test.') ||
      fileName.includes('.spec.') ||
      fileName.endsWith('.test') ||
      fileName.endsWith('.spec')
    ) {
      return true;
    }

    const normalizedPath = relativePath.replace(/\\/g, '/');
    const pathSegments = normalizedPath.split('/');

    return pathSegments.some(
      segment =>
        segment === '__tests__' ||
        segment === 'test' ||
        segment === 'tests' ||
        segment === 'spec' ||
        segment === 'specs'
    );
  }

  private isGeneratedFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      fileName.includes('.generated.') ||
      fileName.includes('.gen.') ||
      filePath.includes('/generated/') ||
      filePath.includes('/.next/') ||
      filePath.includes('/dist/') ||
      filePath.includes('/build/')
    );
  }

  private isClosureRouteLinkedDuringPersistence(route: {
    controller_class?: string | null;
    action?: string | null;
  }): boolean {
    return route.controller_class === 'Closure' || route.action === 'Closure';
  }

  private detectLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath);

    switch (ext) {
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.vue':
        return 'vue';
      case '.php':
        return 'php';
      case '.cs':
        return 'csharp';
      case '.tscn':
        return 'godot_scene';
      case '.godot':
        return 'godot';
      default:
        return 'unknown';
    }
  }
}
