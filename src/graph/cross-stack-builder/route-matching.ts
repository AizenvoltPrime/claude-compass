/**
 * Route matching and URL comparison utilities
 */

import { FrameworkEntity } from '../../parsers/base';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('route-matching');

/**
 * Extract route information from Laravel routes
 */
export async function extractRouteInfoFromRoutes(
  repoId: number,
  laravelRoutes: FrameworkEntity[]
): Promise<any[]> {
  const routeInfo: any[] = [];
  const uniqueRoutes = new Set<string>();

  for (const route of laravelRoutes) {
    try {
      const path = route.metadata?.path;
      const method = route.metadata?.method || 'GET';

      if (!path) {
        logger.warn('Skipping route with no path', {
          routeName: route.name,
          routeMetadata: route.metadata,
          routeType: typeof route,
          hasMetadata: !!route.metadata,
          metadataKeys: route.metadata ? Object.keys(route.metadata) : [],
        });
        continue;
      }

      const uniqueKey = `${path}|${method}`;

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
      logger.warn('Failed to extract route info', {
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
export function matchApiCallsToRoutes(vueApiCalls: any[], laravelRoutes: any[]): any[] {
  const relationships: any[] = [];

  const MAX_API_CALLS = 500;
  const MAX_ROUTES = 1000;
  const MAX_RELATIONSHIPS = 1000;
  const PERFORMANCE_WARNING_THRESHOLD = 100;

  if (
    vueApiCalls.length > PERFORMANCE_WARNING_THRESHOLD ||
    laravelRoutes.length > PERFORMANCE_WARNING_THRESHOLD
  ) {
    logger.warn('Large dataset detected in API call matching', {
      vueApiCalls: vueApiCalls.length,
      laravelRoutes: laravelRoutes.length,
      potentialCombinations: vueApiCalls.length * laravelRoutes.length,
    });
  }

  const limitedApiCalls = vueApiCalls.slice(0, MAX_API_CALLS);
  const limitedRoutes = laravelRoutes.slice(0, MAX_ROUTES);

  if (vueApiCalls.length > MAX_API_CALLS) {
    logger.warn('Truncating Vue API calls for performance', {
      original: vueApiCalls.length,
      limited: limitedApiCalls.length,
    });
  }

  if (laravelRoutes.length > MAX_ROUTES) {
    logger.warn('Truncating Laravel routes for performance', {
      original: laravelRoutes.length,
      limited: limitedRoutes.length,
    });
  }

  const startTime = Date.now();
  const matchedApiCalls = new Set<any>();

  for (const apiCall of limitedApiCalls) {
    for (const route of limitedRoutes) {
      if (relationships.length >= MAX_RELATIONSHIPS) {
        logger.warn('Maximum relationships limit reached, stopping matching', {
          maxRelationships: MAX_RELATIONSHIPS,
          processedApiCalls: limitedApiCalls.indexOf(apiCall) + 1,
          totalApiCalls: limitedApiCalls.length,
        });
        break;
      }

      const urlMatch = urlsMatch(apiCall.url, route.path);
      const methodMatch = methodsMatch(apiCall.method, route.method);

      if (limitedApiCalls.indexOf(apiCall) < 3 && limitedRoutes.indexOf(route) < 5) {
        logger.info('API call to route comparison', {
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

    if (relationships.length >= MAX_RELATIONSHIPS) {
      break;
    }
  }

  for (const apiCall of limitedApiCalls) {
    if (!matchedApiCalls.has(apiCall)) {
      relationships.push({
        vueApiCall: apiCall,
        laravelRoute: null,
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
export function urlsMatch(vueUrl: string, laravelPath: string): boolean {
  if (vueUrl === laravelPath) return true;

  const normalizeUrl = (url: string) => {
    let normalized = url;

    normalized = normalized.replace(/\/+$/, '');

    normalized = normalized.split('?')[0];

    normalized = normalized.toLowerCase();

    normalized = normalized.replace(/\{[^}]+\}/g, '{param}');

    return normalized;
  };

  const normalizedVue = normalizeUrl(vueUrl);
  const normalizedLaravel = normalizeUrl(laravelPath);

  if (normalizedVue === normalizedLaravel) return true;

  const vueSegments = vueUrl.split('/');
  const laravelSegments = laravelPath.split('/');

  if (vueSegments.length !== laravelSegments.length) return false;

  for (let i = 0; i < vueSegments.length; i++) {
    const vueSegment = vueSegments[i];
    const laravelSegment = laravelSegments[i];

    if (vueSegment.includes('{') && laravelSegment.includes('{')) {
      continue;
    }

    if (vueSegment.includes('{') !== laravelSegment.includes('{')) {
      return false;
    }

    if (vueSegment !== laravelSegment) {
      return false;
    }
  }

  return true;
}

/**
 * Check if HTTP methods match
 */
export function methodsMatch(vueMethod: string, laravelMethod: string): boolean {
  return vueMethod.toUpperCase() === laravelMethod.toUpperCase();
}
