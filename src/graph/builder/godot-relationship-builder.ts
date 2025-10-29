import type { Knex } from 'knex';
import { DependencyType } from '../../database/models';
import * as FileService from '../../database/services/file-service';
import * as SymbolService from '../../database/services/symbol-service';
import * as DependencyService from '../../database/services/dependency-service';
import * as GodotService from '../../database/services/godot-service';
import { ParseResult, ParsedDependency } from '../../parsers/base';
import { isGodotScene, isGodotNode } from './framework-type-guards';
import { createComponentLogger } from '../../utils/logger';

/**
 * Godot Relationship Builder
 * Handles Godot-specific framework relationships (node-script, GetNode dependencies)
 */
export class GodotRelationshipBuilder {
  private logger: any;

  constructor(
    private db: Knex,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('godot-relationship-builder');
  }

  async buildGodotRelationships(
    repositoryId: number,
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<void> {
    try {
      const godotEntities: any[] = [];

      for (const parseResult of parseResults) {
        if (parseResult.frameworkEntities) {
          const godotFrameworkEntities = parseResult.frameworkEntities.filter(
            entity =>
              (entity as any).framework === 'godot' ||
              isGodotScene(entity) ||
              isGodotNode(entity)
          );
          godotEntities.push(...godotFrameworkEntities);
        }
      }

      if (godotEntities.length === 0) {
        return;
      }

      this.logger.info('Building Godot framework relationships', {
        repositoryId,
        totalGodotEntities: godotEntities.length,
        entityTypes: [...new Set(godotEntities.map(e => e.type))],
      });

      const storedScenes = await GodotService.getGodotScenesByRepository(this.db, repositoryId);

      const storedNodes: any[] = [];
      for (const scene of storedScenes) {
        const sceneNodes = await GodotService.getGodotNodesByScene(this.db, scene.id);
        storedNodes.push(...sceneNodes);
      }

      this.logger.info('Creating node-script dependencies', {
        totalNodes: storedNodes.length,
        nodesWithScripts: storedNodes.filter((n: any) => n.script_path).length,
      });

      for (const node of storedNodes) {
        if (!node.script_path) continue;

        try {
          const scene = storedScenes.find((s: any) => s.id === node.scene_id);
          if (!scene) continue;

          const sceneFile = await FileService.getFileByPath(this.db, scene.scene_path);
          if (!sceneFile) {
            this.logger.warn('Scene file not found', { scenePath: scene.scene_path });
            continue;
          }

          const sceneSymbols = await SymbolService.getSymbolsByFile(this.db, sceneFile.id);
          const nodeSymbol = sceneSymbols.find(s => s.name === node.node_name);

          if (!nodeSymbol) {
            this.logger.warn('Node symbol not found', {
              nodeName: node.node_name,
              scenePath: scene.scene_path,
              totalSymbols: sceneSymbols.length,
            });
            continue;
          }

          const scriptFile = await FileService.getFileByPath(this.db, node.script_path);
          if (!scriptFile) {
            this.logger.warn('Script file not found', { scriptPath: node.script_path });
            continue;
          }

          const scriptSymbols = await SymbolService.getSymbolsByFile(this.db, scriptFile.id);
          const scriptClassSymbol = scriptSymbols.find(s => s.symbol_type === 'class');

          if (!scriptClassSymbol) {
            this.logger.warn('Script class symbol not found', {
              scriptPath: node.script_path,
              totalSymbols: scriptSymbols.length,
            });
            continue;
          }

          await DependencyService.createDependency(this.db, {
            from_symbol_id: nodeSymbol.id,
            to_symbol_id: scriptClassSymbol.id,
            dependency_type: DependencyType.REFERENCES,
            line_number: (node.metadata as any)?.line || 1,
          });

          this.logger.info('Created node-script dependency', {
            nodeSymbol: nodeSymbol.name,
            scriptClass: scriptClassSymbol.name,
            fromId: nodeSymbol.id,
            toId: scriptClassSymbol.id,
          });
        } catch (error) {
          this.logger.error('Failed to create node-script dependency', {
            nodeName: node.node_name,
            scriptPath: node.script_path,
            error: (error as Error).message,
          });
        }
      }

      this.logger.info('Creating GetNode node reference dependencies');

      const getnodeDeps: Array<{
        filePath: string;
        dependency: ParsedDependency;
      }> = [];

      for (const parseResult of parseResults) {
        if (parseResult.dependencies) {
          for (const dep of parseResult.dependencies) {
            if (dep.to_symbol && dep.to_symbol.startsWith('node:')) {
              getnodeDeps.push({
                filePath: parseResult.filePath,
                dependency: dep,
              });
            }
          }
        }
      }

      this.logger.info('Found GetNode dependencies in parseResults', { count: getnodeDeps.length });

      const pathToFileId = new Map<string, number>();
      const allFiles = await FileService.getFilesByRepository(this.db, repositoryId);
      for (const file of allFiles) {
        pathToFileId.set(file.path, file.id);
      }

      const allSymbols = await SymbolService.getSymbolsByRepository(this.db, repositoryId);
      const fileIdToSymbols = new Map<number, any[]>();
      for (const symbol of allSymbols) {
        const symbols = fileIdToSymbols.get(symbol.file_id) || [];
        symbols.push(symbol);
        fileIdToSymbols.set(symbol.file_id, symbols);
      }

      for (const { filePath, dependency } of getnodeDeps) {
        try {
          const fullNodePath = dependency.to_symbol.substring(5);

          const pathParts = fullNodePath
            .split('/')
            .filter((p: string) => p && p !== '..' && p !== '.');
          const targetNodeName = pathParts[pathParts.length - 1];

          if (!targetNodeName) {
            this.logger.warn('Could not extract node name from path', { fullNodePath });
            continue;
          }

          const sourceFileId = pathToFileId.get(filePath);
          if (!sourceFileId) {
            this.logger.warn('Source file not found', { filePath });
            continue;
          }

          const sourceSymbols = fileIdToSymbols.get(sourceFileId) || [];
          const fromSymbol = sourceSymbols.find(
            s =>
              s.qualified_name === dependency.from_symbol || s.name === dependency.from_symbol
          );
          if (!fromSymbol) {
            this.logger.warn('Source symbol not found', {
              fromSymbol: dependency.from_symbol,
              filePath,
              availableSymbols: sourceSymbols.map(s => s.name).join(', '),
            });
            continue;
          }

          const nodes = await this.db('godot_nodes as gn')
            .join('godot_scenes as gs', 'gn.scene_id', 'gs.id')
            .where('gs.repo_id', repositoryId)
            .where('gn.node_name', targetNodeName)
            .select('gn.*', 'gs.scene_path');

          if (nodes.length === 0) {
            this.logger.warn('Node not found in scenes', {
              fullNodePath,
              targetNodeName,
              fromSymbol: fromSymbol.name,
            });
            continue;
          }

          if (nodes.length > 1) {
            this.logger.debug('Multiple nodes with same name found', {
              targetNodeName,
              count: nodes.length,
              scriptPaths: nodes.map((n: any) => n.script_path).filter(Boolean),
            });
          }

          const node = nodes[0];
          if (!node.script_path) {
            this.logger.warn('Node has no script', {
              targetNodeName,
              nodeType: node.node_type,
              scenePath: node.scene_path,
            });
            continue;
          }

          const scriptFileId = pathToFileId.get(node.script_path);
          if (!scriptFileId) {
            this.logger.warn('Script file not found', { scriptPath: node.script_path });
            continue;
          }

          const scriptSymbols = fileIdToSymbols.get(scriptFileId) || [];
          const scriptClassSymbol = scriptSymbols.find(s => s.symbol_type === 'class');

          if (!scriptClassSymbol) {
            this.logger.warn('Script class not found', { scriptPath: node.script_path });
            continue;
          }

          await DependencyService.createDependency(this.db, {
            from_symbol_id: fromSymbol.id,
            to_symbol_id: scriptClassSymbol.id,
            dependency_type: dependency.dependency_type,
            line_number: dependency.line_number,
            parameter_context: dependency.parameter_context,
          });

          this.logger.info('Created GetNode dependency', {
            fromSymbol: fromSymbol.name,
            fullNodePath,
            targetNodeName,
            toScript: scriptClassSymbol.name,
            fromId: fromSymbol.id,
            toId: scriptClassSymbol.id,
          });
        } catch (error) {
          this.logger.error('Failed to create GetNode dependency', {
            nodePath: dependency.to_symbol,
            error: (error as Error).message,
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to build Godot relationships', {
        repositoryId,
        error: (error as Error).message,
      });
    }
  }
}
