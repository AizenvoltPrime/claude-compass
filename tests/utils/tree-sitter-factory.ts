import Parser from 'tree-sitter';

/**
 * Factory for creating isolated tree-sitter parser instances in Jest tests.
 * This helps prevent contamination between different parser tests by ensuring
 * each test gets a completely fresh parser state.
 */
export class TreeSitterTestFactory {
  private static instance: TreeSitterTestFactory;
  private parsers: Map<string, Parser> = new Map();

  public static getInstance(): TreeSitterTestFactory {
    if (!TreeSitterTestFactory.instance) {
      TreeSitterTestFactory.instance = new TreeSitterTestFactory();
    }
    return TreeSitterTestFactory.instance;
  }

  /**
   * Create a fresh parser instance with the specified language
   */
  public createParser(language: any, testName?: string, skipValidation: boolean = false): Parser {
    const parserId = testName || `parser_${Date.now()}_${Math.random()}`;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    try {
      // Clear tree-sitter core module from cache to prevent contamination
      const moduleKeys = Object.keys(require.cache).filter(key =>
        key.includes('tree-sitter') && !key.includes('tree-sitter-javascript') && !key.includes('tree-sitter-php')
      );

      moduleKeys.forEach(key => {
        delete require.cache[key];
      });

      // Re-require fresh modules
      const Parser = require('tree-sitter');

      // Create completely fresh parser instance
      const parser = new Parser();
      parser.setLanguage(language);

      // Optional validation (can be skipped for contamination-prone cases)
      if (!skipValidation) {
        if (!this.validateParser(parser, language)) {
          // If validation fails, still return the parser but warn
          console.warn(`Parser validation failed for ${parserId}, but proceeding anyway`);
        }
      }

      this.parsers.set(parserId, parser);
      return parser;
    } catch (error) {
      throw new Error(`Failed to create parser ${parserId}: ${error}`);
    }
  }

  /**
   * Clean up a specific parser
   */
  public cleanupParser(parser: Parser): void {
    try {
      // Find and remove from tracking
      for (const [id, trackedParser] of this.parsers.entries()) {
        if (trackedParser === parser) {
          this.parsers.delete(id);
          break;
        }
      }

      // Reset parser state if method exists
      if (typeof (parser as any).reset === 'function') {
        (parser as any).reset();
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Clean up all parsers and reset factory state
   */
  public cleanupAll(): void {
    for (const parser of this.parsers.values()) {
      this.cleanupParser(parser);
    }
    this.parsers.clear();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Get appropriate test code for language validation
   */
  private getTestCode(language: any): string {
    // Try to identify language by common properties or names
    const langString = language.toString();

    if (langString.includes('php') || langString.includes('PHP')) {
      return '<?php echo "test";';
    } else if (langString.includes('javascript') || langString.includes('JavaScript')) {
      return 'const test = "hello";';
    } else if (langString.includes('typescript') || langString.includes('TypeScript')) {
      return 'const test: string = "hello";';
    } else {
      // Default to JavaScript-like syntax
      return 'const test = "hello";';
    }
  }

  /**
   * Test if a parser can successfully parse content after creation
   */
  private validateParser(parser: Parser, language: any): boolean {
    try {
      const testCode = this.getTestCode(language);
      const tree = parser.parse(testCode);
      return !!(tree && tree.rootNode);
    } catch (error) {
      return false;
    }
  }

  /**
   * Force complete reset of tree-sitter state (Jest-specific)
   */
  public static forceReset(): void {
    const instance = TreeSitterTestFactory.getInstance();
    instance.cleanupAll();

    // Force garbage collection multiple times
    if (global.gc) {
      global.gc();
      setTimeout(() => global.gc && global.gc(), 0);
    }
  }
}

/**
 * Convenience function for creating parsers in tests
 */
export function createTestParser(language: any, testName?: string, skipValidation: boolean = false): Parser {
  return TreeSitterTestFactory.getInstance().createParser(language, testName, skipValidation);
}

/**
 * Convenience function for cleaning up parsers in tests
 */
export function cleanupTestParser(parser: Parser): void {
  TreeSitterTestFactory.getInstance().cleanupParser(parser);
}

/**
 * Global test cleanup function
 */
export function cleanupAllTestParsers(): void {
  TreeSitterTestFactory.forceReset();
}