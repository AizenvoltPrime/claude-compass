/**
 * URL Pattern Utilities for Cross-Stack Analysis
 *
 * Provides robust URL pattern matching, normalization, and similarity calculation
 * for Vue ↔ Laravel cross-stack dependency tracking.
 */

export interface RouteParameter {
  name: string;
  type: 'string' | 'number' | 'uuid' | 'slug' | 'unknown';
  position: number;
  optional: boolean;
  originalPattern: string;
}

export interface UrlPattern {
  original: string;
  normalized: string;
  parameters: RouteParameter[];
  queryParams: string[];
  isStatic: boolean;
}

export interface UrlSimilarity {
  score: number;
  matchType: 'exact' | 'parameters' | 'structure' | 'partial' | 'none';
  evidence: string[];
  parameterMatches: Array<{
    vue: string;
    laravel: string;
    compatible: boolean;
  }>;
}

/**
 * Normalizes a URL pattern by converting various dynamic constructions
 * into a standardized parameter format
 */
export function normalizeUrlPattern(url: string): UrlPattern {
  if (!url || typeof url !== 'string') {
    return {
      original: url || '',
      normalized: '',
      parameters: [],
      queryParams: [],
      isStatic: false
    };
  }

  let normalized = url.trim();
  const parameters: RouteParameter[] = [];
  const queryParams: string[] = [];

  // Remove template literal backticks if present
  if (normalized.startsWith('`') && normalized.endsWith('`')) {
    normalized = normalized.slice(1, -1);
  }

  // Remove leading/trailing whitespace and normalize slashes
  normalized = normalized.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

  // Handle different parameter patterns - prioritize template literals first
  const parameterPatterns = [
    // Vue template literal: /users/${id} - handle FIRST to avoid duplicates
    {
      pattern: /\$\{([^}]+)\}/g,
      replace: (match: string, paramName: string) => {
        parameters.push({
          name: paramName.trim(),
          type: inferParameterType(paramName.trim()),
          position: parameters.length,
          optional: false,
          originalPattern: match
        });
        return `{${paramName.trim()}}`;
      }
    },
    // Laravel style: /users/{id} - handle AFTER template literals
    {
      pattern: /\{([^}]+)\}/g,
      replace: (match: string, paramName: string) => {
        const optional = paramName.endsWith('?');
        const cleanName = paramName.replace('?', '');
        // Only add if not already processed by template literal pattern
        if (!parameters.some(p => p.name === cleanName)) {
          parameters.push({
            name: cleanName,
            type: inferParameterType(cleanName),
            position: parameters.length,
            optional,
            originalPattern: match
          });
        }
        return `{${cleanName}}`;
      }
    },
    // String concatenation patterns: '/users/' + id + '/posts'
    {
      pattern: /['"`]\s*\+\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\+\s*['"`]/g,
      replace: (match: string, paramName: string) => {
        parameters.push({
          name: paramName,
          type: inferParameterType(paramName),
          position: parameters.length,
          optional: false,
          originalPattern: match
        });
        return `{${paramName}}`;
      }
    }
  ];

  // Apply parameter patterns
  for (const pattern of parameterPatterns) {
    normalized = normalized.replace(pattern.pattern, pattern.replace as any);
  }

  // Handle query parameters
  const queryIndex = normalized.indexOf('?');
  if (queryIndex !== -1) {
    const queryString = normalized.substring(queryIndex + 1);
    const baseUrl = normalized.substring(0, queryIndex);

    // Extract query parameter names
    const queryParamMatches = queryString.match(/([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (queryParamMatches) {
      queryParams.push(...queryParamMatches);
    }

    normalized = baseUrl;
  }

  // Determine if URL is static (no parameters)
  const isStatic = parameters.length === 0 && queryParams.length === 0;


  return {
    original: url,
    normalized,
    parameters,
    queryParams,
    isStatic
  };
}

/**
 * Extracts route parameters from a URL pattern
 */
export function extractRouteParameters(url: string): RouteParameter[] {
  const pattern = normalizeUrlPattern(url);
  return pattern.parameters;
}

/**
 * Calculates similarity between Vue and Laravel URL patterns
 */
export function calculateUrlSimilarity(vueUrl: string, laravelUrl: string): UrlSimilarity {
  const vuePattern = normalizeUrlPattern(vueUrl);
  const laravelPattern = normalizeUrlPattern(laravelUrl);

  const evidence: string[] = [];
  const parameterMatches: Array<{
    vue: string;
    laravel: string;
    compatible: boolean;
  }> = [];

  // Exact match check - but consider parameter presence for match type
  if (vuePattern.normalized === laravelPattern.normalized) {
    const hasParameters = vuePattern.parameters.length > 0 || laravelPattern.parameters.length > 0;
    return {
      score: 1.0,
      matchType: hasParameters ? 'parameters' : 'exact',
      evidence: [hasParameters ? 'exact_pattern_with_parameters' : 'exact_url_match'],
      parameterMatches: []
    };
  }

  // Structure similarity
  const vueSegments = vuePattern.normalized.split('/').filter(s => s);
  const laravelSegments = laravelPattern.normalized.split('/').filter(s => s);

  if (vueSegments.length !== laravelSegments.length) {
    // Different segment counts - very low similarity
    return {
      score: Math.max(0, 0.3 - Math.abs(vueSegments.length - laravelSegments.length) * 0.1),
      matchType: 'none',
      evidence: ['segment_count_mismatch'],
      parameterMatches: []
    };
  }

  let matchingSegments = 0;
  let parameterSegments = 0;

  for (let i = 0; i < vueSegments.length; i++) {
    const vueSegment = vueSegments[i];
    const laravelSegment = laravelSegments[i];

    if (vueSegment === laravelSegment) {
      matchingSegments++;
      evidence.push(`static_segment_match:${vueSegment}`);
    } else if (isParameterSegment(vueSegment) && isParameterSegment(laravelSegment)) {
      parameterSegments++;
      const vueParam = extractParameterName(vueSegment);
      const laravelParam = extractParameterName(laravelSegment);

      const compatible = areParametersCompatible(vueParam, laravelParam);
      parameterMatches.push({
        vue: vueParam,
        laravel: laravelParam,
        compatible
      });

      if (compatible) {
        evidence.push(`parameter_match:${vueParam}↔${laravelParam}`);
      } else {
        evidence.push(`parameter_mismatch:${vueParam}↔${laravelParam}`);
      }
    } else if (isParameterSegment(vueSegment) || isParameterSegment(laravelSegment)) {
      evidence.push(`segment_type_mismatch:${vueSegment}↔${laravelSegment}`);
    } else {
      evidence.push(`static_segment_mismatch:${vueSegment}↔${laravelSegment}`);
    }
  }

  // Calculate similarity score
  const totalSegments = vueSegments.length;
  const staticSimilarity = matchingSegments / totalSegments;
  const parameterSimilarity = parameterSegments / totalSegments;
  const compatibleParameters = parameterMatches.filter(m => m.compatible).length;
  const parameterCompatibility = parameterMatches.length > 0
    ? compatibleParameters / parameterMatches.length
    : 1;

  let score = (staticSimilarity * 0.6) + (parameterSimilarity * 0.3) + (parameterCompatibility * 0.1);

  // Determine match type - prioritize parameter detection
  let matchType: UrlSimilarity['matchType'];
  if (parameterSegments > 0 && score >= 0.7) {
    // If we have parameters and good score, it's a parameter match
    matchType = 'parameters';
  } else if (score >= 0.95 && parameterSegments === 0) {
    // Only exact if perfect score and no parameters
    matchType = 'exact';
  } else if (score >= 0.7) {
    matchType = 'parameters';
  } else if (score >= 0.5) {
    matchType = 'structure';
  } else if (score >= 0.3) {
    matchType = 'partial';
  } else {
    matchType = 'none';
  }

  // Round score to avoid floating point precision issues
  score = Math.round(score * 1000) / 1000;

  return {
    score: Math.max(0, Math.min(1, score)),
    matchType,
    evidence,
    parameterMatches
  };
}

/**
 * Infers the type of a parameter based on its name
 */
function inferParameterType(paramName: string): RouteParameter['type'] {
  const name = paramName.toLowerCase();

  if (name.includes('id') && !name.includes('guid') && !name.includes('uuid')) {
    return 'number';
  }

  if (name.includes('uuid') || name.includes('guid')) {
    return 'uuid';
  }

  if (name.includes('slug') || name.includes('permalink')) {
    return 'slug';
  }

  // Common number parameters
  if (['page', 'limit', 'offset', 'count', 'size', 'index'].includes(name)) {
    return 'number';
  }

  // Default to string for safety
  return 'string';
}

/**
 * Checks if a URL segment represents a parameter
 */
function isParameterSegment(segment: string): boolean {
  return segment.startsWith('{') && segment.endsWith('}');
}

/**
 * Extracts parameter name from a parameter segment
 */
function extractParameterName(segment: string): string {
  if (isParameterSegment(segment)) {
    return segment.slice(1, -1);
  }
  return segment;
}

/**
 * Determines if two parameters are compatible based on naming and types
 */
function areParametersCompatible(vueParam: string, laravelParam: string): boolean {
  // Exact match
  if (vueParam === laravelParam) {
    return true;
  }

  // Common aliases - expanded to handle more ID patterns
  const aliases = [
    ['id', 'userId', 'user_id', 'userid'],
    ['slug', 'permalink', 'name'],
    ['page', 'pageNumber', 'page_number'],
    ['limit', 'pageSize', 'page_size', 'size'],
    ['offset', 'skip'],
  ];

  for (const aliasGroup of aliases) {
    if (aliasGroup.includes(vueParam.toLowerCase()) &&
        aliasGroup.includes(laravelParam.toLowerCase())) {
      return true;
    }
  }

  // Naming convention differences (camelCase vs snake_case)
  const vueCamelCase = vueParam.toLowerCase();
  const laravelSnakeCase = laravelParam.toLowerCase().replace(/_/g, '');

  if (vueCamelCase === laravelSnakeCase) {
    return true;
  }

  // Similar root words - enhanced logic
  const vueRoot = vueParam.replace(/Id$|_id$/i, '').toLowerCase();
  const laravelRoot = laravelParam.replace(/Id$|_id$/i, '').toLowerCase();

  if (vueRoot === laravelRoot && vueRoot.length > 2) {
    return true;
  }

  // Special case: userId should match with id
  if ((vueParam.toLowerCase() === 'userid' && laravelParam.toLowerCase() === 'id') ||
      (vueParam.toLowerCase() === 'id' && laravelParam.toLowerCase() === 'userid')) {
    return true;
  }

  // Generic ID pattern matching: any param ending with 'Id' or 'id' can match with 'id'
  const vueIsId = /id$/i.test(vueParam) || vueParam.toLowerCase() === 'id';
  const laravelIsId = /id$/i.test(laravelParam) || laravelParam.toLowerCase() === 'id';

  if (vueIsId && laravelIsId) {
    return true;
  }

  return false;
}

/**
 * Parses URL construction from template literals or string concatenation
 */
export function parseUrlConstruction(code: string): UrlPattern[] {
  const patterns: UrlPattern[] = [];

  // Template literal pattern: `${baseUrl}/api/users/${id}`
  const templateLiteralRegex = /`([^`]*\$\{[^}]+\}[^`]*)`/g;
  let match;

  while ((match = templateLiteralRegex.exec(code)) !== null) {
    const url = match[1];
    patterns.push(normalizeUrlPattern(url));
  }

  // String concatenation pattern: '/api/users/' + id + '/posts'
  const concatenationRegex = /['"]([^'"]*)['"]\s*\+\s*[a-zA-Z_$][a-zA-Z0-9_$]*(?:\s*\+\s*['"]([^'"]*)['"])?/g;

  while ((match = concatenationRegex.exec(code)) !== null) {
    // Reconstruct the URL pattern
    let url = match[1] || '';
    if (match[2]) {
      url += '{param}' + match[2];
    } else {
      url += '{param}';
    }
    patterns.push(normalizeUrlPattern(url));
  }

  return patterns;
}


/**
 * Checks if a URL follows RESTful conventions
 */
function isRestfulPattern(url: string): boolean {
  const restPatterns = [
    /^\/api\/\w+$/,                    // /api/users
    /^\/api\/\w+\/\{[^}]+\}$/,         // /api/users/{id}
    /^\/api\/\w+\/\{[^}]+\}\/\w+$/,    // /api/users/{id}/posts
  ];

  return restPatterns.some(pattern => pattern.test(url));
}