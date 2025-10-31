import { Repository } from '../../database/models';
import { FileSizePolicy } from '../../config/file-size-policy';
import { FileGraphData } from '../file-graph';
import { SymbolGraphData } from '../symbol-graph/';

/**
 * Type definitions for GraphBuilder
 * Core interfaces and types used across builder modules
 */

export interface BuildOptions {
  includeTestFiles?: boolean;
  includeNodeModules?: boolean;
  maxFiles?: number;
  fileExtensions?: string[];

  fileSizePolicy?: FileSizePolicy;
  chunkOverlapLines?: number;
  encodingFallback?: string;
  compassignorePath?: string;
  enableParallelParsing?: boolean;
  maxConcurrency?: number;
  skipEmbeddings?: boolean;
  forceFullAnalysis?: boolean;

  // Phase 5 - Cross-stack analysis options
  enableCrossStackAnalysis?: boolean;
  detectFrameworks?: boolean;
  verbose?: boolean;

  /** Eloquent relationship registry shared across repository for semantic analysis */
  eloquentRelationshipRegistry?: Map<string, Map<string, string>>;
}

export interface BuildResult {
  repository: Repository;
  filesProcessed: number;
  symbolsExtracted: number;
  dependenciesCreated: number;
  fileGraph: FileGraphData;
  symbolGraph: SymbolGraphData;
  errors: BuildError[];

  // Phase 5 - Cross-stack analysis results
  crossStackGraph?: CrossStackGraphData;
  totalFiles?: number;
  totalSymbols?: number;
}

export interface BuildError {
  filePath: string;
  message: string;
  stack?: string;
}

// Cross-stack graph data structure for Phase 5
export interface CrossStackGraphData {
  apiCallGraph?: {
    nodes: CrossStackGraphNode[];
    edges: CrossStackGraphEdge[];
    metadata: {
      vueComponents: number;
      laravelRoutes: number;
      apiCalls: number;
      vueApiCalls?: number;
      typescriptApiCalls?: number;
      backendEndpoints?: number;
      dataContracts: number;
    };
  };
  dataContractGraph?: {
    nodes: CrossStackGraphNode[];
    edges: CrossStackGraphEdge[];
    metadata: {
      vueComponents: number;
      laravelRoutes: number;
      apiCalls: number;
      vueApiCalls?: number;
      typescriptApiCalls?: number;
      backendEndpoints?: number;
      dataContracts: number;
    };
  };
  features?: CrossStackFeature[];
  metadata?: {
    totalApiCalls?: number;
    totalDataContracts?: number;
    analysisTimestamp?: Date;
  };
}

export interface CrossStackGraphNode {
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
  symbolId?: number;
}

export interface CrossStackGraphEdge {
  id: string;
  from: string;
  to: string;
  type: 'api_call' | 'shares_schema' | 'frontend_backend';
  metadata?: Record<string, any>;
}

export interface CrossStackFeature {
  id: string;
  name: string;
  description?: string;
  components: CrossStackGraphNode[];
  apiCalls: any[]; // ApiCall type from database models
  dataContracts: any[]; // DataContract type from database models
}
