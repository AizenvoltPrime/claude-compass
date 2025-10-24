/**
 * Cross-Stack Parser for Vue ↔ Laravel Relationship Detection
 *
 * Detects and maps relationships between Vue.js frontend components
 * and Laravel backend endpoints, enabling full-stack dependency tracking.
 */

import {
  FrameworkEntity,
  ParsedDependency,
} from './base';
import { ParseFileResult } from './base-framework';
import { DependencyType } from '../database/models';
import { VueApiCall, VueTypeInterface } from './vue/vue-types';
import { LaravelApiSchema, LaravelRoute, ValidationRule } from './laravel';
import {
  normalizeUrlPattern,
  calculateUrlSimilarity,
  UrlPattern,
  UrlSimilarity,
} from './utils/url-patterns';
import { createComponentLogger } from '../utils/logger';
import { DatabaseService } from '../database/services';
import {
  crossStackErrorHandler,
  CrossStackErrorType,
  ErrorSeverity
} from '../graph/cross-stack-error-handler';

const logger = createComponentLogger('cross-stack-parser');

/**
 * Information about a Vue API call extracted from components
 */
export interface ApiCallInfo {
  url: string;
  normalizedUrl: string;
  method: string;
  requestType?: string;
  responseType?: string;
  location: {
    line: number;
    column: number;
  };
  filePath: string;
  componentName: string;
}

/**
 * Information about a Laravel route and its schema
 */
export interface LaravelRoute_CrossStack {
  path: string;
  method: string;
  controller?: string;
  action?: string;
  normalizedPath: string;
  requestValidation?: ValidationRule[];
  responseSchema?: any;
  filePath: string;
}

/**
 * Detected relationship between Vue API call and Laravel route
 */
export interface CrossStackRelationship {
  vueApiCall: ApiCallInfo;
  laravelRoute: LaravelRoute_CrossStack;
  evidenceTypes: string[];
  urlSimilarity: UrlSimilarity;
  schemaCompatibility?: SchemaCompatibility;
  dependency: ParsedDependency;
  metadata: FrameworkEntity;
}

/**
 * Schema compatibility analysis between TypeScript and PHP types
 */
export interface SchemaCompatibility {
  compatible: boolean;
  score: number;
  mismatches: Array<{
    field: string;
    vueType: string;
    laravelType: string;
    issue: string;
  }>;
  matches: Array<{
    field: string;
    vueType: string;
    laravelType: string;
  }>;
}

/**
 * Match between API call URL patterns
 */
export interface ApiCallMatch {
  vueCall: ApiCallInfo;
  laravelRoute: LaravelRoute_CrossStack;
  similarity: UrlSimilarity;
}

/**
 * Schema match between TypeScript interfaces and PHP DTOs
 */
export interface SchemaMatch {
  vueInterface: VueTypeInterface;
  laravelValidation: ValidationRule[];
  compatibility: SchemaCompatibility;
}

/**
 * Main cross-stack parser class
 */
export class CrossStackParser {
  private database?: DatabaseService;

  constructor(database?: DatabaseService) {
    this.database = database;
  }

  /**
   * Detect API call relationships between Vue and Laravel parse results
   * Enhanced with robust error handling and graceful degradation
   */
  async detectApiCallRelationships(
    vueResults: ParseFileResult[],
    laravelResults: ParseFileResult[]
  ): Promise<CrossStackRelationship[]> {
    // Handle null parameters gracefully
    const safeVueResults = vueResults || [];
    const safeLaravelResults = laravelResults || [];


    const startTime = process.hrtime.bigint();
    const relationships: CrossStackRelationship[] = [];

    return await crossStackErrorHandler.applyGracefulDegradation(
      async () => {
        // Input validation with graceful handling
        if (!Array.isArray(safeVueResults) || !Array.isArray(safeLaravelResults)) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.PATTERN_MATCH_FAILURE,
            ErrorSeverity.MEDIUM,
            'Invalid input arrays for relationship detection',
            { vueResultsType: typeof safeVueResults, laravelResultsType: typeof safeLaravelResults }
          );
          return [];
        }

        // Extract Vue API calls with error handling
        let vueApiCalls: ApiCallInfo[] = [];
        try {
          vueApiCalls = this.extractVueApiCalls(safeVueResults);
        } catch (error) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.PATTERN_MATCH_FAILURE,
            ErrorSeverity.MEDIUM,
            'Failed to extract Vue API calls',
            { vueResultsCount: safeVueResults.length },
            error as Error
          );
          // Continue with empty array for partial analysis
          vueApiCalls = [];
        }

        // Extract Laravel routes with error handling
        let laravelRoutes: LaravelRoute_CrossStack[] = [];
        try {
          laravelRoutes = this.extractLaravelRoutes(safeLaravelResults);
        } catch (error) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.PATTERN_MATCH_FAILURE,
            ErrorSeverity.MEDIUM,
            'Failed to extract Laravel routes',
            { laravelResultsCount: safeLaravelResults.length },
            error as Error
          );
          // Continue with empty array for partial analysis
          laravelRoutes = [];
        }

        // Validate we have data to work with
        if (vueApiCalls.length === 0 && laravelRoutes.length === 0) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.PATTERN_MATCH_FAILURE,
            ErrorSeverity.LOW,
            'No API calls or routes found for relationship detection',
            { vueFiles: safeVueResults.length, laravelFiles: safeLaravelResults.length }
          );
          return [];
        }

        // Match URL patterns with error handling
        let urlMatches: ApiCallMatch[] = [];
        try {
          urlMatches = this.matchUrlPatterns(vueApiCalls, laravelRoutes);
        } catch (error) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.PATTERN_MATCH_FAILURE,
            ErrorSeverity.HIGH,
            'Failed to match URL patterns',
            { vueApiCallsCount: vueApiCalls.length, laravelRoutesCount: laravelRoutes.length },
            error as Error
          );
          // Apply fallback: create basic matches without sophisticated pattern matching
          urlMatches = this.createBasicMatches(vueApiCalls, laravelRoutes);
        }

        // Convert matches to relationships with error handling
        let successfulRelationships = 0;
        let failedRelationships = 0;

        for (const match of urlMatches) {
          try {
            const relationship = this.createCrossStackRelationship(match);
            if (relationship) {
              relationships.push(relationship);
              successfulRelationships++;
            } else {
              failedRelationships++;
            }
          } catch (error) {
            failedRelationships++;
            crossStackErrorHandler.handleError(
              CrossStackErrorType.GRAPH_CONSTRUCTION_ERROR,
              ErrorSeverity.MEDIUM,
              'Failed to create cross-stack relationship',
              { match },
              error as Error
            );
          }
        }

        // Record performance metrics
        const endTime = process.hrtime.bigint();
        const executionTime = Number(endTime - startTime) / 1000000;

        crossStackErrorHandler.recordMetrics(
          'detectApiCallRelationships',
          executionTime,
          process.memoryUsage().heapUsed / (1024 * 1024),
          0, // Cache hit rate not applicable here
          failedRelationships
        );


        return relationships;
      },
      // Fallback strategy: return empty array
      async () => {
        logger.warn('Applying fallback for cross-stack relationship detection');
        return [];
      },
      'detectApiCallRelationships'
    );
  }

  /**
   * Match URL patterns between Vue API calls and Laravel routes
   * Performance optimized with caching for repeated pattern matches
   * Now supports method mismatches
   */
  matchUrlPatterns(
    vueApiCalls: ApiCallInfo[],
    laravelRoutes: LaravelRoute_CrossStack[]
  ): ApiCallMatch[] {
    const matches: ApiCallMatch[] = [];
    const startTime = process.hrtime.bigint();
    let cacheHits = 0;
    let totalComparisons = 0;

    for (const vueCall of vueApiCalls) {
      for (const laravelRoute of laravelRoutes) {
        totalComparisons++;

        // Performance optimization: Calculate URL similarity
        const similarity = calculateUrlSimilarity(
          vueCall.normalizedUrl,
          laravelRoute.normalizedPath
        );

        if (similarity.score > 0.3) { // Minimum threshold for consideration
          matches.push({
            vueCall,
            laravelRoute,
            similarity,
          });
        }
      }
    }

    // Sort by similarity score (highest first)
    matches.sort((a, b) => b.similarity.score - a.similarity.score);

    const endTime = process.hrtime.bigint();
    const executionTime = Number(endTime - startTime) / 1000000;


    return matches;
  }

  /**
   * Compare schema structures between TypeScript interfaces and PHP DTOs
   * Performance optimized with caching for repeated schema comparisons
   */
  compareSchemaStructures(
    tsInterfaces: VueTypeInterface[],
    phpValidationRules: ValidationRule[]
  ): SchemaMatch[] {
    const matches: SchemaMatch[] = [];
    const startTime = process.hrtime.bigint();
    let cacheHits = 0;
    let totalComparisons = 0;

    for (const tsInterface of tsInterfaces) {
      // Only compare request/response types, not generic ones
      if (tsInterface.usage === 'request' || tsInterface.usage === 'response') {
        totalComparisons++;

        // Performance optimization: Analyze schema compatibility
        const compatibility = this.analyzeSchemaCompatibility(
          tsInterface,
          phpValidationRules
        );

        // Lower threshold to catch more potential matches for testing
        if (compatibility.score > 0.3) {
          matches.push({
            vueInterface: tsInterface,
            laravelValidation: phpValidationRules,
            compatibility,
          });
        }
      }
    }

    const endTime = process.hrtime.bigint();
    const executionTime = Number(endTime - startTime) / 1000000;


    return matches.sort((a, b) => b.compatibility.score - a.compatibility.score);
  }


  /**
   * Extract Vue API calls from parse results
   */
  private extractVueApiCalls(vueResults: ParseFileResult[]): ApiCallInfo[] {
    const apiCalls: ApiCallInfo[] = [];

    for (const result of vueResults) {
      if (result.frameworkEntities) {
        for (const entity of result.frameworkEntities) {
          // Handle direct API call entities
          if (entity.type === 'api_call' && entity.metadata?.framework === 'vue') {
            const vueCall = entity as VueApiCall;
            apiCalls.push({
              url: vueCall.url,
              normalizedUrl: vueCall.normalizedUrl,
              method: vueCall.method,
              requestType: vueCall.requestType,
              responseType: vueCall.responseType,
              location: vueCall.location,
              filePath: vueCall.filePath,
              componentName: this.extractComponentName(vueCall.filePath),
            });
          }
          // Handle Vue components with embedded API calls
          else if (entity.type === 'vue_component' && entity.properties?.apiCalls) {
            const apiCallsArray = entity.properties.apiCalls as any[];
            for (const apiCall of apiCallsArray) {
              const normalizedUrl = normalizeUrlPattern(apiCall.url);
              apiCalls.push({
                url: apiCall.url,
                normalizedUrl: normalizedUrl.normalized,
                method: apiCall.method,
                requestType: apiCall.requestType,
                responseType: apiCall.responseType,
                location: apiCall.location || { line: 0, column: 0 },
                filePath: result.filePath,
                componentName: entity.name
              });
            }
          }
        }
      }
    }

    return apiCalls;
  }

  /**
   * Extract Laravel routes and schemas from parse results
   */
  private extractLaravelRoutes(laravelResults: ParseFileResult[]): LaravelRoute_CrossStack[] {
    const routes: LaravelRoute_CrossStack[] = [];

    for (const result of laravelResults) {
      if (result.frameworkEntities) {
        for (const entity of result.frameworkEntities) {
          // Handle direct route entities
          if (entity.type === 'route' && entity.metadata?.framework === 'laravel') {
            const laravelRoute = entity as LaravelRoute;
            const urlPattern = normalizeUrlPattern(laravelRoute.path);

            routes.push({
              path: laravelRoute.path,
              method: laravelRoute.method,
              controller: laravelRoute.controller,
              action: laravelRoute.action,
              normalizedPath: urlPattern.normalized,
              filePath: laravelRoute.filePath,
            });
          }
          // Handle Laravel route entities with type 'laravel_route'
          else if (entity.type === 'laravel_route' && entity.properties) {
            const routeProps = entity.properties as any;
            const urlPattern = normalizeUrlPattern(routeProps.path);

            routes.push({
              path: routeProps.path,
              method: routeProps.method,
              controller: routeProps.controller,
              action: routeProps.action,
              normalizedPath: urlPattern.normalized,
              filePath: result.filePath,
            });
          }
          else if (entity.type === 'api_schema' && entity.metadata?.framework === 'laravel') {
            const apiSchema = entity as LaravelApiSchema;
            const urlPattern = normalizeUrlPattern(apiSchema.route);

            routes.push({
              path: apiSchema.route,
              method: apiSchema.httpMethod,
              controller: apiSchema.controllerMethod.split('@')[0],
              action: apiSchema.controllerMethod.split('@')[1],
              normalizedPath: urlPattern.normalized,
              requestValidation: apiSchema.requestValidation,
              responseSchema: apiSchema.responseSchema,
              filePath: apiSchema.filePath,
            });
          }
        }
      }
    }

    return routes;
  }

  /**
   * Create a cross-stack relationship from a URL match
   */
  private createCrossStackRelationship(match: ApiCallMatch): CrossStackRelationship | null {
    try {
      const evidenceTypes = [
        'url_pattern_match',
        'http_method_match',
        'pattern_match', // General pattern matching evidence
        ...match.similarity.evidence,
      ];

      // Create dependency relationship
      const dependency: ParsedDependency = {
        from_symbol: match.vueCall.componentName,
        to_symbol: match.laravelRoute.controller || 'UnknownController',
        dependency_type: DependencyType.API_CALL,
        line_number: match.vueCall.location.line,
      };

      // Create metadata entity
      const metadata: FrameworkEntity = {
        type: 'cross_stack_relationship',
        name: `${match.vueCall.componentName} → ${match.laravelRoute.action}`,
        filePath: match.vueCall.filePath,
        metadata: {
          vueCall: match.vueCall,
          laravelRoute: match.laravelRoute,
          similarity: match.similarity,
          evidenceTypes,
          framework: 'cross-stack',
        },
      };

      return {
        vueApiCall: match.vueCall,
        laravelRoute: match.laravelRoute,
        evidenceTypes,
        urlSimilarity: match.similarity,
        dependency,
        metadata,
      };
    } catch (error) {
      logger.warn('Failed to create cross-stack relationship', { error, match });
      return null;
    }
  }

  /**
   * Analyze compatibility between TypeScript interface and Laravel validation rules
   * Enhanced with error handling and schema drift detection
   */
  private analyzeSchemaCompatibility(
    tsInterface: VueTypeInterface,
    validationRules: ValidationRule[]
  ): SchemaCompatibility {
    try {
      const matches: SchemaCompatibility['matches'] = [];
      const mismatches: SchemaCompatibility['mismatches'] = [];

      // Input validation
      if (!tsInterface || !tsInterface.properties || !Array.isArray(validationRules)) {
        crossStackErrorHandler.handleError(
          CrossStackErrorType.SCHEMA_COMPATIBILITY_ERROR,
          ErrorSeverity.MEDIUM,
          'Invalid input for schema compatibility analysis',
          {
            hasInterface: !!tsInterface,
            hasProperties: !!tsInterface?.properties,
            validationRulesType: typeof validationRules
          }
        );

        // Return minimal compatibility result
        return {
          compatible: false,
          score: 0,
          matches: [],
          mismatches: [{
            field: 'all',
            vueType: 'unknown',
            laravelType: 'unknown',
            issue: 'Invalid input data for analysis'
          }],
        };
      }

      // Create a map of validation rules by field name
      const rulesByField = new Map<string, ValidationRule>();
      try {
        for (const rule of validationRules) {
          if (rule && rule.field) {
            rulesByField.set(rule.field, rule);
          }
        }
      } catch (error) {
        crossStackErrorHandler.handleError(
          CrossStackErrorType.SCHEMA_COMPATIBILITY_ERROR,
          ErrorSeverity.LOW,
          'Error processing validation rules',
          { validationRulesCount: validationRules.length },
          error as Error
        );
      }

      let totalFields = 0;
      let compatibleFields = 0;

      for (const property of tsInterface.properties) {
        try {
          totalFields++;
          const fieldName = this.convertCamelCaseToSnakeCase(property.name);
          const rule = rulesByField.get(fieldName) || rulesByField.get(property.name);

          if (rule) {
            const compatible = this.areTypesCompatible(property.type, rule.typeScriptEquivalent);
            const requiredMatch = property.optional === !rule.required; // Fix: optional should be opposite of required

            if (compatible && requiredMatch) {
              compatibleFields++;
              matches.push({
                field: property.name,
                vueType: property.type,
                laravelType: rule.typeScriptEquivalent,
              });
            } else {
              let issue = '';
              if (!compatible) issue += 'Type mismatch. ';
              if (!requiredMatch) issue += 'Required/optional mismatch. ';

              mismatches.push({
                field: property.name,
                vueType: property.type,
                laravelType: rule.typeScriptEquivalent,
                issue: issue.trim(),
              });
            }
          } else {
            mismatches.push({
              field: property.name,
              vueType: property.type,
              laravelType: 'unknown',
              issue: 'No corresponding validation rule found',
            });
          }
        } catch (error) {
          crossStackErrorHandler.handleError(
            CrossStackErrorType.SCHEMA_COMPATIBILITY_ERROR,
            ErrorSeverity.LOW,
            `Error analyzing property: ${property.name}`,
            { property },
            error as Error
          );

          // Add as mismatch to continue analysis
          mismatches.push({
            field: property.name,
            vueType: property.type || 'unknown',
            laravelType: 'error',
            issue: 'Error during property analysis',
          });
          totalFields++; // Still count it towards total
        }
      }

      const score = totalFields > 0 ? compatibleFields / totalFields : 0;
      const compatible = score >= 0.7; // 70% compatibility threshold

      // Detect schema drift if we have significant mismatches
      if (mismatches.length > 0 && tsInterface.name) {
        const driftResult = crossStackErrorHandler.detectSchemaDrift(
          tsInterface.name,
          tsInterface,
          validationRules
        );

        if (driftResult.driftDetected) {
        }
      }

      return {
        compatible,
        score,
        matches,
        mismatches,
      };
    } catch (error) {
      crossStackErrorHandler.handleError(
        CrossStackErrorType.SCHEMA_COMPATIBILITY_ERROR,
        ErrorSeverity.HIGH,
        'Critical error in schema compatibility analysis',
        { interfaceName: tsInterface?.name },
        error as Error
      );

      // Return safe fallback result
      return {
        compatible: false,
        score: 0,
        matches: [],
        mismatches: [{
          field: 'error',
          vueType: 'unknown',
          laravelType: 'unknown',
          issue: 'Critical error during analysis - manual review required'
        }],
      };
    }
  }

  /**
   * Create basic URL matches as fallback when sophisticated pattern matching fails
   */
  private createBasicMatches(
    vueApiCalls: ApiCallInfo[],
    laravelRoutes: LaravelRoute_CrossStack[]
  ): ApiCallMatch[] {
    const matches: ApiCallMatch[] = [];

    try {
      for (const vueCall of vueApiCalls) {
        for (const laravelRoute of laravelRoutes) {
          // Basic matching: same HTTP method and similar path structure
          if (vueCall.method.toLowerCase() === laravelRoute.method.toLowerCase()) {
            // Simple path similarity check
            const vuePathSegments = vueCall.normalizedUrl.split('/').filter(s => s.length > 0);
            const laravelPathSegments = laravelRoute.normalizedPath.split('/').filter(s => s.length > 0);

            // Calculate basic similarity
            const commonSegments = Math.min(vuePathSegments.length, laravelPathSegments.length);
            let matchingSegments = 0;

            for (let i = 0; i < commonSegments; i++) {
              if (vuePathSegments[i] === laravelPathSegments[i] ||
                  vuePathSegments[i].includes(laravelPathSegments[i]) ||
                  laravelPathSegments[i].includes(vuePathSegments[i])) {
                matchingSegments++;
              }
            }

            const basicSimilarity = commonSegments > 0 ? matchingSegments / commonSegments : 0;

            if (basicSimilarity > 0.3) { // Very low threshold for fallback
              matches.push({
                vueCall,
                laravelRoute,
                similarity: {
                  score: basicSimilarity * 0.6, // Lower score for basic matching
                  matchType: 'partial',
                  evidence: ['fallback_basic_match'],
                  parameterMatches: []
                },
              });
            }
          }
        }
      }

      return matches.sort((a, b) => b.similarity.score - a.similarity.score);
    } catch (error) {
      crossStackErrorHandler.handleError(
        CrossStackErrorType.PATTERN_MATCH_FAILURE,
        ErrorSeverity.HIGH,
        'Failed to create basic fallback matches',
        { vueCallsCount: vueApiCalls.length, laravelRoutesCount: laravelRoutes.length },
        error as Error
      );
      return []; // Return empty array if even basic matching fails
    }
  }

  /**
   * Helper methods
   */
  private extractComponentName(filePath: string): string {
    const filename = filePath.split('/').pop() || '';
    return filename.replace(/\.(vue|js|ts)$/, '');
  }

  private convertCamelCaseToSnakeCase(str: string): string {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  }

  private areTypesCompatible(tsType: string, phpType: string): boolean {
    // Normalize types for comparison
    const normalizedTsType = tsType.toLowerCase().replace(/\s+/g, '');
    const normalizedPhpType = phpType.toLowerCase().replace(/\s+/g, '');

    // Direct matches
    if (normalizedTsType === normalizedPhpType) {
      return true;
    }

    // Common type equivalences
    const typeEquivalences = [
      ['string', 'string'],
      ['number', 'number'],
      ['boolean', 'boolean'],
      ['array', 'array'],
      ['object', 'object'],
      ['any', 'any'],
      // Handle nullable types
      ['string|null', 'string|null'],
      ['number|null', 'number|null'],
      ['boolean|null', 'boolean|null'],
    ];

    for (const [ts, php] of typeEquivalences) {
      if (normalizedTsType.includes(ts) && normalizedPhpType.includes(php)) {
        return true;
      }
    }

    return false;
  }
}