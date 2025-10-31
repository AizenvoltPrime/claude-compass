/**
 * Type definitions for cross-stack graph builder
 */

import { DependencyType } from '../../database/models';

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
