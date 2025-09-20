import { CrossStackParser } from '../../src/parsers/cross-stack';
import { jest } from '@jest/globals';

describe('CrossStackParser - Basic Tests', () => {
  let parser: CrossStackParser;

  beforeEach(() => {
    parser = new CrossStackParser(0.7);
  });

  describe('constructor', () => {
    it('should create parser with default confidence threshold', () => {
      const defaultParser = new CrossStackParser();
      expect(defaultParser).toBeDefined();
    });

    it('should create parser with custom confidence threshold', () => {
      const customParser = new CrossStackParser(0.8);
      expect(customParser).toBeDefined();
    });

    it('should handle invalid confidence threshold gracefully', () => {
      expect(() => new CrossStackParser(-1)).not.toThrow();
      expect(() => new CrossStackParser(1.5)).not.toThrow();
    });
  });

  describe('detectApiCallRelationships', () => {
    it('should handle empty input gracefully', async () => {
      const relationships = await parser.detectApiCallRelationships([], []);
      expect(relationships).toHaveLength(0);
    });

    it('should handle malformed input without throwing', async () => {
      const malformedVue = [
        {
          filePath: '/test.vue',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: []
        }
      ];

      const malformedLaravel = [
        {
          filePath: '/test.php',
          symbols: [],
          dependencies: [],
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: []
        }
      ];

      await expect(async () => {
        await parser.detectApiCallRelationships(malformedVue, malformedLaravel);
      }).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should not throw on null or undefined input', async () => {
      await expect(async () => {
        await parser.detectApiCallRelationships(null as any, null as any);
      }).not.toThrow();

      await expect(async () => {
        await parser.detectApiCallRelationships(undefined as any, undefined as any);
      }).not.toThrow();
    });
  });
});