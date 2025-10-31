/**
 * Cross-Stack Graph Builder for Vue ↔ Laravel Integration
 *
 * Builds comprehensive graphs representing relationships between Vue.js frontend
 * and Laravel backend components, enabling full-stack dependency tracking
 * and impact analysis.
 */

import type { Knex } from 'knex';
import {
  CreateApiCall,
  CreateDataContract,
  CreateDependency,
  DependencyType,
} from '../../database/models';
import * as SymbolService from '../../database/services/symbol-service';
import * as RepositoryService from '../../database/services/repository-service';
import * as ComponentService from '../../database/services/component-service';
import * as RouteService from '../../database/services/route-service';
import * as ApiCallService from '../../database/services/api-call-service';
import * as DependencyService from '../../database/services/dependency-service';
import * as QueryUtilities from '../../database/services/query-utilities-service';
import { ApiCallExtractor } from '../../parsers/utils/api-call-extractor';
import { createComponentLogger } from '../../utils/logger';
import { FullStackFeatureGraph } from './types';
import {
  convertRoutesToFrameworkEntities,
  convertComponentsToFrameworkEntities,
} from './entity-converters';
import { extractApiCallsFromFrontendFiles } from './api-call-extraction';
import { extractRouteInfoFromRoutes, matchApiCallsToRoutes } from './route-matching';
import { detectDataContractMatches } from './data-contract-detection';
import { identifyFeatureClusters } from './feature-clustering';
import { buildAPICallGraphFromRelationships, buildDataContractGraph } from './graph-builders';

const logger = createComponentLogger('cross-stack-builder');

/**
 * Cross-stack graph builder implementation
 */
export class CrossStackGraphBuilder {
  private db: Knex;
  private apiCallExtractor: ApiCallExtractor;
  private logger: any;

  constructor(db: Knex) {
    this.db = db;
    this.apiCallExtractor = new ApiCallExtractor();
    this.logger = logger;
  }

  /**
   * Build comprehensive full-stack feature graph
   * Performance optimized with streaming for large datasets
   */
  async buildFullStackFeatureGraph(repoId: number): Promise<FullStackFeatureGraph> {
    try {
      const repoExists = await RepositoryService.getRepository(this.db, repoId);
    } catch (error) {
      this.logger.error('Failed to verify repository for cross-stack analysis', {
        repoId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const crossStackData = await ApiCallService.getCrossStackDependencies(this.db, repoId);
      const { apiCalls, dataContracts } = crossStackData;

      const vueComponentsRaw = await ComponentService.getComponentsByType(this.db, repoId, 'vue');
      const vueComponents = convertComponentsToFrameworkEntities(vueComponentsRaw);
      const laravelRoutesRaw = await RouteService.getRoutesByFramework(this.db, repoId, 'laravel');

      const laravelRoutes = convertRoutesToFrameworkEntities(laravelRoutesRaw);

      const allApiCalls = await extractApiCallsFromFrontendFiles(
        this.db,
        repoId,
        this.apiCallExtractor
      );

      this.logger.info('Total API calls from all frontend files', {
        totalCount: allApiCalls.length,
        sampleUrls: allApiCalls.slice(0, 5).map(call => ({ url: call.url, method: call.method })),
      });

      let matchedRelationships: any[] = [];
      if (allApiCalls.length > 0 && laravelRoutes.length > 0) {
        try {
          const laravelRouteInfo = await extractRouteInfoFromRoutes(repoId, laravelRoutes);

          this.logger.info('Extracted Laravel route information', {
            count: laravelRouteInfo.length,
            samplePaths: laravelRouteInfo
              .slice(0, 3)
              .map(r => ({ path: r.path, method: r.method })),
          });

          matchedRelationships = matchApiCallsToRoutes(allApiCalls, laravelRouteInfo);

          this.logger.info('Matched API calls to routes', {
            relationshipsCount: matchedRelationships.length,
          });
        } catch (error) {
          this.logger.error('Cross-stack relationship detection failed', { error: error.message });
        }
      }

      const allSymbols = await SymbolService.getSymbolsByRepository(this.db, repoId);

      const typescriptInterfaces = [
        ...(await QueryUtilities.getSymbolsByType(this.db, repoId, 'interface')),
        ...(await QueryUtilities.getSymbolsByType(this.db, repoId, 'type_alias')),
      ];
      const phpClasses = await QueryUtilities.getSymbolsByType(this.db, repoId, 'class');
      const phpInterfaces = await QueryUtilities.getSymbolsByType(this.db, repoId, 'interface');
      const phpDtos = [...phpClasses, ...phpInterfaces];

      if (typescriptInterfaces.length > 0 && phpDtos.length > 0) {
        try {
          const dataContractMatches = detectDataContractMatches(typescriptInterfaces, phpDtos);

          if (dataContractMatches.length > 0) {
            const allSymbolIds = [
              ...new Set([
                ...dataContractMatches.map(m => m.typescriptInterface.id),
                ...dataContractMatches.map(m => m.phpDto.id),
              ]),
            ];

            const existingSymbols = await SymbolService.getSymbolsByRepository(this.db, repoId);
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

              await ApiCallService.createDataContracts(this.db, dataContractsToCreate);
            }

            const updatedCrossStackData = await ApiCallService.getCrossStackDependencies(
              this.db,
              repoId
            );
            dataContracts.push(...updatedCrossStackData.dataContracts);
          }
        } catch (error) {
          this.logger.error('Data contract detection failed', {
            error: error instanceof Error ? error.message : String(error),
            errorType: typeof error,
            typescriptInterfaces: typescriptInterfaces.length,
            phpDtos: phpDtos.length,
          });
        }
      }

      const apiCallGraph = await buildAPICallGraphFromRelationships(
        this.db,
        vueComponents,
        laravelRoutes,
        matchedRelationships,
        repoId
      );
      const dataContractGraph = await buildDataContractGraph(
        this.db,
        typescriptInterfaces,
        phpDtos,
        dataContracts
      );

      const features = identifyFeatureClusters(apiCallGraph, dataContractGraph);

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
  async storeCrossStackRelationships(
    graph: FullStackFeatureGraph,
    repoId: number
  ): Promise<void> {
    try {
      const apiCallsToCreate: CreateApiCall[] = [];
      const dependenciesToCreate: CreateDependency[] = [];

      for (const edge of graph.apiCallGraph.edges) {
        if (edge.relationshipType === 'api_call') {
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

      if (apiCallsToCreate.length > 0) {
        try {
          await ApiCallService.createApiCalls(this.db, apiCallsToCreate);
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
          await ApiCallService.createDataContracts(this.db, dataContractsToCreate);
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
          await DependencyService.createDependencies(this.db, dependenciesToCreate);
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
}
