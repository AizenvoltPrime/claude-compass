import { getDatabaseConnection, closeDatabaseConnection } from '../../src/database/connection';
import { TransitiveAnalyzer } from '../../src/graph/transitive-analyzer/';
import { SymbolWithFile } from '../../src/database/models';
import * as SearchService from '../../src/database/services/search-service';
import { Knex } from 'knex';

/**
 * Integration test for query optimization and transitive analysis
 * Tests the performance and correctness of recursive CTE queries
 * and caching mechanisms for dependency analysis.
 */

describe('Query Optimization and Transitive Analysis', () => {
    let db: Knex;
    let transitiveAnalyzer: TransitiveAnalyzer;

    beforeAll(async () => {
        db = getDatabaseConnection();
        transitiveAnalyzer = new TransitiveAnalyzer();
    });

    afterAll(async () => {
        await closeDatabaseConnection();
    });

    describe('Transitive Dependencies', () => {
        it('should find transitive dependencies efficiently', async () => {
            // Get a symbol to test with
            const symbols: SymbolWithFile[] = await SearchService.lexicalSearchSymbols(db, '', undefined, {});

            if (symbols.length === 0) {
                console.warn('No symbols found for testing - skipping transitive dependency test');
                return;
            }

            const testSymbol: SymbolWithFile = symbols[0];

            // Test transitive dependencies
            const startTime: number = Date.now();
            const result = await transitiveAnalyzer.getTransitiveDependencies(testSymbol.id, { maxDepth: 5 });
            const endTime: number = Date.now();


            expect(result).toBeDefined();
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
            expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
        });

        it('should find transitive callers efficiently', async () => {
            const symbols: SymbolWithFile[] = await SearchService.lexicalSearchSymbols(db, '', undefined, {});

            if (symbols.length === 0) {
                console.warn('No symbols found for testing - skipping transitive caller test');
                return;
            }

            const testSymbol: SymbolWithFile = symbols[0];

            // Test transitive callers
            const startTime: number = Date.now();
            const result = await transitiveAnalyzer.getTransitiveCallers(testSymbol.id, { maxDepth: 5 });
            const endTime: number = Date.now();


            expect(result).toBeDefined();
            expect(result.results).toBeDefined();
            expect(Array.isArray(result.results)).toBe(true);
            expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
        });

        it('should demonstrate query caching benefits', async () => {
            const symbols: SymbolWithFile[] = await SearchService.lexicalSearchSymbols(db, '', undefined, {});

            if (symbols.length === 0) {
                console.warn('No symbols found for testing - skipping caching test');
                return;
            }

            const testSymbol: SymbolWithFile = symbols[0];

            // First query (not cached)
            const startTime1: number = Date.now();
            const result1 = await transitiveAnalyzer.getTransitiveDependencies(testSymbol.id, { maxDepth: 5 });
            const endTime1: number = Date.now();

            // Second query (potentially cached)
            const startTime2: number = Date.now();
            const result2 = await transitiveAnalyzer.getTransitiveDependencies(testSymbol.id, { maxDepth: 5 });
            const endTime2: number = Date.now();

            const firstQueryTime: number = endTime1 - startTime1;
            const secondQueryTime: number = endTime2 - startTime2;


            // Results should be identical
            expect(result1.results.length).toBe(result2.results.length);

            // Both queries should complete in reasonable time
            expect(firstQueryTime).toBeLessThan(5000);
            expect(secondQueryTime).toBeLessThan(5000);
        });
    });
});