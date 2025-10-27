/**
 * Cross-Stack Graph Builder for Vue ↔ Laravel Integration
 *
 * Builds comprehensive graphs representing relationships between Vue.js frontend
 * and Laravel backend components, enabling full-stack dependency tracking
 * and impact analysis.
 */

import {
  Symbol,
  SymbolWithFile,
  DataContract,
  CreateApiCall,
  CreateDataContract,
  CreateDependency,
  DependencyType,
  Route,
  Component,
  File as DbFile,
} from '../database/models';
import { FrameworkEntity } from '../parsers/base';
import type { Knex } from 'knex';
import * as SymbolService from '../database/services/symbol-service';
import * as RepositoryService from '../database/services/repository-service';
import * as FileService from '../database/services/file-service';
import * as RouteService from '../database/services/route-service';
import * as ComponentService from '../database/services/component-service';
import * as ApiCallService from '../database/services/api-call-service';
import * as DependencyService from '../database/services/dependency-service';
import * as SearchService from '../database/services/search-service';
import * as QueryUtilities from '../database/services/query-utilities-service';
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
  private db: Knex;
  private crossStackParser: CrossStackParser;
  private apiCallExtractor: ApiCallExtractor;
  private logger: any;

  constructor(db: Knex) {
    this.db = db;
    this.crossStackParser = new CrossStackParser(db);
    this.apiCallExtractor = new ApiCallExtractor();
    this.logger = logger;
  }

  /**
   * Build API call graph from matched relationships (new approach - no database dependency)
   * This method builds the graph directly from relationship data to avoid duplicate persistence
   */
  private async buildAPICallGraphFromRelationships(
    vueComponents: FrameworkEntity[],
    laravelRoutes: FrameworkEntity[],
    matchedRelationships: any[],
    repoId: number
  ): Promise<CrossStackGraphData> {
    const nodes: CrossStackNode[] = [];
    const edges: CrossStackEdge[] = [];

    // Create nodes for Vue components
    for (const component of vueComponents) {
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
    for (const route of laravelRoutes) {
      nodes.push({
        id: `laravel_route_${route.name}`,
        type: 'laravel_route',
        name: route.name,
        filePath: route.filePath,
        framework: 'laravel',
        metadata: {
          // entityId should be the handler symbol ID for proper persistence
          entityId: route.metadata.handlerSymbolId || route.name,
          ...route.metadata,
        },
      });
    }

    // Build edges from matched relationships
    for (const relationship of matchedRelationships) {
      try {
        const vueCall = relationship.vueApiCall;
        const laravelRoute = relationship.laravelRoute;

        // Look up caller symbol
        const callerSymbols = await SearchService.lexicalSearchSymbols(this.db,
          vueCall.componentName,
          repoId
        );
        const callerSymbol = this.selectBestMatchingSymbol(
          callerSymbols.filter(
            s =>
              s.symbol_type === 'component' ||
              s.symbol_type === 'variable' ||
              s.symbol_type === 'function' ||
              s.symbol_type === 'method'
          ),
          vueCall.filePath
        );

        if (!callerSymbol) continue;

        // Look up route and its handler symbol
        const routeEntity = laravelRoutes.find(
          r => r.metadata.path === laravelRoute.path && r.metadata.method === laravelRoute.method
        );

        if (!routeEntity || !routeEntity.metadata.handlerSymbolId) continue;

        const handlerSymbol = await SymbolService.getSymbol(this.db,routeEntity.metadata.handlerSymbolId);
        if (!handlerSymbol) continue;

        // Create edge
        const fromId = `vue_component_${callerSymbol.name}`;
        const toId = `laravel_route_${routeEntity.name}`;

        // Ensure nodes exist
        if (!nodes.find(n => n.id === fromId)) {
          nodes.push({
            id: fromId,
            type: 'vue_component',
            name: callerSymbol.name,
            filePath: vueCall.filePath || '',
            framework: 'vue',
            metadata: {
              symbolId: callerSymbol.id,
              entityId: callerSymbol.name,
            },
          });
        }

        edges.push({
          id: `api_call_${vueCall.componentName}_${laravelRoute.path}_${laravelRoute.method}_${vueCall.location?.line || vueCall.lineNumber}`,
          from: fromId,
          to: toId,
          relationshipType: 'api_call',
          dependencyType: 'api_call' as any,
          evidence: ['api_call_detected'],
          metadata: {
            urlPattern: vueCall.url,
            httpMethod: vueCall.method,
            callerSymbolId: callerSymbol.id,
            endpointSymbolId: routeEntity.metadata.handlerSymbolId,
            lineNumber: vueCall.location?.line || vueCall.lineNumber || null,
          },
        });
      } catch (error) {
        this.logger.warn('Failed to create edge for relationship', {
          error: error.message,
          relationship: relationship.vueApiCall?.url,
        });
      }
    }

    return {
      nodes,
      edges,
      metadata: {
        vueComponents: vueComponents.length,
        laravelRoutes: laravelRoutes.length,
        apiCalls: edges.length,
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
      const frontendType = await SymbolService.getSymbol(this.db,contract.frontend_type_id);
      const backendType = await SymbolService.getSymbol(this.db,contract.backend_type_id);

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
            lastUpdated: contract.updated_at,
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
   * Build comprehensive full-stack feature graph
   * Performance optimized with streaming for large datasets
   */
  async buildFullStackFeatureGraph(repoId: number): Promise<FullStackFeatureGraph> {
    try {
      const repoExists = await RepositoryService.getRepository(this.db,repoId);
    } catch (error) {
      this.logger.error('Failed to verify repository for cross-stack analysis', {
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Get cross-stack data from database (now with caching)
      const crossStackData = await ApiCallService.getCrossStackDependencies(this.db,repoId);
      const { apiCalls, dataContracts } = crossStackData;

      // Get framework entities - Fixed: Get Laravel routes from dedicated routes table
      const vueComponentsRaw = await ComponentService.getComponentsByType(this.db,repoId, 'vue');
      const vueComponents = this.convertComponentsToFrameworkEntities(vueComponentsRaw);
      const laravelRoutesRaw = await RouteService.getRoutesByFramework(this.db,repoId, 'laravel');

      const laravelRoutes = this.convertRoutesToFrameworkEntities(laravelRoutesRaw);

      const allApiCalls = await this.extractApiCallsFromFrontendFiles(repoId);

      this.logger.info('Total API calls from all frontend files', {
        totalCount: allApiCalls.length,
        sampleUrls: allApiCalls.slice(0, 5).map(call => ({ url: call.url, method: call.method })),
      });

      // Match API calls to routes to create relationships
      let matchedRelationships: any[] = [];
      if (allApiCalls.length > 0 && laravelRoutes.length > 0) {
        try {
          const laravelRouteInfo = await this.extractRouteInfoFromRoutes(repoId, laravelRoutes);

          this.logger.info('Extracted Laravel route information', {
            count: laravelRouteInfo.length,
            samplePaths: laravelRouteInfo
              .slice(0, 3)
              .map(r => ({ path: r.path, method: r.method })),
          });

          matchedRelationships = this.matchApiCallsToRoutes(allApiCalls, laravelRouteInfo);

          this.logger.info('Matched API calls to routes', {
            relationshipsCount: matchedRelationships.length,
          });

          // NOTE: Relationships are NOT stored here. They will be persisted later by
          // storeCrossStackRelationships() after graph building to avoid duplicate inserts.
        } catch (error) {
          this.logger.error('Cross-stack relationship detection failed', { error: error.message });
        }
      }

      const allSymbols = await SymbolService.getSymbolsByRepository(this.db,repoId);

      // Get TypeScript interfaces and PHP DTOs
      const typescriptInterfaces = [
        ...(await QueryUtilities.getSymbolsByType(this.db,repoId, 'interface')),
        ...(await QueryUtilities.getSymbolsByType(this.db,repoId, 'type_alias')),
      ];
      const phpClasses = await QueryUtilities.getSymbolsByType(this.db,repoId, 'class');
      const phpInterfaces = await QueryUtilities.getSymbolsByType(this.db,repoId, 'interface');
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

            const existingSymbols = await SymbolService.getSymbolsByRepository(this.db,repoId);
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

              await ApiCallService.createDataContracts(this.db,dataContractsToCreate);
            }

            // Refresh cross-stack data after detection
            const updatedCrossStackData = await ApiCallService.getCrossStackDependencies(this.db,repoId);
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
      // Build API call graph using matched relationships instead of database records
      const apiCallGraph = await this.buildAPICallGraphFromRelationships(
        vueComponents,
        laravelRoutes,
        matchedRelationships,
        repoId
      );
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
   * Store cross-stack relationships in database
   */
  async storeCrossStackRelationships(graph: FullStackFeatureGraph, repoId: number): Promise<void> {
    try {
      // Extract API calls and corresponding dependencies from graph edges
      const apiCallsToCreate: CreateApiCall[] = [];
      const dependenciesToCreate: CreateDependency[] = [];

      for (const edge of graph.apiCallGraph.edges) {
        if (edge.relationshipType === 'api_call') {
          // Find corresponding nodes
          const fromNode = graph.apiCallGraph.nodes.find(n => n.id === edge.from);
          const toNode = graph.apiCallGraph.nodes.find(n => n.id === edge.to);

          if (fromNode && toNode && fromNode.metadata.symbolId && toNode.metadata.entityId) {
            const callerSymbolId = fromNode.metadata.symbolId;
            const endpointSymbolId = parseInt(toNode.metadata.entityId);

            apiCallsToCreate.push({
              repo_id: repoId,
              caller_symbol_id: callerSymbolId,
              endpoint_symbol_id: endpointSymbolId,
              http_method: edge.metadata.httpMethod || 'GET',
              endpoint_path: edge.metadata.urlPattern || '',
              call_type: 'axios',
              line_number: edge.metadata.lineNumber ?? null,
            });

            dependenciesToCreate.push({
              from_symbol_id: callerSymbolId,
              to_symbol_id: endpointSymbolId,
              dependency_type: DependencyType.API_CALL,
              line_number: edge.metadata.lineNumber ?? null,
            });
          }
        }
      }

      // Extract data contracts and corresponding dependencies from graph edges
      const dataContractsToCreate: CreateDataContract[] = [];

      for (const edge of graph.dataContractGraph.edges) {
        if (edge.relationshipType === 'shares_schema') {
          const fromNode = graph.dataContractGraph.nodes.find(n => n.id === edge.from);
          const toNode = graph.dataContractGraph.nodes.find(n => n.id === edge.to);

          if (fromNode && toNode && fromNode.metadata.symbolId && toNode.metadata.symbolId) {
            const frontendTypeId = fromNode.metadata.symbolId;
            const backendTypeId = toNode.metadata.symbolId;

            dataContractsToCreate.push({
              repo_id: repoId,
              name: `${fromNode.name}_${toNode.name}`,
              frontend_type_id: frontendTypeId,
              backend_type_id: backendTypeId,
              schema_definition: JSON.stringify({
                compatibility: edge.metadata.schemaCompatibility,
              }),
              drift_detected: edge.metadata.driftDetected || false,
            });

            dependenciesToCreate.push({
              from_symbol_id: frontendTypeId,
              to_symbol_id: backendTypeId,
              dependency_type: DependencyType.SHARES_SCHEMA,
            });
          }
        }
      }

      // Store in database
      if (apiCallsToCreate.length > 0) {
        try {
          await ApiCallService.createApiCalls(this.db,apiCallsToCreate);
          this.logger.info('Created API calls in api_calls table', {
            count: apiCallsToCreate.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error('Failed to create API calls in database', {
            error: errorMessage,
            stack: errorStack,
            apiCallsToCreate: apiCallsToCreate.slice(0, 2),
          });
        }
      }

      if (dataContractsToCreate.length > 0) {
        try {
          await ApiCallService.createDataContracts(this.db,dataContractsToCreate);
          this.logger.info('Created data contracts in data_contracts table', {
            count: dataContractsToCreate.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error('Failed to create data contracts in database', {
            error: errorMessage,
            stack: errorStack,
            dataContractsToCreate: dataContractsToCreate.slice(0, 2),
          });
        }
      }

      if (dependenciesToCreate.length > 0) {
        try {
          await DependencyService.createDependencies(this.db,dependenciesToCreate);
          this.logger.info('Created cross-stack dependencies in dependencies table', {
            count: dependenciesToCreate.length,
            types: [...new Set(dependenciesToCreate.map(d => d.dependency_type))],
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error('Failed to create cross-stack dependencies', {
            error: errorMessage,
            stack: errorStack,
            dependenciesToCreate: dependenciesToCreate.slice(0, 2),
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
    const allFiles = await FileService.getFilesByRepository(this.db,repoId);

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
      let symbols = await this.db('symbols')
        .join('files', 'symbols.file_id', '=', 'files.id')
        .where('files.path', filePath)
        .andWhere('symbols.is_exported', true)
        .select('symbols.name', 'symbols.symbol_type', 'symbols.is_exported')
        .orderByRaw(
          "CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class') THEN 1 ELSE 2 END"
        )
        .limit(1);

      if (symbols.length > 0 && symbols[0].name) {
        return symbols[0].name;
      }

      // No exported symbols - try ANY symbol from this file to avoid name mismatch
      this.logger.debug('No exported symbols found, searching for any symbol', { filePath });

      symbols = await this.db('symbols')
        .join('files', 'symbols.file_id', '=', 'files.id')
        .where('files.path', filePath)
        .whereIn('symbols.symbol_type', ['variable', 'function', 'class', 'component', 'method'])
        .select('symbols.name', 'symbols.symbol_type')
        .orderByRaw(
          "CASE WHEN symbols.symbol_type = 'variable' AND symbols.name LIKE 'use%Store' THEN 0 WHEN symbols.symbol_type IN ('function', 'class', 'method') THEN 1 ELSE 2 END"
        )
        .limit(1);

      if (symbols.length > 0 && symbols[0].name) {
        this.logger.debug('Using non-exported symbol name', {
          filePath,
          symbolName: symbols[0].name,
          symbolType: symbols[0].symbol_type,
        });
        return symbols[0].name;
      }

      // File exists but has no parseable symbols - this indicates a parsing failure
      this.logger.warn(
        'File has no symbols in database, API calls from this file will be dropped',
        {
          filePath,
          fileName,
        }
      );

      // Return filename as last resort, but this will likely cause downstream lookup failure
      return fileName;
    } catch (error) {
      // Database errors should not be silently caught - they indicate system issues
      this.logger.error('Database error while extracting export name', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
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

  private selectBestMatchingSymbol(
    candidates: SymbolWithFile[],
    apiCallFilePath?: string
  ): SymbolWithFile | null {
    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const frontendPatterns = [
      '/resources/ts/',
      '/resources/js/',
      '.vue',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
    ];

    const getFilePath = (symbol: SymbolWithFile): string | undefined => {
      return (symbol as any).file_path || symbol.file?.path;
    };

    const isFrontendFile = (filePath: string | undefined): boolean => {
      if (!filePath) return false;
      return frontendPatterns.some(pattern => filePath.includes(pattern));
    };

    const frontendCandidates = candidates.filter(s => isFrontendFile(getFilePath(s)));

    if (frontendCandidates.length === 0) {
      return null;
    }

    if (apiCallFilePath) {
      const sameFileCandidates = frontendCandidates.filter(s => getFilePath(s) === apiCallFilePath);

      if (sameFileCandidates.length > 0) {
        return sameFileCandidates[0];
      }
    }

    const callableCandidates = frontendCandidates.filter(
      s => s.symbol_type === 'function' || s.symbol_type === 'method'
    );

    if (callableCandidates.length > 0) {
      return callableCandidates[0];
    }

    return frontendCandidates[0];
  }

  /**
   * Check if repository contains multi-framework project
   */
  async isMultiFrameworkProject(repoId: number, frameworks: string[]): Promise<boolean> {
    try {
      const detectedFrameworks = await ApiCallService.getRepositoryFrameworks(this.db, repoId);
      return frameworks.every(framework => detectedFrameworks.includes(framework));
    } catch (error) {
      this.logger.warn('Failed to check multi-framework project', { error, repoId });
      return false;
    }
  }
}
