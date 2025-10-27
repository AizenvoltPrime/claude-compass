import { queryCache } from '../cache';

const cacheStore = new Map<string, any>();

export async function getCachedPatternMatch(key: string): Promise<any | null> {
  return cacheStore.get(`pattern:${key}`) || null;
}

export async function cachePatternMatch(key: string, value: any): Promise<void> {
  cacheStore.set(`pattern:${key}`, value);
}

export async function getCachedSchemaCompatibility(key: string): Promise<any | null> {
  return cacheStore.get(`schema:${key}`) || null;
}

export async function cacheSchemaCompatibility(key: string, value: any): Promise<void> {
  cacheStore.set(`schema:${key}`, value);
}

export function invalidateCacheForSymbol(symbolId: number): void {
  queryCache.invalidateByPattern(`getSymbol:${JSON.stringify({ symbolId })}`);
  queryCache.invalidateByPattern(`getDependenciesTo:${JSON.stringify({ symbolId })}`);
  queryCache.invalidateByPattern(`getDependenciesFrom:${JSON.stringify({ symbolId })}`);
}

export function invalidateDependencyCache(): void {
  queryCache.invalidateByPattern('getDependencies');
  queryCache.invalidateByPattern('whoCalls');
  queryCache.invalidateByPattern('impactOf');
}

export function getCacheStats() {
  return queryCache.getStats();
}
