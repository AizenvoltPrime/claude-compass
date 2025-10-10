import * as fs from 'fs/promises';
import * as path from 'path';
import { createComponentLogger } from './logger';

const logger = createComponentLogger('compassignore');

/**
 * Utility class for handling .compassignore files with gitignore-style patterns
 * Supports glob patterns, regex patterns, and automatic gitignore integration
 */
export class CompassIgnore {
  private patterns: string[] = [];
  private gitignorePatterns: string[] = [];
  private regexPatterns: RegExp[] = [];
  private globPatterns: string[] = [];

  constructor(patterns: string[] = [], gitignorePatterns: string[] = []) {
    this.patterns = patterns;
    this.gitignorePatterns = gitignorePatterns;
    this.parsePatterns();
  }

  /**
   * Create CompassIgnore instance from a .compassignore file
   */
  static async fromFile(compassignorePath: string): Promise<CompassIgnore> {
    try {
      const content = await fs.readFile(compassignorePath, 'utf-8');
      const patterns = this.parseIgnoreContent(content);

      // Also load .gitignore from the same directory if it exists
      const dir = path.dirname(compassignorePath);
      const gitignorePatterns = await this.loadGitignore(dir);

      return new CompassIgnore(patterns, gitignorePatterns);
    } catch (error) {
      // Try to load just .gitignore
      const dir = path.dirname(compassignorePath);
      const gitignorePatterns = await this.loadGitignore(dir);

      return new CompassIgnore([], gitignorePatterns);
    }
  }

  /**
   * Create CompassIgnore instance from a directory (looks for .compassignore and .gitignore)
   */
  static async fromDirectory(dirPath: string): Promise<CompassIgnore> {
    const compassignorePath = path.join(dirPath, '.compassignore');
    return this.fromFile(compassignorePath);
  }

  /**
   * Check if a file should be ignored based on all patterns
   */
  shouldIgnore(filePath: string, relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators
    const fileName = path.basename(filePath);

    // Check all pattern types
    return (
      this.matchesGlobPatterns(normalizedPath, fileName) ||
      this.matchesRegexPatterns(normalizedPath) ||
      this.matchesGitignorePatterns(normalizedPath)
    );
  }

  /**
   * Add a single pattern
   */
  addPattern(pattern: string): void {
    if (pattern && !this.patterns.includes(pattern)) {
      this.patterns.push(pattern);
      this.parsePatterns();
    }
  }

  /**
   * Add multiple patterns
   */
  addPatterns(patterns: string[]): void {
    let changed = false;
    for (const pattern of patterns) {
      if (pattern && !this.patterns.includes(pattern)) {
        this.patterns.push(pattern);
        changed = true;
      }
    }
    if (changed) {
      this.parsePatterns();
    }
  }

  /**
   * Get all active patterns (for debugging)
   */
  getPatterns(): { patterns: string[]; gitignore: string[]; regex: string[]; glob: string[] } {
    return {
      patterns: [...this.patterns],
      gitignore: [...this.gitignorePatterns],
      regex: this.regexPatterns.map(r => r.source),
      glob: [...this.globPatterns],
    };
  }

  /**
   * Parse ignore file content into individual patterns
   */
  private static parseIgnoreContent(content: string): string[] {
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')) // Remove empty lines and comments
      .filter(line => !line.startsWith('!')); // TODO: Future support for negation patterns
  }

  /**
   * Load .gitignore patterns from a directory
   */
  private static async loadGitignore(dirPath: string): Promise<string[]> {
    try {
      const gitignorePath = path.join(dirPath, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      const patterns = this.parseIgnoreContent(content);

      return patterns;
    } catch (error) {
      // .gitignore doesn't exist or can't be read
      return [];
    }
  }

  /**
   * Parse patterns and categorize them
   */
  private parsePatterns(): void {
    this.regexPatterns = [];
    this.globPatterns = [];

    for (const pattern of this.patterns) {
      if (pattern.startsWith('/regex:') && pattern.endsWith('/')) {
        // Regex pattern: /regex:pattern/
        const regexSource = pattern.slice(7, -1); // Remove '/regex:' and trailing '/'
        try {
          this.regexPatterns.push(new RegExp(regexSource));
        } catch (error) {
          logger.warn('Invalid regex pattern', { pattern, error: (error as Error).message });
        }
      } else {
        // Glob pattern
        this.globPatterns.push(pattern);
      }
    }
  }

  /**
   * Check if path matches any glob patterns
   */
  private matchesGlobPatterns(normalizedPath: string, fileName: string): boolean {
    for (const pattern of this.globPatterns) {
      if (this.matchesGlob(normalizedPath, fileName, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if path matches any regex patterns
   */
  private matchesRegexPatterns(normalizedPath: string): boolean {
    for (const regex of this.regexPatterns) {
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if path matches any gitignore patterns
   */
  private matchesGitignorePatterns(normalizedPath: string): boolean {
    for (const pattern of this.gitignorePatterns) {
      if (this.matchesGitignorePattern(normalizedPath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a single glob pattern against path and filename
   */
  private matchesGlob(normalizedPath: string, fileName: string, pattern: string): boolean {
    // Handle different glob pattern types

    // Directory patterns ending with /
    if (pattern.endsWith('/')) {
      const dirPattern = pattern.slice(0, -1);
      return (
        normalizedPath.includes('/' + dirPattern + '/') ||
        normalizedPath.startsWith(dirPattern + '/') ||
        normalizedPath === dirPattern
      );
    }

    // Absolute patterns starting with /
    if (pattern.startsWith('/')) {
      return this.matchesGlobPattern(normalizedPath, pattern.slice(1));
    }

    // Double asterisk patterns (**/pattern or pattern/**)
    if (pattern.includes('**/')) {
      return this.matchesDoubleAsterisk(normalizedPath, fileName, pattern);
    }

    // Simple wildcard patterns
    if (pattern.includes('*') || pattern.includes('?')) {
      return (
        this.matchesGlobPattern(fileName, pattern) ||
        this.matchesGlobPattern(normalizedPath, pattern)
      );
    }

    // Exact matches
    return (
      normalizedPath === pattern || fileName === pattern || normalizedPath.endsWith('/' + pattern)
    );
  }

  /**
   * Handle double asterisk glob patterns
   */
  private matchesDoubleAsterisk(
    normalizedPath: string,
    fileName: string,
    pattern: string
  ): boolean {
    if (pattern.startsWith('**/')) {
      // **/pattern - matches pattern anywhere in the path
      const suffix = pattern.slice(3);
      return (
        normalizedPath.endsWith('/' + suffix) ||
        fileName === suffix ||
        this.matchesGlobPattern(fileName, suffix)
      );
    }

    if (pattern.endsWith('/**')) {
      // pattern/** - matches anything under pattern directory
      const prefix = pattern.slice(0, -3);
      return normalizedPath.startsWith(prefix + '/') || normalizedPath === prefix;
    }

    if (pattern.includes('/**/')) {
      // pattern/**/suffix - matches suffix anywhere under pattern
      const [prefix, suffix] = pattern.split('/**/');
      return (
        normalizedPath.startsWith(prefix + '/') &&
        (normalizedPath.includes('/' + suffix) || normalizedPath.endsWith('/' + suffix))
      );
    }

    return false;
  }

  /**
   * Match a glob pattern with * and ? wildcards
   */
  private matchesGlobPattern(text: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches any single character

    const regex = new RegExp('^' + regexPattern + '$');
    return regex.test(text);
  }

  /**
   * Match gitignore-style pattern
   */
  private matchesGitignorePattern(normalizedPath: string, pattern: string): boolean {
    // For now, use the same logic as glob patterns
    // In the future, we could implement full gitignore pattern rules
    return this.matchesGlob(normalizedPath, path.basename(normalizedPath), pattern);
  }
}

/**
 * Default patterns that are commonly ignored in development projects
 */
export const DEFAULT_IGNORE_PATTERNS = [
  // Build outputs
  'build/',
  'dist/',
  'out/',
  'public/build/',
  '.next/',
  '.nuxt/',
  '.output/',

  // Dependencies
  'node_modules/',
  'vendor/',
  'bower_components/',

  // Generated files
  '*.generated.*',
  '*.gen.*',
  '**/*.generated.*',
  '**/*.gen.*',

  // Minified files
  '*.min.js',
  '*.min.css',

  // Bundle files (often problematic for parsing)
  '*.bundle.js',
  '*.bundle.css',
  '**/*.bundle.js',
  '**/*.bundle.css',
  '**/wwwroot/js/*.js',
  '**/public/vendor/*.js',

  // Source maps
  '*.map',

  // Coverage and testing
  'coverage/',
  '.nyc_output/',
  '.coverage/',

  // IDE and editor files
  '.vscode/',
  '.idea/',
  '*.swp',
  '*.swo',
  '*~',

  // OS files
  '.DS_Store',
  'Thumbs.db',

  // Logs
  '*.log',
  'logs/',

  // Temporary files
  '*.tmp',
  '*.temp',
  '.tmp/',
  '.temp/',
];

/**
 * Create a CompassIgnore instance with default patterns
 */
export function createDefaultCompassIgnore(): CompassIgnore {
  const compassIgnore = new CompassIgnore();
  compassIgnore.addPatterns(DEFAULT_IGNORE_PATTERNS);
  return compassIgnore;
}
