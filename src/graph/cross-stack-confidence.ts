/**
 * Cross-stack confidence calculation algorithms for Vue ↔ Laravel relationships
 */

import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('cross-stack-confidence');

export interface ApiCallInfo {
  method: string;
  urlPattern: string;
  requestSchema?: any;
  responseSchema?: any;
  confidence?: number;
}

export interface LaravelRoute {
  method: string;
  pattern: string;
  controller: string;
  action: string;
  middleware?: string[];
  validation?: any;
}

export interface TypeScriptInterface {
  name: string;
  properties: Array<{
    name: string;
    type: string;
    optional: boolean;
    description?: string;
  }>;
  extends?: string[];
  methods?: Array<{
    name: string;
    parameters: Array<{ name: string; type: string }>;
    returnType: string;
  }>;
}

export interface PhpDto {
  name: string;
  properties: Array<{
    name: string;
    type: string;
    visibility: 'public' | 'private' | 'protected';
    nullable: boolean;
    validation?: string[];
  }>;
  extends?: string;
  traits?: string[];
  methods?: Array<{
    name: string;
    parameters: Array<{ name: string; type: string }>;
    returnType: string;
    visibility: 'public' | 'private' | 'protected';
  }>;
}

export enum CrossStackRelationType {
  API_CALL = 'api_call',
  SCHEMA_MATCH = 'schema_match',
  TYPE_COMPATIBILITY = 'type_compatibility',
  NAMING_SIMILARITY = 'naming_similarity'
}

/**
 * CrossStackConfidenceCalculator provides sophisticated algorithms for calculating
 * confidence scores in cross-stack relationships between Vue.js and Laravel applications.
 */
export class CrossStackConfidenceCalculator {
  private readonly URL_PATTERN_WEIGHT = 0.4;
  private readonly HTTP_METHOD_WEIGHT = 0.2;
  private readonly PARAMETER_ALIGNMENT_WEIGHT = 0.3;
  private readonly CONTEXT_WEIGHT = 0.1;

  private readonly PROPERTY_NAME_WEIGHT = 0.35;
  private readonly TYPE_COMPATIBILITY_WEIGHT = 0.35;
  private readonly STRUCTURE_ALIGNMENT_WEIGHT = 0.25;
  private readonly VALIDATION_CONSISTENCY_WEIGHT = 0.05;

  /**
   * Calculate confidence score for API call relationships between Vue and Laravel
   */
  calculateApiCallConfidence(vueCall: ApiCallInfo, laravelRoute: LaravelRoute): number {
    logger.debug('Calculating API call confidence', {
      vueMethod: vueCall.method,
      vueUrl: vueCall.urlPattern,
      laravelMethod: laravelRoute.method,
      laravelPattern: laravelRoute.pattern
    });

    // 1. URL pattern similarity (0.4 weight)
    const urlSimilarity = this.calculateUrlPatternSimilarity(vueCall.urlPattern, laravelRoute.pattern);

    // 2. HTTP method matching (0.2 weight)
    const methodMatch = this.calculateHttpMethodMatch(vueCall.method, laravelRoute.method);

    // 3. Parameter structure alignment (0.3 weight)
    const parameterAlignment = this.calculateParameterAlignment(vueCall, laravelRoute);

    // 4. Context and naming similarity (0.1 weight)
    const contextSimilarity = this.calculateContextSimilarity(vueCall, laravelRoute);

    const totalScore = (
      urlSimilarity * this.URL_PATTERN_WEIGHT +
      methodMatch * this.HTTP_METHOD_WEIGHT +
      parameterAlignment * this.PARAMETER_ALIGNMENT_WEIGHT +
      contextSimilarity * this.CONTEXT_WEIGHT
    );

    logger.debug('API call confidence calculated', {
      urlSimilarity,
      methodMatch,
      parameterAlignment,
      contextSimilarity,
      totalScore
    });

    return Math.max(0, Math.min(1, totalScore));
  }

  /**
   * Calculate confidence score for schema matching between TypeScript interfaces and PHP DTOs
   */
  calculateSchemaConfidence(tsInterface: TypeScriptInterface, phpDto: PhpDto): number {
    logger.debug('Calculating schema confidence', {
      tsInterface: tsInterface.name,
      phpDto: phpDto.name,
      tsProperties: tsInterface.properties.length,
      phpProperties: phpDto.properties.length
    });

    // 1. Property name similarity (0.35 weight)
    const propertyNameSimilarity = this.calculatePropertyNameSimilarity(tsInterface, phpDto);

    // 2. Type compatibility (0.35 weight)
    const typeCompatibility = this.calculateTypeCompatibility(tsInterface, phpDto);

    // 3. Structure alignment (0.25 weight)
    const structureAlignment = this.calculateStructureAlignment(tsInterface, phpDto);

    // 4. Validation rule consistency (0.05 weight)
    const validationConsistency = this.calculateValidationConsistency(tsInterface, phpDto);

    const totalScore = (
      propertyNameSimilarity * this.PROPERTY_NAME_WEIGHT +
      typeCompatibility * this.TYPE_COMPATIBILITY_WEIGHT +
      structureAlignment * this.STRUCTURE_ALIGNMENT_WEIGHT +
      validationConsistency * this.VALIDATION_CONSISTENCY_WEIGHT
    );

    logger.debug('Schema confidence calculated', {
      propertyNameSimilarity,
      typeCompatibility,
      structureAlignment,
      validationConsistency,
      totalScore
    });

    return Math.max(0, Math.min(1, totalScore));
  }

  /**
   * Propagate confidence across cross-stack relationships with decay
   */
  propagateConfidenceAcrossStack(
    sourceConfidence: number,
    relationshipType: CrossStackRelationType,
    depth: number = 1
  ): number {
    // Base decay factors by relationship type
    const decayFactors = {
      [CrossStackRelationType.API_CALL]: 0.05,
      [CrossStackRelationType.SCHEMA_MATCH]: 0.1,
      [CrossStackRelationType.TYPE_COMPATIBILITY]: 0.15,
      [CrossStackRelationType.NAMING_SIMILARITY]: 0.2
    };

    const decayFactor = decayFactors[relationshipType] || 0.15;
    const depthPenalty = Math.pow(0.95, depth - 1); // Exponential decay with depth

    const adjustedConfidence = sourceConfidence * (1 - decayFactor) * depthPenalty;

    logger.debug('Confidence propagated across stack', {
      sourceConfidence,
      relationshipType,
      depth,
      decayFactor,
      depthPenalty,
      adjustedConfidence
    });

    return Math.max(0, Math.min(1, adjustedConfidence));
  }

  /**
   * Calculate URL pattern similarity using fuzzy matching
   */
  private calculateUrlPatternSimilarity(vueUrl: string, laravelPattern: string): number {
    // Normalize URLs for comparison
    const normalizedVue = this.normalizeUrlPattern(vueUrl);
    const normalizedLaravel = this.normalizeUrlPattern(laravelPattern);

    if (normalizedVue === normalizedLaravel) {
      return 1.0;
    }

    // Extract path segments for comparison
    const vueSegments = this.extractUrlSegments(normalizedVue);
    const laravelSegments = this.extractUrlSegments(normalizedLaravel);

    // Calculate segment similarity
    const maxLength = Math.max(vueSegments.length, laravelSegments.length);
    if (maxLength === 0) return 0;

    let matchingSegments = 0;
    const minLength = Math.min(vueSegments.length, laravelSegments.length);

    for (let i = 0; i < minLength; i++) {
      const vueSegment = vueSegments[i];
      const laravelSegment = laravelSegments[i];

      if (this.areSegmentsSimilar(vueSegment, laravelSegment)) {
        matchingSegments++;
      }
    }

    // Penalize for length differences
    const lengthPenalty = Math.abs(vueSegments.length - laravelSegments.length) * 0.1;
    const similarity = (matchingSegments / maxLength) - lengthPenalty;

    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Calculate HTTP method matching score
   */
  private calculateHttpMethodMatch(vueMethod: string, laravelMethod: string): number {
    const normalizedVue = vueMethod?.toUpperCase() || 'GET';
    const normalizedLaravel = laravelMethod?.toUpperCase() || 'GET';

    if (normalizedVue === normalizedLaravel) {
      return 1.0;
    }

    // Handle common method aliases
    const methodAliases: Record<string, string[]> = {
      'GET': ['FETCH', 'RETRIEVE'],
      'POST': ['CREATE', 'STORE'],
      'PUT': ['UPDATE', 'PATCH'],
      'DELETE': ['DESTROY', 'REMOVE']
    };

    for (const [primary, aliases] of Object.entries(methodAliases)) {
      if (
        (normalizedVue === primary && aliases.includes(normalizedLaravel)) ||
        (normalizedLaravel === primary && aliases.includes(normalizedVue))
      ) {
        return 0.8;
      }
    }

    return 0.0;
  }

  /**
   * Calculate parameter structure alignment
   */
  private calculateParameterAlignment(vueCall: ApiCallInfo, laravelRoute: LaravelRoute): number {
    // Compare request/response schemas if available
    let requestAlignment = 0.5; // Default neutral score
    let responseAlignment = 0.5; // Default neutral score

    if (vueCall.requestSchema && laravelRoute.validation) {
      requestAlignment = this.compareSchemaStructures(vueCall.requestSchema, laravelRoute.validation);
    }

    if (vueCall.responseSchema) {
      // Compare with expected Laravel response structure
      responseAlignment = this.estimateResponseAlignment(vueCall.responseSchema, laravelRoute);
    }

    return (requestAlignment + responseAlignment) / 2;
  }

  /**
   * Calculate context and naming similarity
   */
  private calculateContextSimilarity(vueCall: ApiCallInfo, laravelRoute: LaravelRoute): number {
    // Extract context from URL patterns and controller names
    const vueContext = this.extractContextFromUrl(vueCall.urlPattern);
    const laravelContext = this.extractContextFromController(laravelRoute.controller, laravelRoute.action);

    return this.calculateStringSimilarity(vueContext, laravelContext);
  }

  /**
   * Calculate property name similarity between TypeScript interface and PHP DTO
   */
  private calculatePropertyNameSimilarity(tsInterface: TypeScriptInterface, phpDto: PhpDto): number {
    const tsProperties = tsInterface.properties.map(p => p.name.toLowerCase());
    const phpProperties = phpDto.properties.map(p => p.name.toLowerCase());

    if (tsProperties.length === 0 && phpProperties.length === 0) return 1.0;
    if (tsProperties.length === 0 || phpProperties.length === 0) return 0.0;

    const matchingProperties = tsProperties.filter(tsProperty =>
      phpProperties.some(phpProperty => this.arePropertyNamesSimilar(tsProperty, phpProperty))
    );

    const maxProperties = Math.max(tsProperties.length, phpProperties.length);
    return matchingProperties.length / maxProperties;
  }

  /**
   * Calculate type compatibility between TypeScript and PHP types
   */
  private calculateTypeCompatibility(tsInterface: TypeScriptInterface, phpDto: PhpDto): number {
    const tsTypeMap = new Map(tsInterface.properties.map(p => [p.name.toLowerCase(), p.type]));
    const phpTypeMap = new Map(phpDto.properties.map(p => [p.name.toLowerCase(), p.type]));

    let compatibleTypes = 0;
    let totalComparisons = 0;

    for (const [tsName, tsType] of tsTypeMap) {
      const matchingPhpName = Array.from(phpTypeMap.keys()).find(phpName =>
        this.arePropertyNamesSimilar(tsName, phpName)
      );

      if (matchingPhpName) {
        totalComparisons++;
        const phpType = phpTypeMap.get(matchingPhpName)!;
        if (this.areTypesCompatible(tsType, phpType)) {
          compatibleTypes++;
        }
      }
    }

    return totalComparisons > 0 ? compatibleTypes / totalComparisons : 0;
  }

  /**
   * Calculate structure alignment score
   */
  private calculateStructureAlignment(tsInterface: TypeScriptInterface, phpDto: PhpDto): number {
    // Compare overall structure: property count, complexity, nesting
    const tsComplexity = this.calculateStructureComplexity(tsInterface);
    const phpComplexity = this.calculateStructureComplexity(phpDto);

    const complexityDifference = Math.abs(tsComplexity - phpComplexity);
    const maxComplexity = Math.max(tsComplexity, phpComplexity);

    if (maxComplexity === 0) return 1.0;

    const structureSimilarity = 1 - (complexityDifference / maxComplexity);
    return Math.max(0, Math.min(1, structureSimilarity));
  }

  /**
   * Calculate validation rule consistency
   */
  private calculateValidationConsistency(tsInterface: TypeScriptInterface, phpDto: PhpDto): number {
    // Compare validation patterns (e.g., required fields, type constraints)
    const tsRequiredFields = tsInterface.properties
      .filter(p => !p.optional)
      .map(p => p.name.toLowerCase());

    const phpRequiredFields = phpDto.properties
      .filter(p => p.validation?.includes('required'))
      .map(p => p.name.toLowerCase());

    if (tsRequiredFields.length === 0 && phpRequiredFields.length === 0) return 1.0;

    const matchingRequiredFields = tsRequiredFields.filter(tsField =>
      phpRequiredFields.some(phpField => this.arePropertyNamesSimilar(tsField, phpField))
    );

    const totalRequiredFields = Math.max(tsRequiredFields.length, phpRequiredFields.length);
    return totalRequiredFields > 0 ? matchingRequiredFields.length / totalRequiredFields : 0;
  }

  /**
   * Normalize URL patterns for comparison
   */
  private normalizeUrlPattern(url: string): string {
    return url
      .toLowerCase()
      .replace(/^https?:\/\/[^\/]+/, '') // Remove protocol and domain
      .replace(/\/$/, '') // Remove trailing slash
      .replace(/\/+/g, '/') // Normalize multiple slashes
      .replace(/\{([^}]+)\}/g, ':$1') // Convert {param} to :param
      .replace(/\$\{[^}]+\}/g, ':param'); // Convert ${param} to :param
  }

  /**
   * Extract URL segments for comparison
   */
  private extractUrlSegments(url: string): string[] {
    return url.split('/').filter(segment => segment.length > 0);
  }

  /**
   * Check if URL segments are similar
   */
  private areSegmentsSimilar(segment1: string, segment2: string): boolean {
    // Exact match
    if (segment1 === segment2) return true;

    // Both are parameters
    if (segment1.startsWith(':') && segment2.startsWith(':')) return true;

    // String similarity for non-parameter segments
    if (!segment1.startsWith(':') && !segment2.startsWith(':')) {
      return this.calculateStringSimilarity(segment1, segment2) > 0.8;
    }

    return false;
  }

  /**
   * Compare schema structures
   */
  private compareSchemaStructures(schema1: any, schema2: any): number {
    // Basic schema comparison - can be enhanced with deep structure analysis
    if (typeof schema1 !== 'object' || typeof schema2 !== 'object') return 0;

    const keys1 = Object.keys(schema1);
    const keys2 = Object.keys(schema2);

    if (keys1.length === 0 && keys2.length === 0) return 1.0;

    const commonKeys = keys1.filter(key => keys2.includes(key));
    const maxKeys = Math.max(keys1.length, keys2.length);

    return commonKeys.length / maxKeys;
  }

  /**
   * Estimate response alignment
   */
  private estimateResponseAlignment(responseSchema: any, laravelRoute: LaravelRoute): number {
    // Analyze Laravel route to predict response structure
    // This is a simplified estimation - real implementation would be more sophisticated
    return 0.7; // Default reasonable alignment score
  }

  /**
   * Extract context from URL
   */
  private extractContextFromUrl(url: string): string {
    const segments = this.extractUrlSegments(url);
    // Use the first non-parameter segment as context
    return segments.find(segment => !segment.startsWith(':')) || '';
  }

  /**
   * Extract context from Laravel controller
   */
  private extractContextFromController(controller: string, action: string): string {
    // Extract base name from controller (e.g., UserController -> user)
    const controllerName = controller.replace(/Controller$/, '').toLowerCase();
    return `${controllerName}_${action}`;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;

    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1.0;

    const distance = this.levenshteinDistance(str1, str2);
    return 1 - (distance / maxLength);
  }

  /**
   * Check if property names are similar
   */
  private arePropertyNamesSimilar(name1: string, name2: string): boolean {
    // Direct match
    if (name1 === name2) return true;

    // Case variations
    if (name1.toLowerCase() === name2.toLowerCase()) return true;

    // Snake_case vs camelCase conversion
    const snake1 = this.toSnakeCase(name1);
    const camel1 = this.toCamelCase(name1);
    const snake2 = this.toSnakeCase(name2);
    const camel2 = this.toCamelCase(name2);

    return snake1 === snake2 || camel1 === camel2 || snake1 === camel2 || camel1 === snake2;
  }

  /**
   * Check if TypeScript and PHP types are compatible
   */
  private areTypesCompatible(tsType: string, phpType: string): boolean {
    const typeMapping: Record<string, string[]> = {
      'string': ['string', 'varchar', 'text', 'char'],
      'number': ['int', 'integer', 'float', 'double', 'decimal'],
      'boolean': ['bool', 'boolean'],
      'Date': ['datetime', 'timestamp', 'date'],
      'object': ['array', 'json', 'object'],
      'array': ['array', 'json']
    };

    const normalizedTs = tsType.toLowerCase().replace(/\[\]$/, ''); // Remove array notation
    const normalizedPhp = phpType.toLowerCase();

    for (const [ts, phpTypes] of Object.entries(typeMapping)) {
      if (normalizedTs.includes(ts.toLowerCase()) && phpTypes.some(pt => normalizedPhp.includes(pt))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate structure complexity
   */
  private calculateStructureComplexity(structure: TypeScriptInterface | PhpDto): number {
    const propertyCount = structure.properties.length;
    const methodCount = structure.methods?.length || 0;
    const nestedComplexity = structure.properties.filter(p =>
      p.type.includes('object') || p.type.includes('interface') || p.type.includes('array')
    ).length;

    return propertyCount + methodCount * 0.5 + nestedComplexity * 2;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }
}

// Export singleton instance
export const crossStackConfidenceCalculator = new CrossStackConfidenceCalculator();