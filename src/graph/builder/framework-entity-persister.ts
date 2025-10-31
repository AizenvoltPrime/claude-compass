import path from 'path';
import type { Knex } from 'knex';
import {
  Repository,
  File,
  Symbol,
  SymbolType,
  CreateSymbol,
  DependencyType,
} from '../../database/models';
import * as FileService from '../../database/services/file-service';
import * as SymbolService from '../../database/services/symbol-service';
import * as DependencyService from '../../database/services/dependency-service';
import * as RouteService from '../../database/services/route-service';
import * as ComponentService from '../../database/services/component-service';
import * as ComposableService from '../../database/services/composable-service';
import * as JobService from '../../database/services/job-service';
import * as ORMService from '../../database/services/orm-service';
import * as GodotService from '../../database/services/godot-service';
import * as FrameworkMetadataService from '../../database/services/framework-metadata-service';
import { ParseResult } from '../../parsers/base';
import {
  LaravelRoute,
  LaravelController,
  EloquentModel,
} from '../../parsers/laravel';
import {
  VueComponent,
  ReactComponent,
  VueComposable,
  ReactHook,
  NextJSRoute,
  ExpressRoute,
  FastifyRoute,
  VueRoute,
} from '../../parsers/base';
import { isClosureSymbolName } from '../../parsers/php/types';
import {
  isLaravelRoute,
  isLaravelController,
  isEloquentModel,
  isRouteEntity,
  isVueComponent,
  isReactComponent,
  isVueComposable,
  isReactHook,
  isJobSystemEntity,
  isORMSystemEntity,
  isGodotScene,
  isGodotNode,
} from './framework-type-guards';
import { SymbolGraphData } from '../symbol-graph/';
import { BuildError } from './types';
import { createComponentLogger } from '../../utils/logger';

/**
 * Framework Entity Persister
 * Handles persistence of framework-specific entities (components, routes, models, etc.)
 */
export class FrameworkEntityPersister {
  private logger: any;
  private buildErrors: BuildError[] = [];

  constructor(
    private db: Knex,
    logger?: any
  ) {
    this.logger = logger || createComponentLogger('framework-entity-persister');
  }

  getBuildErrors(): BuildError[] {
    return this.buildErrors;
  }

  clearBuildErrors(): void {
    this.buildErrors = [];
  }

  async storeFrameworkEntities(
    repositoryId: number,
    symbols: Symbol[],
    parseResults: Array<ParseResult & { filePath: string }>
  ): Promise<void> {
    this.logger.info('Storing framework entities', {
      repositoryId,
      parseResultsCount: parseResults.length,
    });

    const allFiles = await FileService.getFilesByRepository(this.db, repositoryId);
    const filesMap = new Map(allFiles.map(f => [f.path, f]));
    const normalizedFilesMap = new Map(allFiles.map(f => [path.normalize(f.path), f]));

    for (const parseResult of parseResults) {
      if (!parseResult.frameworkEntities || parseResult.frameworkEntities.length === 0) {
        continue;
      }

      const fileSymbols = symbols.filter(s => {
        return parseResult.symbols.some(
          ps => ps.name === s.name && ps.symbol_type === s.symbol_type
        );
      });

      for (const entity of parseResult.frameworkEntities) {
        let matchingSymbol: Symbol | undefined;

        try {
          if (isLaravelRoute(entity)) {
            const laravelRoute = entity as LaravelRoute;
            let normalizedMethod = laravelRoute.method;
            if (normalizedMethod === 'RESOURCE') {
              normalizedMethod = 'ANY';
            }

            const matchingFile = this.findFileForEntity(
              parseResult.filePath,
              filesMap,
              normalizedFilesMap,
              allFiles
            );

            if (!matchingFile) {
              this.logger.error('Cannot persist Laravel route: file not found in database', {
                routePath: laravelRoute.path,
                routeMethod: laravelRoute.method,
                filePath: parseResult.filePath,
                normalizedFilePath: path.normalize(parseResult.filePath),
                entityName: entity.name,
              });
              continue;
            }

            const closureSymbolId = this.findClosureSymbolForRoute(
              laravelRoute,
              fileSymbols
            );

            await RouteService.createRoute(this.db, {
              repo_id: repositoryId,
              path: laravelRoute.path,
              method: normalizedMethod,
              handler_symbol_id: closureSymbolId,
              framework_type: 'laravel',
              middleware: laravelRoute.middleware || [],
              dynamic_segments: [],
              auth_required: false,
              name: laravelRoute.routeName,
              controller_class: laravelRoute.controller,
              controller_method: laravelRoute.action,
              action: laravelRoute.action,
              file_path: laravelRoute.filePath,
              line_number:
                laravelRoute.metadata?.closureLineNumber || laravelRoute.metadata?.line || 1,
            });
            continue;
          }

          const symbolTypeMap: Record<string, SymbolType> = {
            component: SymbolType.COMPONENT,
            composable: SymbolType.FUNCTION,
            hook: SymbolType.FUNCTION,
            route: SymbolType.FUNCTION,
            store: SymbolType.CLASS,
          };

          const expectedSymbolType = symbolTypeMap[entity.type];

          matchingSymbol = fileSymbols.find(
            s =>
              s.name === entity.name &&
              (expectedSymbolType ? s.symbol_type === expectedSymbolType : true)
          );

          if (
            !matchingSymbol &&
            entity.type !== 'api_call' &&
            !isGodotScene(entity) &&
            !isGodotNode(entity)
          ) {
            const matchingFile = this.findFileForEntity(
              parseResult.filePath,
              filesMap,
              normalizedFilesMap,
              allFiles
            );

            if (!matchingFile) {
              this.logger.warn('Could not find file record for framework entity', {
                filePath: parseResult.filePath,
                normalizedFilePath: path.normalize(parseResult.filePath),
                entityName: entity.name,
                entityType: entity.type,
                availableFilesCount: allFiles.length,
                sampleAvailableFiles: allFiles
                  .map(f => ({
                    path: f.path,
                    normalized: path.normalize(f.path),
                  }))
                  .slice(0, 5),
                parseResultDirectory: path.dirname(parseResult.filePath),
                parseResultBasename: path.basename(parseResult.filePath),
              });
              continue;
            }

            const symbolTypeMap: Record<string, SymbolType> = {
              component: SymbolType.COMPONENT,
              composable: SymbolType.FUNCTION,
              hook: SymbolType.FUNCTION,
              route: SymbolType.FUNCTION,
              store: SymbolType.CLASS,
            };

            const symbolType = symbolTypeMap[entity.type] || SymbolType.FUNCTION;

            const entityMetadata = entity.metadata as
              | { line?: number; endLine?: number }
              | undefined;
            const entityStartLine = entityMetadata?.line || 1;
            const entityEndLine = entityMetadata?.endLine || entityStartLine + 5;

            const syntheticSymbol = await SymbolService.createSymbol(this.db, {
              file_id: matchingFile.id,
              name: entity.name,
              symbol_type: symbolType,
              start_line: entityStartLine,
              end_line: entityEndLine,
              is_exported: true,
              signature: `${entity.type} ${entity.name}`,
              description: entity.description,
            });

            matchingSymbol = syntheticSymbol;
          }

          if (isLaravelController(entity)) {
            await FrameworkMetadataService.storeFrameworkMetadata(this.db, {
              repo_id: repositoryId,
              framework_type: 'laravel',
              metadata: {
                entityType: 'controller',
                name: entity.name,
                actions: (entity as LaravelController).actions,
                middleware: (entity as LaravelController).middleware,
                resourceController: (entity as LaravelController).resourceController,
              },
            });
          } else if (isEloquentModel(entity)) {
            await FrameworkMetadataService.storeFrameworkMetadata(this.db, {
              repo_id: repositoryId,
              framework_type: 'laravel',
              metadata: {
                entityType: 'model',
                name: entity.name,
                tableName: (entity as EloquentModel).tableName,
                fillable: (entity as EloquentModel).fillable,
                relationships: (entity as EloquentModel).relationships,
              },
            });
          } else if (isRouteEntity(entity)) {
            const routeEntity = entity as NextJSRoute | ExpressRoute | FastifyRoute | VueRoute;
            await RouteService.createRoute(this.db, {
              repo_id: repositoryId,
              path: routeEntity.path || '/',
              method: (routeEntity as any).method || 'GET',
              handler_symbol_id: matchingSymbol?.id || null,
              framework_type: (routeEntity as any).framework || 'unknown',
              middleware: (routeEntity as any).middleware || [],
              dynamic_segments: (routeEntity as any).dynamicSegments || [],
              auth_required: false,
            });
          } else if (isVueComponent(entity)) {
            const vueEntity = entity as VueComponent;

            if (!matchingSymbol) {
              const errorMessage = `Vue component symbol not found: ${vueEntity.name}`;
              this.buildErrors.push({
                filePath: parseResult.filePath,
                message: errorMessage,
              });
              this.logger.error(errorMessage, {
                component: vueEntity.name,
                file: parseResult.filePath,
                availableSymbols: fileSymbols.map(s => `${s.name} (${s.symbol_type})`),
              });
              continue;
            }

            await ComponentService.createComponent(this.db, {
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              component_type: 'vue' as any,
              props: vueEntity.props || [],
              emits: vueEntity.emits || [],
              slots: vueEntity.slots || [],
              hooks: vueEntity.composables || [],
              template_dependencies: vueEntity.template_dependencies || [],
            });
          } else if (isReactComponent(entity)) {
            const reactEntity = entity as ReactComponent;
            await ComponentService.createComponent(this.db, {
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              component_type: 'react' as any,
              props: reactEntity.props || [],
              emits: [],
              slots: [],
              hooks: reactEntity.hooks || [],
              template_dependencies: reactEntity.jsxDependencies || [],
            });
          } else if (isVueComposable(entity)) {
            const composableEntity = entity as VueComposable;
            await ComposableService.createComposable(this.db, {
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              composable_type: 'vue' as any,
              returns: composableEntity.returns || [],
              dependencies: composableEntity.dependencies || [],
              reactive_refs: composableEntity.reactive_refs || [],
              dependency_array: [],
            });
          } else if (isReactHook(entity)) {
            const hookEntity = entity as ReactHook;
            await ComposableService.createComposable(this.db, {
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              composable_type: 'react' as any,
              returns: hookEntity.returns || [],
              dependencies: hookEntity.dependencies || [],
              reactive_refs: [],
              dependency_array: [],
            });
          } else if (isJobSystemEntity(entity)) {
            const jobSystemEntity = entity as any;
            await JobService.createJobQueue(this.db, {
              repo_id: repositoryId,
              name: jobSystemEntity.name,
              queue_type: jobSystemEntity.jobSystems?.[0] || 'bull',
              symbol_id: matchingSymbol.id,
              config_data: jobSystemEntity.config || {},
            });
          } else if (isORMSystemEntity(entity)) {
            const ormSystemEntity = entity as any;
            await ORMService.createORMEntity(this.db, {
              repo_id: repositoryId,
              symbol_id: matchingSymbol.id,
              entity_name: ormSystemEntity.name,
              orm_type: ormSystemEntity.metadata?.orm || ormSystemEntity.name || 'unknown',
              fields: ormSystemEntity.metadata?.fields || {},
            });
          } else if (isGodotScene(entity)) {
            const sceneEntity = entity as any;

            const storedScene = await GodotService.storeGodotScene(this.db, {
              repo_id: repositoryId,
              scene_path: sceneEntity.scenePath || parseResult.filePath,
              scene_name: sceneEntity.name,
              node_count: sceneEntity.nodes?.length || 0,
              has_script: sceneEntity.nodes?.some((node: any) => node.script) || false,
              metadata: {
                rootNodeType: sceneEntity.rootNode?.nodeType,
                connections: sceneEntity.connections?.length || 0,
                resources: sceneEntity.resources?.length || 0,
              },
            });

            if (sceneEntity.nodes && Array.isArray(sceneEntity.nodes)) {
              const nodePathToId = new Map<string, number>();
              const storedNodeIds = new Map<any, number>();

              for (const node of sceneEntity.nodes) {
                const storedNode = await GodotService.storeGodotNode(this.db, {
                  repo_id: repositoryId,
                  scene_id: storedScene.id,
                  node_name: node.nodeName || node.name,
                  node_type: node.nodeType || node.type || 'Node',
                  script_path: node.script,
                  properties: node.properties || {},
                });

                storedNodeIds.set(node, storedNode.id);

                const nodeName = node.nodeName || node.name;
                const nodePath = node.parentPath ? `${node.parentPath}/${nodeName}` : nodeName;
                nodePathToId.set(nodePath, storedNode.id);

                this.logger.debug('Stored Godot node with path', {
                  nodeName,
                  nodePath,
                  nodeId: storedNode.id,
                  scenePath: sceneEntity.scenePath,
                });
              }

              const parentUpdates: Array<{ nodeId: number; parentId: number }> = [];

              for (const node of sceneEntity.nodes) {
                if (node.parentPath) {
                  const nodeId = storedNodeIds.get(node);
                  if (!nodeId) {
                    throw new Error(
                      `Node storage failed but no error thrown for ${node.nodeName || node.name || 'unknown'} in ${sceneEntity.scenePath || parseResult.filePath || 'unknown scene'}`
                    );
                  }

                  const parentId = nodePathToId.get(node.parentPath);
                  if (!parentId) {
                    this.logger.warn('Parent node not found by path', {
                      nodeName: node.nodeName || node.name,
                      parentPath: node.parentPath,
                      scenePath: sceneEntity.scenePath,
                      availablePaths: Array.from(nodePathToId.keys()),
                    });
                    continue;
                  }

                  parentUpdates.push({ nodeId, parentId });

                  this.logger.debug('Queued parent link for batch update', {
                    nodeName: node.nodeName || node.name,
                    parentPath: node.parentPath,
                    nodeId,
                    parentId,
                  });
                }
              }

              if (parentUpdates.length > 0) {
                const caseStatement = parentUpdates
                  .map(({ nodeId, parentId }) => `WHEN ${nodeId} THEN ${parentId}`)
                  .join(' ');
                const nodeIds = parentUpdates.map(({ nodeId }) => nodeId).join(',');

                await this.db.raw(`
                  UPDATE godot_nodes
                  SET parent_node_id = CASE id ${caseStatement} END
                  WHERE id IN (${nodeIds})
                `);

                this.logger.debug('Batch updated parent relationships', {
                  scenePath: sceneEntity.scenePath,
                  updatedCount: parentUpdates.length,
                });
              }

              const nodesWithInstances = sceneEntity.nodes.filter((n: any) => n.instanceScene);
              if (nodesWithInstances.length > 0) {
                const currentFile = await FileService.getFileByPath(
                  this.db,
                  sceneEntity.scenePath || parseResult.filePath
                );
                if (!currentFile) {
                  throw new Error(
                    `Current scene file not found in database: ${sceneEntity.scenePath || parseResult.filePath}`
                  );
                }

                const instancePaths = nodesWithInstances.map((n: any) => n.instanceScene!);

                const BATCH_SIZE = 500;
                const instanceFiles: any[] = [];

                for (let i = 0; i < instancePaths.length; i += BATCH_SIZE) {
                  const chunk = instancePaths.slice(i, i + BATCH_SIZE);
                  const chunkFiles = await FileService.getFilesByPaths(this.db, chunk);
                  instanceFiles.push(...chunkFiles);
                }

                const pathToFileMap = new Map(instanceFiles.map(f => [f.path, f]));

                const dependencies = [];
                for (const node of nodesWithInstances) {
                  const nodeId = storedNodeIds.get(node);
                  if (!nodeId) {
                    throw new Error(
                      `Node storage failed for ${node.nodeName || node.name || 'unknown'} but no error was thrown`
                    );
                  }

                  const instanceFile = pathToFileMap.get(node.instanceScene!);
                  if (!instanceFile) {
                    this.logger.warn('Scene instance file not found in database', {
                      instancePath: node.instanceScene,
                      nodeName: node.nodeName || node.name,
                      scenePath: sceneEntity.scenePath,
                    });
                    continue;
                  }

                  dependencies.push({
                    from_file_id: currentFile.id,
                    to_file_id: instanceFile.id,
                    dependency_type: DependencyType.REFERENCES,
                  });

                  this.logger.debug('Created scene instance dependency', {
                    fromScene: sceneEntity.scenePath,
                    toScene: node.instanceScene,
                    nodeName: node.nodeName || node.name,
                  });
                }

                if (dependencies.length > 0) {
                  await DependencyService.createFileDependencies(this.db, dependencies);
                }
              }
            }
          } else if (entity.type === 'api_call') {
            // API calls processed by cross-stack builder
          }
        } catch (error) {
          this.logger.error(
            `Failed to store ${entity.type} entity '${entity.name}': ${error instanceof Error ? error.message : String(error)}`,
            {
              entityType: entity.type,
              entityName: entity.name,
              filePath: parseResult.filePath,
              symbolId: matchingSymbol?.id,
              repositoryId: repositoryId,
            }
          );
        }
      }
    }
  }

  async persistVirtualFrameworkSymbols(
    repository: Repository,
    symbolGraph: SymbolGraphData,
    existingSymbols: Symbol[]
  ): Promise<void> {
    const virtualNodes = symbolGraph.nodes.filter(node => node.fileId < 0);

    if (virtualNodes.length === 0) {
      return;
    }

    this.logger.info('Persisting virtual framework symbols', { count: virtualNodes.length });

    const symbolsByFramework = new Map<string, typeof virtualNodes>();

    for (const node of virtualNodes) {
      const existingSymbol = existingSymbols.find(s => s.id === node.id);
      const framework = existingSymbol?.framework || 'unknown';

      if (!symbolsByFramework.has(framework)) {
        symbolsByFramework.set(framework, []);
      }
      symbolsByFramework.get(framework)!.push(node);
    }

    const idMapping = new Map<number, number>();

    for (const [framework, nodes] of symbolsByFramework) {
      const frameworkFile = await FileService.createFile(this.db, {
        repo_id: repository.id,
        path: `[Framework:${framework}]`,
        language: framework.toLowerCase(),
        size: 0,
        is_generated: true,
      });

      const symbolsToCreate: CreateSymbol[] = nodes.map(node => {
        const createSymbol: CreateSymbol = {
          file_id: frameworkFile.id,
          name: node.name,
          symbol_type: node.type,
          start_line: node.startLine,
          end_line: node.endLine,
          is_exported: node.isExported,
          signature: node.signature,
        };

        if (node.visibility) {
          createSymbol.visibility = node.visibility as any;
        }

        return createSymbol;
      });

      const createdSymbols = await SymbolService.createSymbols(this.db, symbolsToCreate);

      for (let i = 0; i < nodes.length; i++) {
        idMapping.set(nodes[i].id, createdSymbols[i].id);
        const originalNode = symbolGraph.nodes.find(n => n.id === nodes[i].id);
        if (originalNode) {
          originalNode.id = createdSymbols[i].id;
          originalNode.fileId = createdSymbols[i].file_id;
        }
      }
    }

    for (const edge of symbolGraph.edges) {
      if (idMapping.has(edge.from)) {
        edge.from = idMapping.get(edge.from)!;
      }
      if (idMapping.has(edge.to)) {
        edge.to = idMapping.get(edge.to)!;
      }
    }

    this.logger.info('Virtual framework symbols persisted', { count: idMapping.size });
  }

  private findFileForEntity(
    filePath: string,
    filesMap: Map<string, File>,
    normalizedFilesMap: Map<string, File>,
    allFiles: File[]
  ): File | null {
    let matchingFile = filesMap.get(filePath);

    if (matchingFile) {
      return matchingFile;
    }

    const normalizedPath = path.normalize(filePath);
    matchingFile = normalizedFilesMap.get(normalizedPath);

    if (matchingFile) {
      return matchingFile;
    }

    const parseResultBasename = path.basename(filePath);
    const parseResultDir = path.dirname(filePath);
    const normalizedDir = path.normalize(parseResultDir);

    matchingFile = allFiles.find(f => {
      const dbPathBasename = path.basename(f.path);

      if (dbPathBasename !== parseResultBasename) {
        return false;
      }

      const dbPathDir = path.dirname(f.path);
      const normalizedDbDir = path.normalize(dbPathDir);

      if (normalizedDir === normalizedDbDir) {
        return true;
      }

      const parseResultDirParts = normalizedDir.split(path.sep).filter(Boolean);
      const dbPathDirParts = normalizedDbDir.split(path.sep).filter(Boolean);

      const minLength = Math.min(parseResultDirParts.length, dbPathDirParts.length);

      if (minLength >= 3) {
        const parseResultLast3 = parseResultDirParts.slice(-3).join(path.sep);
        const dbPathLast3 = dbPathDirParts.slice(-3).join(path.sep);

        if (parseResultLast3 === dbPathLast3) {
          return true;
        }
      }

      if (minLength >= 2) {
        const parseResultLast2 = parseResultDirParts.slice(-2).join(path.sep);
        const dbPathLast2 = dbPathDirParts.slice(-2).join(path.sep);

        if (parseResultLast2 === dbPathLast2) {
          return true;
        }
      }

      return false;
    });

    if (!matchingFile) {
      this.logger.debug('File lookup failed for entity', {
        requestedPath: filePath,
        normalizedPath,
        basename: parseResultBasename,
        directory: parseResultDir,
        normalizedDirectory: normalizedDir,
        availableFilesWithSameBasename: allFiles
          .filter(f => path.basename(f.path) === parseResultBasename)
          .map(f => ({
            path: f.path,
            normalized: path.normalize(f.path),
            dir: path.dirname(f.path),
          })),
      });
    }

    return matchingFile || null;
  }

  private findClosureSymbolForRoute(
    route: LaravelRoute,
    fileSymbols: Symbol[]
  ): number | null {
    if (route.action !== 'Closure' || !route.metadata?.closureLineNumber) {
      return null;
    }

    const closureSymbol = fileSymbols.find(
      s =>
        s.start_line === route.metadata.closureLineNumber &&
        s.symbol_type === SymbolType.FUNCTION &&
        isClosureSymbolName(s.name)
    );

    if (closureSymbol) {
      this.logger.debug('Linked closure route to symbol during persistence', {
        routePath: route.path,
        closureSymbolId: closureSymbol.id,
        closureSymbolName: closureSymbol.name,
        lineNumber: route.metadata.closureLineNumber,
      });
      return closureSymbol.id;
    }

    this.logger.warn('Closure symbol not found for route', {
      routePath: route.path,
      expectedLineNumber: route.metadata.closureLineNumber,
      availableSymbols: fileSymbols
        .filter(s => s.symbol_type === SymbolType.FUNCTION)
        .map(s => ({ name: s.name, line: s.start_line })),
    });

    return null;
  }
}
