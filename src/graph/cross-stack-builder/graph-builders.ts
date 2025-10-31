/**
 * Graph building utilities for cross-stack relationships
 */

import type { Knex } from 'knex';
import { Symbol, DataContract, DependencyType } from '../../database/models';
import { FrameworkEntity } from '../../parsers/base';
import { CrossStackGraphData, CrossStackNode, CrossStackEdge } from './types';
import { selectBestMatchingSymbol } from './symbol-selection';
import * as SymbolService from '../../database/services/symbol-service';
import * as SearchService from '../../database/services/search-service';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('graph-builders');

/**
 * Build API call graph from matched relationships
 */
export async function buildAPICallGraphFromRelationships(
  db: Knex,
  vueComponents: FrameworkEntity[],
  laravelRoutes: FrameworkEntity[],
  matchedRelationships: any[],
  repoId: number
): Promise<CrossStackGraphData> {
  const nodes: CrossStackNode[] = [];
  const edges: CrossStackEdge[] = [];

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

  for (const route of laravelRoutes) {
    nodes.push({
      id: `laravel_route_${route.name}`,
      type: 'laravel_route',
      name: route.name,
      filePath: route.filePath,
      framework: 'laravel',
      metadata: {
        entityId: route.metadata.handlerSymbolId || route.name,
        ...route.metadata,
      },
    });
  }

  for (const relationship of matchedRelationships) {
    try {
      const vueCall = relationship.vueApiCall;
      const laravelRoute = relationship.laravelRoute;

      const callerSymbols = await SearchService.lexicalSearchSymbols(
        db,
        vueCall.componentName,
        repoId
      );
      const callerSymbol = selectBestMatchingSymbol(
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

      const routeEntity = laravelRoutes.find(
        r => r.metadata.path === laravelRoute.path && r.metadata.method === laravelRoute.method
      );

      if (!routeEntity || !routeEntity.metadata.handlerSymbolId) continue;

      const handlerSymbol = await SymbolService.getSymbol(db, routeEntity.metadata.handlerSymbolId);
      if (!handlerSymbol) continue;

      const fromId = `vue_component_${callerSymbol.name}`;
      const toId = `laravel_route_${routeEntity.name}`;

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
      logger.warn('Failed to create edge for relationship', {
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
export async function buildDataContractGraph(
  db: Knex,
  typescriptInterfaces: Symbol[],
  phpDtos: Symbol[],
  dataContracts: DataContract[]
): Promise<CrossStackGraphData> {
  const safeTypescriptInterfaces = typescriptInterfaces || [];
  const safePhpDtos = phpDtos || [];
  const safeDataContracts = dataContracts || [];

  const nodes: CrossStackNode[] = [];
  const edges: CrossStackEdge[] = [];

  for (const tsInterface of safeTypescriptInterfaces) {
    nodes.push({
      id: `ts_interface_${tsInterface.id}`,
      type: 'typescript_interface',
      name: tsInterface.name,
      filePath: `file_id_${tsInterface.file_id}`,
      framework: 'vue',
      metadata: {
        symbolId: tsInterface.id,
        symbolType: tsInterface.symbol_type,
        fileId: tsInterface.file_id,
      },
    });
  }

  for (const phpDto of safePhpDtos) {
    nodes.push({
      id: `php_dto_${phpDto.id}`,
      type: 'php_dto',
      name: phpDto.name,
      filePath: `file_id_${phpDto.file_id}`,
      framework: 'laravel',
      metadata: {
        symbolId: phpDto.id,
        symbolType: phpDto.symbol_type,
        fileId: phpDto.file_id,
      },
    });
  }

  for (const contract of safeDataContracts) {
    const frontendType = await SymbolService.getSymbol(db, contract.frontend_type_id);
    const backendType = await SymbolService.getSymbol(db, contract.backend_type_id);

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
