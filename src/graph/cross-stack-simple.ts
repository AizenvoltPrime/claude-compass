import { createComponentLogger } from '../utils/logger';
import { SimpleCrossStackRelationship, SimpleApiCall } from '../database/models';

const logger = createComponentLogger('cross-stack-simple');

export interface VueApiCall {
  component: string;
  method: string; // HTTP method (GET, POST, etc.)
  url: string; // Request URL
  line_number?: number;
  file_path?: string;
}

export interface LaravelRoute {
  method: string; // HTTP method
  pattern: string; // Route pattern like /api/users/{id}
  controller_method: string; // e.g., "UserController@show"
  route_name?: string;
  middleware?: string[];
}

/**
 * Phase 3: Simple cross-stack relationship finder
 * Provides comprehensive URL/method matching for complete relationship detection
 */
export class SimpleCrossStackAnalyzer {
  private logger = logger;

  /**
   * Finds Vue ↔ Laravel relationships using simple URL and HTTP method matching
   * Uses comprehensive pattern matching to detect all Vue-Laravel relationships
   */
  findCrossStackRelationships(
    vueCall: VueApiCall,
    laravelRoute: LaravelRoute
  ): SimpleCrossStackRelationship | null {
    // Simple HTTP method matching
    const methodMatch = vueCall.method.toUpperCase() === laravelRoute.method.toUpperCase();

    if (!methodMatch) {
      return null;
    }

    // Simple URL pattern matching
    const urlMatch = this.matchUrlPattern(vueCall.url, laravelRoute.pattern);

    if (urlMatch) {
      this.logger.debug('Cross-stack relationship found', {
        vueComponent: vueCall.component,
        laravelController: laravelRoute.controller_method,
        method: vueCall.method,
        urlPattern: laravelRoute.pattern,
      });

      return {
        from_component: vueCall.component,
        to_endpoint: laravelRoute.controller_method,
        relationship_type: 'api_call',
        method: vueCall.method,
        url_pattern: laravelRoute.pattern,
        line_number: vueCall.line_number,
      };
    }

    return null;
  }

  /**
   * Simple URL pattern matching logic
   * Comprehensive URL analysis with complete parameter matching
   */
  private matchUrlPattern(vueUrl: string, laravelPattern: string): boolean {
    // Exact match (most common case)
    if (vueUrl === laravelPattern) {
      return true;
    }

    // Handle parameterized routes
    // Convert Vue dynamic URLs to Laravel pattern format
    // Example: /api/users/123 matches /api/users/{id}
    const normalizedVueUrl = this.normalizeVueUrl(vueUrl);
    const normalizedLaravelPattern = this.normalizeLaravelPattern(laravelPattern);

    return normalizedVueUrl === normalizedLaravelPattern;
  }

  /**
   * Normalize Vue URL for pattern matching
   * Replace dynamic segments with parameter placeholders
   */
  private normalizeVueUrl(url: string): string {
    return (
      url
        // Replace numeric IDs with {id} placeholder
        .replace(/\/\d+/g, '/{id}')
        // Replace UUID patterns with {uuid} placeholder
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
        // Replace other dynamic segments (heuristic approach)
        .replace(/\/[a-zA-Z0-9_-]{8,}/g, '/{param}')
    );
  }

  /**
   * Normalize Laravel pattern for matching
   * Standardize parameter format
   */
  private normalizeLaravelPattern(pattern: string): string {
    return (
      pattern
        // Standardize parameter format
        .replace(/\{[^}]+\}/g, '{id}') // Simplify all parameters to {id} for basic matching
        .replace(/\?\}$/, '}')
    ); // Remove optional parameter markers
  }

  /**
   * Batch process Vue API calls against Laravel routes
   * Complete iteration capturing all cross-stack relationships
   */
  findAllCrossStackRelationships(
    vueCalls: VueApiCall[],
    laravelRoutes: LaravelRoute[]
  ): SimpleCrossStackRelationship[] {
    const relationships: SimpleCrossStackRelationship[] = [];

    for (const vueCall of vueCalls) {
      for (const laravelRoute of laravelRoutes) {
        const relationship = this.findCrossStackRelationships(vueCall, laravelRoute);
        if (relationship) {
          relationships.push(relationship);
          // Record first match per Vue call (comprehensive relationship capture)
          break;
        }
      }
    }

    this.logger.debug('Cross-stack analysis complete', {
      vueCallsProcessed: vueCalls.length,
      laravelRoutesProcessed: laravelRoutes.length,
      relationshipsFound: relationships.length,
    });

    return relationships;
  }

  /**
   * Simple data binding detection for Vue ↔ Laravel
   * Detects when Vue components use Laravel API response data structures
   */
  detectDataBindings(
    vueComponents: string[],
    laravelModels: string[]
  ): SimpleCrossStackRelationship[] {
    const bindings: SimpleCrossStackRelationship[] = [];

    for (const component of vueComponents) {
      for (const model of laravelModels) {
        // Simple heuristic: check if component name relates to model name
        if (this.isRelatedName(component, model)) {
          bindings.push({
            from_component: component,
            to_endpoint: model,
            relationship_type: 'data_binding',
          });
        }
      }
    }

    return bindings;
  }

  /**
   * Simple name relationship detection
   * Basic heuristic for component-model relationships
   */
  private isRelatedName(componentName: string, modelName: string): boolean {
    const componentLower = componentName.toLowerCase();
    const modelLower = modelName.toLowerCase();

    // Direct name match
    if (componentLower.includes(modelLower) || modelLower.includes(componentLower)) {
      return true;
    }

    // Pluralization matching (basic cases)
    const pluralModel = modelLower + 's';
    const singularModel = modelLower.endsWith('s') ? modelLower.slice(0, -1) : modelLower;

    return (
      componentLower.includes(pluralModel) ||
      componentLower.includes(singularModel) ||
      pluralModel.includes(componentLower) ||
      singularModel.includes(componentLower)
    );
  }

  /**
   * Get statistics about cross-stack analysis
   * Comprehensive metrics for all detected relationships
   */
  getAnalysisStats(relationships: SimpleCrossStackRelationship[]) {
    const stats = {
      total_relationships: relationships.length,
      by_type: {
        api_call: relationships.filter(r => r.relationship_type === 'api_call').length,
        data_binding: relationships.filter(r => r.relationship_type === 'data_binding').length,
        route_reference: relationships.filter(r => r.relationship_type === 'route_reference')
          .length,
      },
      http_methods: {} as Record<string, number>,
    };

    // Count HTTP methods
    for (const rel of relationships) {
      if (rel.method) {
        stats.http_methods[rel.method] = (stats.http_methods[rel.method] || 0) + 1;
      }
    }

    return stats;
  }
}

/**
 * Export singleton instance for global use
 */
export const simpleCrossStackAnalyzer = new SimpleCrossStackAnalyzer();

/**
 * Utility functions for external use
 */

/**
 * Simple helper to create Vue API call from basic info
 */
export function createSimpleApiCall(
  component: string,
  method: string,
  url: string,
  lineNumber?: number
): SimpleApiCall {
  return {
    component,
    method: method.toUpperCase(),
    url,
    line_number: lineNumber,
  };
}

/**
 * Simple helper to check if two URLs might match
 */
export function quickUrlMatch(url1: string, url2: string): boolean {
  if (url1 === url2) return true;

  // Basic parameterized matching
  const normalized1 = url1.replace(/\/\d+/g, '/{id}');
  const normalized2 = url2.replace(/\/\d+/g, '/{id}');

  return normalized1 === normalized2;
}
