import type { Knex } from 'knex';
import { SymbolType } from '../../database/models';
import * as SearchService from '../../database/services/search-service';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('search-utils');

export function mapEntityTypeToSymbolType(entityType: string): SymbolType | null {
  switch (entityType) {
    case 'function':
      return SymbolType.FUNCTION;
    case 'class':
      return SymbolType.CLASS;
    case 'interface':
      return SymbolType.INTERFACE;
    case 'component':
      return SymbolType.COMPONENT;
    default:
      return null;
  }
}

export async function performSearchByMode(
  db: Knex,
  query: string,
  repoId: number,
  searchOptions: any,
  searchMode: 'auto' | 'exact' | 'vector' | 'qualified' = 'auto'
) {
  switch (searchMode) {
    case 'vector':
      logger.info(`[VECTOR SEARCH] Attempting vector search for query: "${query}"`);
      try {
        const vectorResults = await SearchService.vectorSearchSymbols(db, query, repoId, {
          ...searchOptions,
          similarityThreshold: 0.35,
        });
        logger.info(`[VECTOR SEARCH] Success: returned ${vectorResults.length} results`);
        return vectorResults;
      } catch (error) {
        logger.warn('[VECTOR SEARCH] Failed, falling back to lexical search:', error);
        return await SearchService.lexicalSearchSymbols(db, query, repoId, searchOptions);
      }

    case 'exact':
      return await SearchService.lexicalSearchSymbols(db, query, repoId, searchOptions);

    case 'qualified':
      try {
        return await SearchService.searchQualifiedContext(db, query, undefined);
      } catch (error) {
        logger.warn('Qualified search failed, falling back to lexical search:', error);
        return await SearchService.lexicalSearchSymbols(db, query, repoId, searchOptions);
      }

    case 'auto':
    default:
      logger.info(`[VECTOR SEARCH] Auto mode: attempting vector search for query: "${query}"`);
      try {
        const vectorResults = await SearchService.vectorSearchSymbols(db, query, repoId, {
          ...searchOptions,
          similarityThreshold: 0.35,
        });
        if (vectorResults.length > 0) {
          logger.info(
            `[VECTOR SEARCH] Auto mode: vector search returned ${vectorResults.length} results`
          );
          return vectorResults;
        }
        logger.info(
          '[VECTOR SEARCH] Auto mode: vector search returned 0 results, falling back to lexical'
        );
      } catch (error) {
        logger.warn(
          '[VECTOR SEARCH] Auto mode: vector search failed, falling back to lexical:',
          error
        );
      }

      return await SearchService.lexicalSearchSymbols(db, query, repoId, searchOptions);
  }
}

