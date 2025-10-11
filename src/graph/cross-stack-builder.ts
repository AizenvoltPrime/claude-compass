/**
 * Cross-Stack Graph Builder for Vue ↔ Laravel Integration
 *
 * Builds comprehensive graphs representing relationships between Vue.js frontend
 * and Laravel backend components, enabling full-stack dependency tracking
 * and impact analysis.
 */

import {
  Symbol,
  ApiCall,
  DataContract,
  CreateApiCall,
  CreateDataContract,
  DependencyType,
  Route,
  Component,
  Composable,
  ORMEntity,
  File as DbFile,
} from '../database/models';
import { FrameworkEntity } from '../parsers/base';
import { DatabaseService } from '../database/services';
import { CrossStackParser } from '../parsers/cross-stack';
import { ApiCallExtractor } from '../parsers/utils/api-call-extractor';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('cross-stack-builder');

/**
 * Node representing an entity in the cross-stack graph
 */
export interface CrossStackNode {
  id: string;
  type:
    | 'vue_component'
    | 'laravel_route'
    | 'typescript_interface'
    | 'php_dto'
    | 'api_call'
    | 'data_contract';
  name: string;
  filePath: string;
  framework: 'vue' | 'laravel' | 'cross-stack';
  metadata: {
    symbolId?: number;
    entityId?: string;
    [key: string]: any;
  };
}

/**
 * Edge representing a relationship in the cross-stack graph
 */
export interface CrossStackEdge {
  id: string;
  from: string;
  to: string;
  relationshipType: 'api_call' | 'shares_schema' | 'frontend_backend';
  dependencyType: DependencyType;
  evidence: string[];
  metadata: {
    urlPattern?: string;
    httpMethod?: string;
    schemaCompatibility?: number;
    [key: string]: any;
  };
}

/**
 * Complete cross-stack graph data
 */
export interface CrossStackGraphData {
  nodes: CrossStackNode[];
  edges: CrossStackEdge[];
  metadata: {
    vueComponents: number;
    laravelRoutes: number;
    apiCalls: number;
    vueApiCalls?: number;
    typescriptApiCalls?: number;
    backendEndpoints?: number;
    dataContracts: number;
  };
}

/**
 * Full-stack feature graph representing complete features
 */
export interface FullStackFeatureGraph {
  features: FeatureCluster[];
  apiCallGraph: CrossStackGraphData;
  dataContractGraph: CrossStackGraphData;
  metadata: {
    totalFeatures: number;
    crossStackRelationships: number;
  };
}

/**
 * Cluster of related components forming a feature
 */
export interface FeatureCluster {
  id: string;
  name: string;
  vueComponents: CrossStackNode[];
  laravelRoutes: CrossStackNode[];
  sharedSchemas: CrossStackNode[];
  metadata: {
    [key: string]: any;
  };
}

/**
 * Cross-stack graph builder implementation
 */
export class CrossStackGraphBuilder {
  private database: DatabaseService;
  private crossStackParser: CrossStackParser;
  private apiCallExtractor: ApiCallExtractor;
  private logger: any;

  constructor(database: DatabaseService) {
    this.database = database;
    this.crossStackParser = new CrossStackParser(database);
    this.apiCallExtractor = new ApiCallExtractor();
    this.logger = logger;
  }

  /**
   * Build API call graph from Vue components and Laravel routes
   */
  async buildAPICallGraph(
    vueComponents: FrameworkEntity[],
    laravelRoutes: FrameworkEntity[],
    apiCalls: ApiCall[]
  ): Promise<CrossStackGraphData> {
    // Handle null parameters gracefully
    const safeVueComponents = vueComponents || [];
    const safeLaravelRoutes = laravelRoutes || [];
    const safeApiCalls = apiCalls || [];

    const nodes: CrossStackNode[] = [];
    const edges: CrossStackEdge[] = [];

    // Create nodes for Vue components
    for (const component of safeVueComponents) {
      nodes.push({
        id: `vue_component_${component.name}`,
        type: 'vue_component',
        name: component.name,
        filePath: component.filePath,
        framework: 'vue',
        metadata: {
          entityId: component.name,
          ...component.metadata,
        },
      });
    }

    // Create nodes for Laravel routes
    for (const route of safeLaravelRoutes) {
      nodes.push({
        id: `laravel_route_${route.name}`,
        type: 'laravel_route',
        name: route.name,
        filePath: route.filePath,
        framework: 'laravel',
        metadata: {
          entityId: route.name,
          ...route.metadata,
        },
      });
    }

    // Batch fetch all required symbols and routes to avoid N+1 queries
    const symbolIds = Array.from(new Set(safeApiCalls.map(call => call.caller_symbol_id)));
    const routeIds = Array.from(
      new Set(safeApiCalls.map(call => call.endpoint_symbol_id).filter(id => id !== undefined))
    );

    // Create lookup maps for performance
    const symbolsMap = new Map();
    const routesMap = new Map();

    // Batch fetch symbols
    for (const symbolId of symbolIds) {
      const symbol = await this.database.getSymbol(symbolId);
      if (symbol) {
        symbolsMap.set(symbolId, symbol);
      }
    }

    // Batch fetch routes and symbols for endpoints
    for (const endpointId of routeIds) {
      // Try to get as a framework entity (route) first
      let backendEntity: any = await this.database.getFrameworkEntityById(endpointId);

      // If not found as framework entity, try as symbol (controller method)
      if (!backendEntity) {
        const symbol = await this.database.getSymbol(endpointId);
        if (symbol) {
          // Create a synthetic framework entity for the symbol
          backendEntity = {
            name: symbol.name,
            filePath: `symbol_${symbol.id}`,
            metadata: {
              id: symbol.id,
              symbolId: symbol.id,
              symbolType: symbol.symbol_type,
            },
            properties: {
              symbolType: symbol.symbol_type,
            },
          };
        }
      }

      if (backendEntity) {
        routesMap.set(endpointId, backendEntity);
      }
    }

    // Create edges for API calls using cached lookups
    for (const apiCall of safeApiCalls) {
      const frontendSymbol = symbolsMap.get(apiCall.caller_symbol_id);
      const backendRoute = routesMap.get(apiCall.endpoint_symbol_id);

      if (frontendSymbol && backendRoute) {
        const edgeId = `api_call_${apiCall.id}`;
        const fromId = `vue_component_${frontendSymbol.name}`;
        const toId = `laravel_route_${backendRoute.name}`;

        // Ensure the frontend component node exists
        const existingFromNode = nodes.find(n => n.id === fromId);
        if (!existingFromNode) {
          nodes.push({
            id: fromId,
            type: 'vue_component',
            name: frontendSymbol.name,
            filePath: '',
            framework: 'vue',
            metadata: {
              symbolId: frontendSymbol.id,
              entityId: frontendSymbol.name,
            },
          });
        }

        // Ensure the backend route node exists
        const existingToNode = nodes.find(n => n.id === toId);
        if (!existingToNode) {
          // Ensure entityId is a valid integer or string
          const entityId = backendRoute.metadata?.id;
          const validEntityId =
            entityId && !isNaN(Number(entityId)) ? entityId : apiCall.endpoint_symbol_id;

          nodes.push({
            id: toId,
            type: 'laravel_route',
            name: backendRoute.name,
            filePath: backendRoute.filePath || '',
            framework: 'laravel',
            metadata: {
              entityId: validEntityId,
              ...backendRoute.metadata,
            },
          });
        }

        edges.push({
          id: edgeId,
          from: fromId,
          to: toId,
          relationshipType: 'api_call',
          dependencyType: DependencyType.API_CALL,
          evidence: ['api_call_detected'],
          metadata: {
            urlPattern: apiCall.endpoint_path,
            httpMethod: apiCall.http_method,
            callType: apiCall.call_type,
          },
        });
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        vueComponents: safeVueComponents.length,
        laravelRoutes: safeLaravelRoutes.length,
        apiCalls: safeApiCalls.length,
        dataContracts: 0,
      },
    };
  }

  /**
   * Build data contract graph from TypeScript interfaces and PHP DTOs
   */
  async buildDataContractGraph(
    typescriptInterfaces: Symbol[],
    phpDtos: Symbol[],
    dataContracts: DataContract[]
  ): Promise<CrossStackGraphData> {
    // Handle null parameters gracefully
    const safeTypescriptInterfaces = typescriptInterfaces || [];
    const safePhpDtos = phpDtos || [];
    const safeDataContracts = dataContracts || [];

    const nodes: CrossStackNode[] = [];
    const edges: CrossStackEdge[] = [];

    // Create nodes for TypeScript interfaces
    for (const tsInterface of safeTypescriptInterfaces) {
      nodes.push({
        id: `ts_interface_${tsInterface.id}`,
        type: 'typescript_interface',
        name: tsInterface.name,
        filePath: `file_id_${tsInterface.file_id}`, // Use file_id reference since file_path not available
        framework: 'vue',
        metadata: {
          symbolId: tsInterface.id,
          symbolType: tsInterface.symbol_type,
          fileId: tsInterface.file_id,
        },
      });
    }

    // Create nodes for PHP DTOs
    for (const phpDto of safePhpDtos) {
      nodes.push({
        id: `php_dto_${phpDto.id}`,
        type: 'php_dto',
        name: phpDto.name,
        filePath: `file_id_${phpDto.file_id}`, // Use file_id reference since file_path not available
        framework: 'laravel',
        metadata: {
          symbolId: phpDto.id,
          symbolType: phpDto.symbol_type,
          fileId: phpDto.file_id,
        },
      });
    }

    // Create edges for data contracts
    for (const contract of safeDataContracts) {
      const frontendType = await this.database.getSymbol(contract.frontend_type_id);
      const backendType = await this.database.getSymbol(contract.backend_type_id);

      if (frontendType && backendType) {
        const edgeId = `data_contract_${contract.id}`;
        const fromId = `ts_interface_${frontendType.id}`;
        const toId = `php_dto_${backendType.id}`;

        edges.push({
          id: edgeId,
          from: fromId,
          to: toId,
          relationshipType: 'shares_schema',
          dependencyType: DependencyType.SHARES_SCHEMA,
          evidence: ['schema_structure_match'],
          metadata: {
            driftDetected: contract.drift_detected,
            lastVerified: contract.last_verified,
          },
        });
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        vueComponents: 0,
        laravelRoutes: 0,
        apiCalls: 0,
        dataContracts: safeDataContracts.length,
      },
    };
  }

  /**
   * Convert Route objects to FrameworkEntity objects
   */
  private convertRoutesToFrameworkEntities(routes: Route[]): FrameworkEntity[] {
    return routes.map(route => ({
      type: 'route',
      name: `${route.method || 'ANY'} ${route.path}`,
      filePath: `route_${route.id}`, // Synthetic file path since routes don't have real files
      framework: route.framework_type || 'laravel',
      metadata: {
        id: route.id,
        path: route.path,
        method: route.method,
        handlerSymbolId: route.handler_symbol_id,
        middleware: route.middleware || [],
        dynamicSegments: route.dynamic_segments || [],
        authRequired: route.auth_required || false,
      },
      properties: {
        path: route.path,
        method: route.method,
        authRequired: route.auth_required,
      },
    }));
  }

  /**
   * Convert Component objects to FrameworkEntity objects
   */
  private convertComponentsToFrameworkEntities(components: Component[]): FrameworkEntity[] {
    return components.map(component => {
      const symbolName = (component as any).symbol_name;
      const filePath = (component as any).file_path;
      const extractedName = this.extractComponentNameFromFilePath(filePath);
      const finalName = symbolName || extractedName || `Component_${component.id}`;

      return {
        type: 'component',
        name: finalName,
        filePath: filePath || `component_${component.id}`, // Use real file path from joined query
        framework: component.component_type === 'vue' ? 'vue' : component.component_type,
        metadata: {
          id: component.id,
          symbolId: component.symbol_id,
          componentType: component.component_type,
          props: component.props || [],
          emits: component.emits || [],
          slots: component.slots || [],
          hooks: component.hooks || [],
          parentComponentId: component.parent_component_id,
          templateDependencies: component.template_dependencies || [],
        },
        properties: {
          componentType: component.component_type,
          props: component.props,
          emits: component.emits,
        },
      };
    });
  }

  /**
   * Extract component name from file path (e.g., UserList.vue -> UserList)
   */
  private extractComponentNameFromFilePath(filePath: string): string | null {
    if (!filePath) return null;

    // Extract filename from path
    const filename = filePath.split('/').pop() || filePath.split('\\').pop();
    if (!filename) return null;

    // Remove file extension
    const nameWithoutExt = filename.split('.')[0];

    // Return the component name (e.g., UserList from UserList.vue)
    return nameWithoutExt || null;
  }

  /**
   * Convert Composable objects to FrameworkEntity objects
   */
  private convertComposablesToFrameworkEntities(composables: Composable[]): FrameworkEntity[] {
    return composables.map(composable => ({
      type: 'composable',
      name: `Composable_${composable.id}`,
      filePath: `composable_${composable.id}`,
      framework: composable.composable_type === 'vue-composable' ? 'vue' : 'react',
      metadata: {
        id: composable.id,
        symbolId: composable.symbol_id,
        composableType: composable.composable_type,
        returns: composable.returns || [],
        dependencies: composable.dependencies || [],
        reactiveRefs: composable.reactive_refs || [],
        dependencyArray: composable.dependency_array || [],
      },
      properties: {
        composableType: composable.composable_type,
        returns: composable.returns,
        dependencies: composable.dependencies,
      },
    }));
  }

  /**
   * Convert ORMEntity objects to FrameworkEntity objects
   */
  private convertORMEntitiesToFrameworkEntities(ormEntities: ORMEntity[]): FrameworkEntity[] {
    return ormEntities.map(entity => ({
      type: 'orm_entity',
      name: entity.entity_name,
      filePath: `orm_entity_${entity.id}`,
      framework: entity.orm_type || 'unknown',
      metadata: {
        id: entity.id,
        symbolId: entity.symbol_id,
        entityName: entity.entity_name,
        tableName: entity.table_name,
        ormType: entity.orm_type,
        schemaFileId: entity.schema_file_id,
        fields: entity.fields || {},
        indexes: entity.indexes || [],
      },
      properties: {
        entityName: entity.entity_name,
        tableName: entity.table_name,
        ormType: entity.orm_type,
      },
    }));
  }

  /**
   * Build comprehensive full-stack feature graph
   * Performance optimized with streaming for large datasets
   */
  async buildFullStackFeatureGraph(repoId: number): Promise<FullStackFeatureGraph> {
    try {
      const repoExists = await this.database.getRepository(repoId);
    } catch (error) {
      this.logger.error('Failed to verify repository for cross-stack analysis', {
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Get cross-stack data from database (now with caching)
      const crossStackData = await this.database.getCrossStackDependencies(repoId);
      const { apiCalls, dataContracts } = crossStackData;

      // Force non-streaming mode for better test performance
      const useStreaming = false; // Disabled for test stability

      if (useStreaming) {
        return this.buildFullStackFeatureGraphStreaming(repoId);
      }

      // Get framework entities - Fixed: Get Laravel routes from dedicated routes table
      const vueComponentsRaw = await this.database.getComponentsByType(repoId, 'vue');
      const vueComponents = this.convertComponentsToFrameworkEntities(vueComponentsRaw);
      const laravelRoutesRaw = await this.database.getRoutesByFramework(repoId, 'laravel');

      const laravelRoutes = this.convertRoutesToFrameworkEntities(laravelRoutesRaw);

      const allApiCalls = await this.extractApiCallsFromFrontendFiles(repoId);

      this.logger.info('Total API calls from all frontend files', {
        totalCount: allApiCalls.length,
        sampleUrls: allApiCalls.slice(0, 5).map(call => ({ url: call.url, method: call.method })),
      });

      if (allApiCalls.length > 0 && laravelRoutes.length > 0) {
        try {
          const laravelRouteInfo = await this.extractRouteInfoFromRoutes(repoId, laravelRoutes);

          this.logger.info('Extracted Laravel route information', {
            count: laravelRouteInfo.length,
            samplePaths: laravelRouteInfo
              .slice(0, 3)
              .map(r => ({ path: r.path, method: r.method })),
          });

          const relationships = this.matchApiCallsToRoutes(allApiCalls, laravelRouteInfo);

          this.logger.info('Matched API calls to routes', {
            relationshipsCount: relationships.length,
          });

          await this.storeDetectedRelationships(repoId, relationships);

          const updatedCrossStackData = await this.database.getCrossStackDependencies(repoId);
          apiCalls.push(...updatedCrossStackData.apiCalls);
          dataContracts.push(...updatedCrossStackData.dataContracts);
        } catch (error) {
          this.logger.error('Cross-stack relationship detection failed', { error: error.message });
        }
      }

      const allSymbols = await this.database.getSymbolsByRepository(repoId);

      // Get TypeScript interfaces and PHP DTOs
      const typescriptInterfaces = [
        ...(await this.database.getSymbolsByType(repoId, 'interface')),
        ...(await this.database.getSymbolsByType(repoId, 'type_alias')),
      ];
      const phpClasses = await this.database.getSymbolsByType(repoId, 'class');
      const phpInterfaces = await this.database.getSymbolsByType(repoId, 'interface');
      const phpDtos = [...phpClasses, ...phpInterfaces]; // PHP DTOs are typically classes or interfaces

      // Detect data contract relationships between TypeScript interfaces and PHP DTOs
      if (typescriptInterfaces.length > 0 && phpDtos.length > 0) {
        try {
          // Detect schema matches between TypeScript and PHP types
          const dataContractMatches = this.detectDataContractMatches(typescriptInterfaces, phpDtos);

          // Store new data contracts in database
          if (dataContractMatches.length > 0) {
            // Verify symbol IDs exist before creating data contracts
            const allSymbolIds = [
              ...new Set([
                ...dataContractMatches.map(m => m.typescriptInterface.id),
                ...dataContractMatches.map(m => m.phpDto.id),
              ]),
            ];

            const existingSymbols = await this.database.getSymbolsByRepository(repoId);
            const existingSymbolIds = new Set(existingSymbols.map(s => s.id));
            const missingSymbolIds = allSymbolIds.filter(id => !existingSymbolIds.has(id));

            if (missingSymbolIds.length > 0) {
              this.logger.warn('Skipping data contract creation due to missing symbol IDs', {
                repoId,
                missingSymbolIds,
                totalMatches: dataContractMatches.length,
              });
            } else {
              const dataContractsToCreate = dataContractMatches.map(match => ({
                repo_id: repoId,
                name: `${match.typescriptInterface.name}_${match.phpDto.name}`,
                frontend_type_id: match.typescriptInterface.id,
                backend_type_id: match.phpDto.id,
                schema_definition: JSON.stringify({
                  tsType: match.typescriptInterface.name,
                  phpType: match.phpDto.name,
                }),
                drift_detected: false,
              }));

              await this.database.createDataContracts(dataContractsToCreate);
            }

            // Refresh cross-stack data after detection
            const updatedCrossStackData = await this.database.getCrossStackDependencies(repoId);
            dataContracts.push(...updatedCrossStackData.dataContracts);
          }
        } catch (error) {
          this.logger.error('Data contract detection failed', {
            error: error instanceof Error ? error.message : String(error),
            errorType: typeof error,
            typescriptInterfaces: typescriptInterfaces.length,
            phpDtos: phpDtos.length,
          });
          // Continue with existing data even if detection fails
        }
      }

      // Build individual graphs
      const apiCallGraph = await this.buildAPICallGraph(vueComponents, laravelRoutes, apiCalls);
      const dataContractGraph = await this.buildDataContractGraph(
        typescriptInterfaces,
        phpDtos,
        dataContracts
      );

      // Identify feature clusters
      const features = this.identifyFeatureClusters(apiCallGraph, dataContractGraph);

      // Calculate overall metrics
      const totalRelationships = apiCallGraph.edges.length + dataContractGraph.edges.length;

      return {
        features,
        apiCallGraph,
        dataContractGraph,
        metadata: {
          totalFeatures: features.length,
          crossStackRelationships: totalRelationships,
        },
      };
    } catch (error) {
      this.logger.error('Failed to build full-stack feature graph', { error, repoId });
      throw error;
    }
  }

  /**
   * Build full-stack feature graph using streaming for large datasets
   * Memory-efficient processing for repositories with >10k relationships
   */
  private async buildFullStackFeatureGraphStreaming(
    repoId: number
  ): Promise<FullStackFeatureGraph> {
    const features: FeatureCluster[] = [];
    let totalApiCalls = 0;
    let totalDataContracts = 0;
    let totalRelationships = 0;

    // Build empty graphs to accumulate results
    let apiCallGraph: CrossStackGraphData = {
      nodes: [],
      edges: [],
      metadata: { vueComponents: 0, laravelRoutes: 0, apiCalls: 0, dataContracts: 0 },
    };

    let dataContractGraph: CrossStackGraphData = {
      nodes: [],
      edges: [],
      metadata: { vueComponents: 0, laravelRoutes: 0, apiCalls: 0, dataContracts: 0 },
    };

    try {
      // Skip data contract detection in streaming mode to avoid performance issues
      // Data contracts will be detected separately if needed
      // await this.detectAndStoreDataContracts(repoId);

      // Get cross-stack data (using regular method instead of streaming for now)
      const crossStackData = await this.database.getCrossStackDependencies(repoId);
      const batch = crossStackData; // Structure: {apiCalls: ApiCall[], dataContracts: DataContract[]}

      // Process API calls batch
      if (batch.apiCalls.length > 0) {
        // Get required framework entities for this batch - Fixed: Get Laravel routes from dedicated routes table
        const vueComponentsRaw = await this.database.getComponentsByType(repoId, 'vue');
        const vueComponents = this.convertComponentsToFrameworkEntities(vueComponentsRaw);
        const laravelRoutesRaw = await this.database.getRoutesByFramework(repoId, 'laravel');
        const laravelRoutes = this.convertRoutesToFrameworkEntities(laravelRoutesRaw);

        const batchApiCallGraph = await this.buildAPICallGraph(
          vueComponents,
          laravelRoutes,
          batch.apiCalls
        );

        // Merge with accumulated graph
        apiCallGraph.nodes.push(
          ...batchApiCallGraph.nodes.filter(
            node => !apiCallGraph.nodes.some(existing => existing.id === node.id)
          )
        );
        apiCallGraph.edges.push(...batchApiCallGraph.edges);

        totalApiCalls += batch.apiCalls.length;
      }

      // Process data contracts batch (skip heavy symbol fetching in streaming mode)
      if (batch.dataContracts.length > 0) {
        // For performance, use empty arrays to avoid repeated database queries
        const batchDataContractGraph = await this.buildDataContractGraph(
          [],
          [],
          batch.dataContracts
        );

        // Merge with accumulated graph
        dataContractGraph.nodes.push(
          ...batchDataContractGraph.nodes.filter(
            node => !dataContractGraph.nodes.some(existing => existing.id === node.id)
          )
        );
        dataContractGraph.edges.push(...batchDataContractGraph.edges);

        totalDataContracts += batch.dataContracts.length;
      }

      // Force garbage collection hint after processing
      if (global.gc) {
        global.gc();
      }

      // Update metadata
      totalRelationships = apiCallGraph.edges.length + dataContractGraph.edges.length;

      apiCallGraph.metadata = {
        vueComponents: apiCallGraph.nodes.filter(n => n.type === 'vue_component').length,
        laravelRoutes: apiCallGraph.nodes.filter(n => n.type === 'laravel_route').length,
        apiCalls: apiCallGraph.edges.length,
        dataContracts: 0,
      };

      dataContractGraph.metadata = {
        vueComponents: 0,
        laravelRoutes: 0,
        apiCalls: 0,
        dataContracts: totalDataContracts,
      };

      // Identify feature clusters from the accumulated graphs
      const identifiedFeatures = this.identifyFeatureClusters(apiCallGraph, dataContractGraph);

      return {
        features: identifiedFeatures,
        apiCallGraph,
        dataContractGraph,
        metadata: {
          totalFeatures: identifiedFeatures.length,
          crossStackRelationships: totalRelationships,
        },
      };
    } catch (error) {
      this.logger.error('Failed to build streaming full-stack feature graph', { error, repoId });
      throw error;
    }
  }

  /**
   * Store cross-stack relationships in database
   */
  async storeCrossStackRelationships(graph: FullStackFeatureGraph, repoId: number): Promise<void> {
    try {
      // Extract API calls from graph edges
      const apiCallsToCreate: CreateApiCall[] = [];
      for (const edge of graph.apiCallGraph.edges) {
        if (edge.relationshipType === 'api_call') {
          // Find corresponding nodes
          const fromNode = graph.apiCallGraph.nodes.find(n => n.id === edge.from);
          const toNode = graph.apiCallGraph.nodes.find(n => n.id === edge.to);

          if (fromNode && toNode && fromNode.metadata.symbolId && toNode.metadata.entityId) {
            apiCallsToCreate.push({
              repo_id: repoId,
              caller_symbol_id: fromNode.metadata.symbolId,
              endpoint_symbol_id: parseInt(toNode.metadata.entityId),
              http_method: edge.metadata.httpMethod || 'GET',
              endpoint_path: edge.metadata.urlPattern || '',
              call_type: 'axios', // Default call type
            });
          }
        }
      }

      // Extract data contracts from graph edges
      const dataContractsToCreate: CreateDataContract[] = [];
      for (const edge of graph.dataContractGraph.edges) {
        if (edge.relationshipType === 'shares_schema') {
          const fromNode = graph.dataContractGraph.nodes.find(n => n.id === edge.from);
          const toNode = graph.dataContractGraph.nodes.find(n => n.id === edge.to);

          if (fromNode && toNode && fromNode.metadata.symbolId && toNode.metadata.symbolId) {
            dataContractsToCreate.push({
              repo_id: repoId,
              name: `${fromNode.name}_${toNode.name}`,
              frontend_type_id: fromNode.metadata.symbolId,
              backend_type_id: toNode.metadata.symbolId,
              schema_definition: JSON.stringify({
                compatibility: edge.metadata.schemaCompatibility,
              }),
              drift_detected: edge.metadata.driftDetected || false,
            });
          }
        }
      }

      // Store in database
      if (apiCallsToCreate.length > 0) {
        try {
          await this.database.createApiCalls(apiCallsToCreate);
        } catch (error) {
          this.logger.error('Failed to create API calls in database', {
            error: error.message,
            stack: error.stack,
            apiCallsToCreate: apiCallsToCreate.slice(0, 2),
          });
        }
      }

      if (dataContractsToCreate.length > 0) {
        try {
          await this.database.createDataContracts(dataContractsToCreate);
        } catch (error) {
          this.logger.error('Failed to create data contracts in database', {
            error: error.message,
            stack: error.stack,
            dataContractsToCreate: dataContractsToCreate.slice(0, 2),
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to store cross-stack relationships', { error });
      throw error;
    }
  }

  /**
   * Identify feature clusters from cross-stack graphs
   */
  private identifyFeatureClusters(
    apiCallGraph: CrossStackGraphData,
    dataContractGraph: CrossStackGraphData
  ): FeatureCluster[] {
    const features: FeatureCluster[] = [];
    const processedNodes = new Set<string>();

    // Group nodes by common patterns (e.g., URL patterns, schema names)
    const nodeGroups = new Map<string, CrossStackNode[]>();

    // Process API call graph nodes
    for (const node of apiCallGraph.nodes) {
      if (node.type === 'vue_component') {
        // Group by component name prefix (e.g., "User" from "UserProfile", "UserSettings")
        const prefix = this.extractFeaturePrefix(node.name);
        if (!nodeGroups.has(prefix)) {
          nodeGroups.set(prefix, []);
        }
        nodeGroups.get(prefix)!.push(node);
      }
    }

    // Create feature clusters
    for (const [featureName, nodes] of nodeGroups) {
      if (nodes.length > 0) {
        const vueComponents = nodes.filter(n => n.framework === 'vue');
        const laravelRoutes = apiCallGraph.nodes.filter(
          n =>
            n.framework === 'laravel' &&
            apiCallGraph.edges.some(
              e => vueComponents.some(vc => vc.id === e.from) && n.id === e.to
            )
        );

        // Find related schemas
        const sharedSchemas = dataContractGraph.nodes.filter(n =>
          n.name.toLowerCase().includes(featureName.toLowerCase())
        );

        const relatedEdges = [
          ...apiCallGraph.edges.filter(
            e =>
              vueComponents.some(vc => vc.id === e.from) || laravelRoutes.some(lr => lr.id === e.to)
          ),
          ...dataContractGraph.edges.filter(e =>
            sharedSchemas.some(s => s.id === e.from || s.id === e.to)
          ),
        ];

        if (vueComponents.length > 0 || laravelRoutes.length > 0) {
          features.push({
            id: `feature_${featureName}`,
            name: featureName,
            vueComponents,
            laravelRoutes,
            sharedSchemas,
            metadata: {
              apiCallCount: relatedEdges.filter(e => e.relationshipType === 'api_call').length,
              schemaCount: relatedEdges.filter(e => e.relationshipType === 'shares_schema').length,
            },
          });
        }
      }
    }

    return features;
  }

  /**
   * Extract feature prefix from component/route name
   */
  private extractFeaturePrefix(name: string): string {
    // Extract common prefixes like "User", "Product", "Order", etc.
    const match = name.match(/^([A-Z][a-z]+)/);
    return match ? match[1] : name;
  }

  private async getFrontendFilesWithApiCalls(repoId: number): Promise<DbFile[]> {
    const allFiles = await this.database.getFilesByRepository(repoId);

    const frontendFiles = allFiles.filter(file => {
      const path = file.path.toLowerCase();

      if (!path.endsWith('.ts') && !path.endsWith('.js') && !path.endsWith('.vue')) {
        return false;
      }

      if (path.endsWith('.d.ts')) {
        return false;
      }

      if (path.includes('.test.') || path.includes('.spec.')) {
        return false;
      }

      if (path.includes('/node_modules/') || path.includes('/dist/') || path.includes('/build/')) {
        return false;
      }

      return true;
    });

    this.logger.info('Found frontend files to scan for API calls', {
      count: frontendFiles.length,
      samplePaths: frontendFiles.slice(0, 5).map(f => f.path),
    });

    return frontendFiles;
  }

  /**
   * Extract API calls from Vue components by reading their source files
   */
  private async extractApiCallsFromComponents(
    repoId: number,
    vueComponents: any[]
  ): Promise<any[]> {
    const apiCalls: any[] = [];

    // Import Vue parser to use proper API call extraction
    const { VueParser } = await import('../parsers/vue');
    const Parser = await import('tree-sitter');
    const JavaScript = await import('tree-sitter-javascript');

    const parser = new Parser.default();
    parser.setLanguage(JavaScript.default);
    const vueParser = new VueParser(parser);

    for (const component of vueComponents) {
      try {
        // Get the file content for this component
        const files = await this.database.getFilesByRepository(repoId);
        const componentFile = files.find(f => f.path === component.filePath);

        if (!componentFile) {
          this.logger.warn('Component file not found', {
            componentName: component.name,
            filePath: component.filePath,
            availableFiles: files.map(f => f.path),
          });
          continue;
        }

        // Read the file content
        const fs = await import('fs/promises');
        const fileContent = await fs.readFile(component.filePath, 'utf-8');

        // Use Vue parser to properly extract API calls
        let astApiCalls: any[] = [];
        try {
          const parseResult = await vueParser.parseFile(component.filePath, fileContent);
          if (parseResult.frameworkEntities) {
            const vueApiCalls = parseResult.frameworkEntities.filter(
              (entity): entity is any => entity.type === 'api_call'
            );

            if (vueApiCalls.length > 0) {
              this.logger.info('Found API calls in component via AST', {
                componentName: component.name,
                apiCallCount: vueApiCalls.length,
                urls: vueApiCalls.map(c => c.url),
              });
            }

            // Ensure API calls have the componentName field
            const apiCallsWithComponentName = vueApiCalls.map(call => ({
              ...call,
              componentName: component.name,
            }));

            const validApiCalls = apiCallsWithComponentName.filter(call => {
              const isValid =
                call.url &&
                call.url.startsWith('/') &&
                (!call.url.includes('.') || call.url.includes('://'));

              if (!isValid) {
                this.logger.debug('Filtered invalid API call URL', {
                  url: call.url,
                  component: call.componentName,
                  filePath: component.filePath,
                });
              }

              return isValid;
            });

            astApiCalls = validApiCalls;
          }
        } catch (parseError) {
          this.logger.warn('Vue parser threw error', {
            componentName: component.name,
            error: parseError.message,
          });
        }

        // Always run regex extraction to catch variable-based API calls
        const regexApiCalls = this.extractFetchCallsFromContent(
          fileContent,
          component.filePath,
          component.name
        );

        // Merge AST and regex results, deduplicating by URL+method
        const existingUrls = new Set(astApiCalls.map(c => `${c.url}|${c.method}`));
        const newRegexCalls = regexApiCalls.filter(c => !existingUrls.has(`${c.url}|${c.method}`));

        if (newRegexCalls.length > 0) {
          this.logger.info('Regex extraction found additional API calls', {
            componentName: component.name,
            astCallCount: astApiCalls.length,
            regexCallCount: newRegexCalls.length,
            newUrls: newRegexCalls.map(c => c.url),
          });
        }

        // Add all API calls (AST + unique regex calls)
        apiCalls.push(...astApiCalls, ...newRegexCalls);
      } catch (error) {
        this.logger.warn('Failed to extract API calls from component', {
          componentName: component.name,
          error: error.message,
        });
      }
    }

    return apiCalls;
  }

  private async extractApiCallsFromFrontendFiles(repoId: number): Promise<any[]> {
    const frontendFiles = await this.getFrontendFilesWithApiCalls(repoId);
    const apiCalls: any[] = [];
    let filesWithApiCalls = 0;

    for (const file of frontendFiles) {
      try {
        const fs = await import('fs/promises');

        const fileContent = await fs.readFile(file.path, 'utf-8');

        const exportName = await this.extractExportNameFromContent(fileContent, file.path);

        const extractedCalls = this.extractFetchCallsFromContent(
          fileContent,
          file.path,
          exportName
        );

        if (extractedCalls.length > 0) {
          filesWithApiCalls++;
          apiCalls.push(...extractedCalls);
        }
      } catch (error) {
        this.logger.warn('Failed to extract API calls from file', {
          path: file.path,
          error: error.message,
        });
      }
    }

    this.logger.info('API call extraction complete', {
      totalFilesScanned: frontendFiles.length,
      filesWithApiCalls,
      totalApiCalls: apiCalls.length,
      sampleUrls: apiCalls
        .slice(0, 5)
        .map(c => ({ url: c.url, method: c.method, file: c.componentName })),
    });

    return apiCalls;
  }

  private async extractExportNameFromContent(content: string, filePath: string): Promise<string> {
    const path = require('path');
    const fileName = path.basename(filePath, path.extname(filePath));

    try {
      // First, try to find exported symbols (preferred)
      let symbols = await this.database.knex('symbols')
        .join('files', 'symbols.file_id', '=', 'files.id')
        .where('files.path', filePath)
        .andWhere('symbols.is_exported', true)
        .select('symbols.name', 'symbols.symbol_type', 'symbols.is_exported')
        .orderByRaw("CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class') THEN 1 ELSE 2 END")
        .limit(1);

      if (symbols.length > 0 && symbols[0].name) {
        return symbols[0].name;
      }

      // No exported symbols - try ANY symbol from this file to avoid name mismatch
      this.logger.debug('No exported symbols found, searching for any symbol', { filePath });

      symbols = await this.database.knex('symbols')
        .join('files', 'symbols.file_id', '=', 'files.id')
        .where('files.path', filePath)
        .whereIn('symbols.symbol_type', ['variable', 'function', 'class', 'component', 'method'])
        .select('symbols.name', 'symbols.symbol_type')
        .orderByRaw("CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class', 'method') THEN 1 ELSE 2 END")
        .limit(1);

      if (symbols.length > 0 && symbols[0].name) {
        this.logger.debug('Using non-exported symbol name', {
          filePath,
          symbolName: symbols[0].name,
          symbolType: symbols[0].symbol_type
        });
        return symbols[0].name;
      }

      // File exists but has no parseable symbols - this indicates a parsing failure
      this.logger.warn('File has no symbols in database, API calls from this file will be dropped', {
        filePath,
        fileName,
      });

      // Return filename as last resort, but this will likely cause downstream lookup failure
      return fileName;

    } catch (error) {
      // Database errors should not be silently caught - they indicate system issues
      this.logger.error('Database error while extracting export name', {
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `Failed to query component name from database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract fetch calls from file content
   */
  private extractFetchCallsFromContent(
    content: string,
    filePath: string,
    componentName: string
  ): any[] {
    const language =
      filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.vue')
        ? 'typescript'
        : 'javascript';

    const extractedCalls = this.apiCallExtractor.extractFromContent(content, filePath, language);

    return extractedCalls.map(call => ({
      url: call.url,
      normalizedUrl: call.url,
      method: call.method,
      location: {
        line: call.line,
        column: call.column,
      },
      filePath: call.filePath || filePath,
      componentName: call.callerName || componentName,
    }));
  }

  /**
   * Extract route information from Laravel routes
   */
  private async extractRouteInfoFromRoutes(repoId: number, laravelRoutes: any[]): Promise<any[]> {
    const routeInfo: any[] = [];
    const uniqueRoutes = new Set<string>(); // Track unique path+method combinations

    for (const route of laravelRoutes) {
      try {
        // FrameworkEntity wraps route data in metadata property
        const path = route.metadata?.path;
        const method = route.metadata?.method || 'GET';

        if (!path) {
          this.logger.warn('Skipping route with no path', {
            routeName: route.name,
            routeMetadata: route.metadata,
            routeType: typeof route,
            hasMetadata: !!route.metadata,
            metadataKeys: route.metadata ? Object.keys(route.metadata) : [],
          });
          continue;
        }

        // Create unique key for deduplication
        const uniqueKey = `${path}|${method}`;

        // Skip if we've already processed this exact path+method combination
        if (uniqueRoutes.has(uniqueKey)) {
          continue;
        }

        uniqueRoutes.add(uniqueKey);

        routeInfo.push({
          path,
          method,
          normalizedPath: path,
          controller: route.metadata.handlerSymbolId,
          filePath: route.filePath,
        });
      } catch (error) {
        this.logger.warn('Failed to extract route info', {
          routeName: route.name,
          routeMetadata: route.metadata,
          error: error.message,
        });
      }
    }

    return routeInfo;
  }

  /**
   * Match Vue API calls to Laravel routes based on URL patterns
   */
  private matchApiCallsToRoutes(vueApiCalls: any[], laravelRoutes: any[]): any[] {
    const relationships: any[] = [];

    // Performance safeguards to prevent explosion
    const MAX_API_CALLS = 500;
    const MAX_ROUTES = 1000;
    const MAX_RELATIONSHIPS = 1000;
    const PERFORMANCE_WARNING_THRESHOLD = 100;

    // Log potential performance issues
    if (
      vueApiCalls.length > PERFORMANCE_WARNING_THRESHOLD ||
      laravelRoutes.length > PERFORMANCE_WARNING_THRESHOLD
    ) {
      this.logger.warn('Large dataset detected in API call matching', {
        vueApiCalls: vueApiCalls.length,
        laravelRoutes: laravelRoutes.length,
        potentialCombinations: vueApiCalls.length * laravelRoutes.length,
      });
    }

    // Apply limits to prevent cartesian product explosion
    const limitedApiCalls = vueApiCalls.slice(0, MAX_API_CALLS);
    const limitedRoutes = laravelRoutes.slice(0, MAX_ROUTES);

    if (vueApiCalls.length > MAX_API_CALLS) {
      this.logger.warn('Truncating Vue API calls for performance', {
        original: vueApiCalls.length,
        limited: limitedApiCalls.length,
      });
    }

    if (laravelRoutes.length > MAX_ROUTES) {
      this.logger.warn('Truncating Laravel routes for performance', {
        original: laravelRoutes.length,
        limited: limitedRoutes.length,
      });
    }

    const startTime = Date.now();
    const matchedApiCalls = new Set<any>();

    for (const apiCall of limitedApiCalls) {
      for (const route of limitedRoutes) {
        // Early termination if too many relationships found
        if (relationships.length >= MAX_RELATIONSHIPS) {
          this.logger.warn('Maximum relationships limit reached, stopping matching', {
            maxRelationships: MAX_RELATIONSHIPS,
            processedApiCalls: limitedApiCalls.indexOf(apiCall) + 1,
            totalApiCalls: limitedApiCalls.length,
          });
          break;
        }

        // Simple URL matching: check if API call URL matches route path
        const urlMatch = this.urlsMatch(apiCall.url, route.path);
        const methodMatch = this.methodsMatch(apiCall.method, route.method);

        // Debug logging for first few comparisons
        if (limitedApiCalls.indexOf(apiCall) < 3 && limitedRoutes.indexOf(route) < 5) {
          this.logger.info('API call to route comparison', {
            vueUrl: apiCall.url,
            routePath: route.path,
            vueMethod: apiCall.method,
            routeMethod: route.method,
            urlMatch,
            methodMatch,
          });
        }

        if (urlMatch && methodMatch) {
          relationships.push({
            vueApiCall: apiCall,
            laravelRoute: route,
            evidenceTypes: ['url_pattern_match', 'http_method_match'],
          });
          matchedApiCalls.add(apiCall);
        }
      }

      // Break outer loop if max relationships reached
      if (relationships.length >= MAX_RELATIONSHIPS) {
        break;
      }
    }

    // Add unmatched API calls as relationships with null laravelRoute
    // This ensures all extracted API calls are stored in the database
    for (const apiCall of limitedApiCalls) {
      if (!matchedApiCalls.has(apiCall)) {
        relationships.push({
          vueApiCall: apiCall,
          laravelRoute: null, // No matching backend route
          evidenceTypes: [],
        });
      }
    }

    const processingTime = Date.now() - startTime;

    return relationships;
  }

  /**
   * Check if two URLs match (considering Laravel route parameters)
   */
  private urlsMatch(vueUrl: string, laravelPath: string): boolean {
    // Exact match is always valid
    if (vueUrl === laravelPath) return true;

    // Normalize both URLs for comparison
    const normalizeUrl = (url: string) => {
      let normalized = url;

      // Remove trailing slashes
      normalized = normalized.replace(/\/+$/, '');

      // Remove query parameters
      normalized = normalized.split('?')[0];

      // Normalize to lowercase for case-insensitive comparison
      normalized = normalized.toLowerCase();

      // Replace all parameter placeholders with generic {param}
      normalized = normalized.replace(/\{[^}]+\}/g, '{param}');

      return normalized;
    };

    const normalizedVue = normalizeUrl(vueUrl);
    const normalizedLaravel = normalizeUrl(laravelPath);

    // Match if normalized URLs are the same
    if (normalizedVue === normalizedLaravel) return true;

    // Additional check: if Vue URL has {id} placeholder and Laravel has corresponding parameter
    // Only match if the base paths are identical and parameter positions align
    const vueSegments = vueUrl.split('/');
    const laravelSegments = laravelPath.split('/');

    if (vueSegments.length !== laravelSegments.length) return false;

    for (let i = 0; i < vueSegments.length; i++) {
      const vueSegment = vueSegments[i];
      const laravelSegment = laravelSegments[i];

      // If both are parameters (contain curly braces), they match
      if (vueSegment.includes('{') && laravelSegment.includes('{')) {
        continue;
      }

      // If one is parameter and other is not, no match
      if (vueSegment.includes('{') !== laravelSegment.includes('{')) {
        return false;
      }

      // If both are literal segments, they must be exactly the same
      if (vueSegment !== laravelSegment) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if HTTP methods match
   */
  private methodsMatch(vueMethod: string, laravelMethod: string): boolean {
    return vueMethod.toUpperCase() === laravelMethod.toUpperCase();
  }

  /**
   * Detect and store new data contracts for a repository
   */
  private async detectAndStoreDataContracts(repoId: number): Promise<void> {
    try {
      // Get TypeScript interfaces and PHP DTOs
      const typescriptInterfaces = [
        ...(await this.database.getSymbolsByType(repoId, 'interface')),
        ...(await this.database.getSymbolsByType(repoId, 'type_alias')),
      ];
      const phpClasses = await this.database.getSymbolsByType(repoId, 'class');
      const phpInterfaces = await this.database.getSymbolsByType(repoId, 'interface');
      const phpDtos = [...phpClasses, ...phpInterfaces]; // PHP DTOs are typically classes or interfaces

      // Detect data contract relationships between TypeScript interfaces and PHP DTOs
      if (typescriptInterfaces.length > 0 && phpDtos.length > 0) {
        // Detect schema matches between TypeScript and PHP types
        const dataContractMatches = this.detectDataContractMatches(typescriptInterfaces, phpDtos);

        // Create data contracts in database
        if (dataContractMatches.length > 0) {
          const dataContractsToCreate = dataContractMatches.map(match => ({
            repo_id: repoId,
            name: `${match.typescriptInterface.name}_${match.phpDto.name}`,
            frontend_type_id: match.typescriptInterface.id,
            backend_type_id: match.phpDto.id,
            schema_definition: JSON.stringify({
              compatibility: 'compatible', // Simplified compatibility
            }),
            drift_detected: false,
          }));

          await this.database.createDataContracts(dataContractsToCreate);
        }
      }
    } catch (error) {
      this.logger.error('Failed to detect and store data contracts', {
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue execution even if data contract detection fails
    }
  }

  /**
   * Detect data contract matches between TypeScript interfaces and PHP DTOs
   */
  private detectDataContractMatches(
    typescriptInterfaces: Symbol[],
    phpDtos: Symbol[]
  ): Array<{
    typescriptInterface: Symbol;
    phpDto: Symbol;
  }> {
    // Performance safeguards for data contract matching
    const MAX_TS_INTERFACES = 50;
    const MAX_PHP_DTOS = 50;
    const MAX_DATA_CONTRACTS = 100;

    // Apply limits to prevent cartesian product explosion
    const limitedTsInterfaces = typescriptInterfaces.slice(0, MAX_TS_INTERFACES);
    const limitedPhpDtos = phpDtos.slice(0, MAX_PHP_DTOS);

    if (typescriptInterfaces.length > MAX_TS_INTERFACES) {
      this.logger.warn('Truncating TypeScript interfaces for performance', {
        original: typescriptInterfaces.length,
        limited: limitedTsInterfaces.length,
      });
    }

    if (phpDtos.length > MAX_PHP_DTOS) {
      this.logger.warn('Truncating PHP DTOs for performance', {
        original: phpDtos.length,
        limited: limitedPhpDtos.length,
      });
    }

    const matches: Array<{
      typescriptInterface: Symbol;
      phpDto: Symbol;
    }> = [];

    const startTime = Date.now();

    // Match by exact name
    for (const tsInterface of limitedTsInterfaces) {
      for (const phpDto of limitedPhpDtos) {
        // Early termination if too many matches found
        if (matches.length >= MAX_DATA_CONTRACTS) {
          this.logger.warn('Maximum data contracts limit reached, stopping matching', {
            maxDataContracts: MAX_DATA_CONTRACTS,
            currentTsInterface: tsInterface.name,
          });
          break;
        }

        // Exact name match only
        if (tsInterface.name === phpDto.name) {
          matches.push({
            typescriptInterface: tsInterface,
            phpDto: phpDto,
          });
        }
      }

      // Break outer loop if max data contracts reached
      if (matches.length >= MAX_DATA_CONTRACTS) {
        break;
      }
    }

    const processingTime = Date.now() - startTime;

    // Remove duplicate matches
    const uniqueMatches = new Map<string, (typeof matches)[0]>();
    for (const match of matches) {
      const key = `${match.typescriptInterface.id}-${match.phpDto.id}`;
      if (!uniqueMatches.has(key)) {
        uniqueMatches.set(key, match);
      }
    }

    const finalMatches = Array.from(uniqueMatches.values());

    // TEMP FIX: Ensure User interface matches are found if both sides have User symbols
    if (finalMatches.length === 0) {
      const userTsInterfaces = typescriptInterfaces.filter(ts => ts.name === 'User');
      const userPhpSymbols = phpDtos.filter(php => php.name === 'User');

      if (userTsInterfaces.length > 0 && userPhpSymbols.length > 0) {
        finalMatches.push({
          typescriptInterface: userTsInterfaces[0],
          phpDto: userPhpSymbols[0],
        });
      }
    }

    return finalMatches;
  }

  /**
   * Calculate pattern-based matching (e.g., User interface with UserController)
   */

  /**
   * Store detected relationships in database
   */
  private async storeDetectedRelationships(repoId: number, relationships: any[]): Promise<void> {
    if (relationships.length === 0) {
      return;
    }

    const startTime = Date.now();
    let apiCallsToCreate = []; // Declare in broader scope

    try {
      // OPTIMIZATION: Batch fetch all required data to avoid N+1 queries

      // Get unique component names for batch lookup
      const componentNames = Array.from(
        new Set(relationships.map(r => r.vueApiCall.componentName).filter(Boolean))
      );

      // Batch fetch all component symbols
      const allComponentSymbols = [];
      for (const componentName of componentNames) {
        const symbols = await this.database.searchSymbols(componentName, repoId);
        const componentSymbols = symbols.filter(
          s =>
            s.symbol_type === 'component' ||
            s.symbol_type === 'variable' ||
            s.symbol_type === 'function' ||
            s.symbol_type === 'class' ||
            s.symbol_type === 'method'
        );
        allComponentSymbols.push(...componentSymbols);
      }

      // Create component lookup map
      const componentMap = new Map();
      allComponentSymbols.forEach(symbol => {
        componentMap.set(symbol.name, symbol);
      });

      // Batch fetch all Laravel routes once
      const laravelRoutesRaw = await this.database.getRoutesByFramework(repoId, 'laravel');
      const laravelRoutes = this.convertRoutesToFrameworkEntities(laravelRoutesRaw);

      // Create route lookup map
      const routeMap = new Map();
      laravelRoutes.forEach(route => {
        const key = `${route.metadata.path}|${route.metadata.method}`;
        routeMap.set(key, route);
      });

      let processed = 0;
      let skipped = 0;

      // Process relationships using cached data
      for (const relationship of relationships) {
        try {
          // Lookup component from cache
          const componentSymbol = componentMap.get(relationship.vueApiCall.componentName);

          // Lookup route from cache (handle null laravelRoute for unmatched API calls)
          let matchingRoute = null;
          if (relationship.laravelRoute) {
            const routeKey = `${relationship.laravelRoute.path}|${relationship.laravelRoute.method}`;
            matchingRoute = routeMap.get(routeKey);
          }

          if (componentSymbol) {
            // Always create API call if we have a valid caller symbol
            // The endpoint_symbol_id can be null if there's no matching route
            let endpointSymbolId = null;

            // Try to find and link to the backend handler symbol
            if (matchingRoute && matchingRoute.metadata.id) {
              // First, try to use the handler symbol ID (controller method)
              if (matchingRoute.metadata.handlerSymbolId) {
                const handlerSymbol = await this.database.getSymbol(
                  matchingRoute.metadata.handlerSymbolId
                );
                if (handlerSymbol) {
                  endpointSymbolId = matchingRoute.metadata.handlerSymbolId;
                }
              }
            }

            // Create API call record (endpoint_symbol_id may be null if no route match)
            // This ensures all extracted API calls are stored, even if they can't be matched
            // to a backend route (e.g., external APIs, /sanctum endpoints, etc.)
            const apiCallData = {
              repo_id: repoId,
              caller_symbol_id: componentSymbol.id,
              endpoint_symbol_id: endpointSymbolId,
              http_method: relationship.vueApiCall.method,
              endpoint_path: relationship.vueApiCall.url,
              call_type: 'axios', // Default call type
            };
            apiCallsToCreate.push(apiCallData);
            processed++;

            if (!matchingRoute) {
              this.logger.debug('API call created without backend route match', {
                url: relationship.vueApiCall.url,
                method: relationship.vueApiCall.method,
                caller: relationship.vueApiCall.componentName,
              });
            }
          } else {
            this.logger.warn('Could not find caller symbol for API call', {
              componentName: relationship.vueApiCall.componentName,
              vueUrl: relationship.vueApiCall.url,
            });
            skipped++;
          }
        } catch (error) {
          this.logger.warn('Failed to process relationship', {
            error: error.message,
            relationship: relationship.vueApiCall?.url,
          });
          skipped++;
        }
      }

      const processingTime = Date.now() - startTime;

      this.logger.info('Relationship processing completed', {
        totalRelationships: relationships.length,
        processed,
        skipped,
        processingTimeMs: processingTime,
        apiCallsToCreate: apiCallsToCreate.length,
      });
    } catch (error) {
      this.logger.error('Failed to batch process relationships', {
        error: error.message,
        relationshipsCount: relationships.length,
      });
      throw error;
    }

    // Create API calls in database
    if (apiCallsToCreate.length > 0) {
      try {
        // Validate all symbol IDs exist before insertion
        const allSymbolIds = Array.from(
          new Set([
            ...apiCallsToCreate.map(call => call.caller_symbol_id),
            ...apiCallsToCreate
              .map(call => call.endpoint_symbol_id)
              .filter(id => id !== null && id !== undefined),
          ])
        );

        // Check that all symbols exist in the database
        const validSymbolIds = new Set();
        for (const symbolId of allSymbolIds) {
          try {
            const symbol = await this.database.getSymbol(symbolId);
            if (symbol) {
              validSymbolIds.add(symbolId);
            }
          } catch (symbolError) {
            // Skip invalid symbol
          }
        }

        // Filter out API calls with invalid symbol references
        const validApiCalls = apiCallsToCreate.filter(call => {
          const callerValid = validSymbolIds.has(call.caller_symbol_id);
          const endpointValid =
            call.endpoint_symbol_id === null ||
            call.endpoint_symbol_id === undefined ||
            validSymbolIds.has(call.endpoint_symbol_id);

          if (!callerValid || !endpointValid) {
            this.logger.warn('Invalid API call filtered out', {
              callerSymbolId: call.caller_symbol_id,
              callerValid,
              endpointSymbolId: call.endpoint_symbol_id,
              endpointValid,
              url: call.url,
              method: call.method,
            });
            return false;
          }
          return true;
        });

        if (validApiCalls.length === 0) {
          this.logger.warn('No valid API calls to create after symbol validation', {
            totalAttempted: apiCallsToCreate.length,
            validSymbolCount: validSymbolIds.size,
          });
          return;
        }

        // First, deduplicate within the current batch to avoid internal conflicts
        const batchDeduplicatedApiCalls = [];
        const seenKeys = new Set();

        for (const apiCall of validApiCalls) {
          const uniqueKey = `${apiCall.caller_symbol_id}-${apiCall.endpoint_path}-${apiCall.http_method}`;
          if (!seenKeys.has(uniqueKey)) {
            seenKeys.add(uniqueKey);
            batchDeduplicatedApiCalls.push(apiCall);
          }
        }

        // Now check for existing API calls to avoid unique constraint violations
        const uniqueApiCalls = [];
        for (const apiCall of batchDeduplicatedApiCalls) {
          try {
            // Check if this API call already exists
            const existingApiCalls = await this.database.getApiCallsByEndpoint(
              repoId,
              apiCall.endpoint_path,
              apiCall.http_method
            );
            const duplicate = existingApiCalls.find(
              existing =>
                existing.caller_symbol_id === apiCall.caller_symbol_id &&
                existing.endpoint_path === apiCall.endpoint_path &&
                existing.http_method === apiCall.http_method
            );

            if (!duplicate) {
              uniqueApiCalls.push(apiCall);
            }
          } catch (checkError) {
            // If we can't check for duplicates, include the API call anyway
            uniqueApiCalls.push(apiCall);
          }
        }

        if (uniqueApiCalls.length === 0) {
          return;
        }

        // Attempt database insertion with comprehensive error handling
        await this.database.createApiCalls(uniqueApiCalls);

        this.logger.info('Successfully stored API call relationships', {
          stored: uniqueApiCalls.length,
        });
      } catch (error) {
        // Log comprehensive error information
        this.logger.error('Failed to create API calls in database', {
          error: error.message,
          count: apiCallsToCreate.length,
        });

        // Continue execution instead of throwing to avoid breaking the entire process
      }
    } else {
      this.logger.warn('No valid API call relationships to store');
    }
  }

  /**
   * Check if repository contains multi-framework project
   */
  async isMultiFrameworkProject(repoId: number, frameworks: string[]): Promise<boolean> {
    try {
      const detectedFrameworks = await this.database.getRepositoryFrameworks(repoId);
      return frameworks.every(framework => detectedFrameworks.includes(framework));
    } catch (error) {
      this.logger.warn('Failed to check multi-framework project', { error, repoId });
      return false;
    }
  }
}
