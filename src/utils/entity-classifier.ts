/**
 * Configuration-driven entity type classifier
 *
 * Classifies code symbols into semantic entity types based on:
 * - Base class inheritance
 * - Name patterns (prefix/suffix)
 * - File paths and extensions
 * - Framework context
 *
 * Rules are loaded from config/entity-classification/ directory (per-framework files).
 * All rules are merged and applied with priority-based resolution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createComponentLogger } from './logger';
import { findProjectRoot } from './project-root';

const logger = createComponentLogger('entity-classifier');

interface ClassificationRule {
  priority: number;
  entityType: string;
  description?: string;
}

interface BaseClassRule extends ClassificationRule {}

interface NamePatternRule extends ClassificationRule {
  pattern: string;
  exclude?: {
    baseClass?: string;
  };
  fileExtensions?: string[];
}

interface DirectoryRule extends ClassificationRule {
  path: string;
}

interface FileExtensionRule extends ClassificationRule {
  extension: string;
}

interface FrameworkRules {
  baseClassRules?: Record<string, BaseClassRule>;
  namePatterns?: {
    suffix?: NamePatternRule[];
    prefix?: NamePatternRule[];
  };
  directoryRules?: DirectoryRule[];
  fileExtensionRules?: FileExtensionRule[];
}

interface ClassificationRules {
  [framework: string]: {
    [symbolType: string]: FrameworkRules;
  };
}

interface ClassificationResult {
  entityType: string;
  baseClass: string | null;
  framework?: string;
  matchedRule?: string;
}

export class EntityTypeClassifier {
  private rules: ClassificationRules;
  private static instance: EntityTypeClassifier | null = null;

  constructor(rulesPath?: string) {
    this.rules = this.loadRules(rulesPath);
  }

  /**
   * Validate the structure of loaded rules to catch typos and malformed configurations
   */
  private validateRuleStructure(fileRules: any, fileName: string): void {
    if (typeof fileRules !== 'object' || fileRules === null || Array.isArray(fileRules)) {
      throw new Error(`Invalid rule format in ${fileName}: expected object, got ${typeof fileRules}`);
    }

    // Validate each framework
    for (const [framework, symbolTypes] of Object.entries(fileRules)) {
      if (typeof symbolTypes !== 'object' || symbolTypes === null || Array.isArray(symbolTypes)) {
        throw new Error(`Invalid framework rules in ${fileName} for "${framework}": expected object, got ${typeof symbolTypes}`);
      }

      // Validate each symbol type
      for (const [symbolType, rules] of Object.entries(symbolTypes as Record<string, any>)) {
        if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
          throw new Error(`Invalid symbol type rules in ${fileName} for "${framework}.${symbolType}": expected object, got ${typeof rules}`);
        }

        const frameworkRules = rules as any;

        // Validate baseClassRules
        if (frameworkRules.baseClassRules !== undefined) {
          if (typeof frameworkRules.baseClassRules !== 'object' || Array.isArray(frameworkRules.baseClassRules)) {
            throw new Error(`Invalid baseClassRules in ${fileName} for "${framework}.${symbolType}": expected object`);
          }
          for (const [baseClass, rule] of Object.entries(frameworkRules.baseClassRules)) {
            this.validateClassificationRule(rule, `${fileName}:${framework}.${symbolType}.baseClassRules.${baseClass}`);
          }
        }

        // Validate namePatterns
        if (frameworkRules.namePatterns !== undefined) {
          if (typeof frameworkRules.namePatterns !== 'object' || Array.isArray(frameworkRules.namePatterns)) {
            throw new Error(`Invalid namePatterns in ${fileName} for "${framework}.${symbolType}": expected object`);
          }

          if (frameworkRules.namePatterns.suffix !== undefined) {
            if (!Array.isArray(frameworkRules.namePatterns.suffix)) {
              throw new Error(`Invalid namePatterns.suffix in ${fileName} for "${framework}.${symbolType}": expected array`);
            }
            frameworkRules.namePatterns.suffix.forEach((rule: any, index: number) => {
              this.validateNamePatternRule(rule, `${fileName}:${framework}.${symbolType}.namePatterns.suffix[${index}]`);
            });
          }

          if (frameworkRules.namePatterns.prefix !== undefined) {
            if (!Array.isArray(frameworkRules.namePatterns.prefix)) {
              throw new Error(`Invalid namePatterns.prefix in ${fileName} for "${framework}.${symbolType}": expected array`);
            }
            frameworkRules.namePatterns.prefix.forEach((rule: any, index: number) => {
              this.validateNamePatternRule(rule, `${fileName}:${framework}.${symbolType}.namePatterns.prefix[${index}]`);
            });
          }
        }

        // Validate directoryRules
        if (frameworkRules.directoryRules !== undefined) {
          if (!Array.isArray(frameworkRules.directoryRules)) {
            throw new Error(`Invalid directoryRules in ${fileName} for "${framework}.${symbolType}": expected array`);
          }
          frameworkRules.directoryRules.forEach((rule: any, index: number) => {
            this.validateDirectoryRule(rule, `${fileName}:${framework}.${symbolType}.directoryRules[${index}]`);
          });
        }

        // Validate fileExtensionRules
        if (frameworkRules.fileExtensionRules !== undefined) {
          if (!Array.isArray(frameworkRules.fileExtensionRules)) {
            throw new Error(`Invalid fileExtensionRules in ${fileName} for "${framework}.${symbolType}": expected array`);
          }
          frameworkRules.fileExtensionRules.forEach((rule: any, index: number) => {
            this.validateFileExtensionRule(rule, `${fileName}:${framework}.${symbolType}.fileExtensionRules[${index}]`);
          });
        }
      }
    }
  }

  private validateClassificationRule(rule: any, path: string): void {
    if (typeof rule !== 'object' || rule === null) {
      throw new Error(`Invalid rule at ${path}: expected object`);
    }
    if (typeof rule.priority !== 'number') {
      throw new Error(`Invalid priority at ${path}: expected number, got ${typeof rule.priority}`);
    }
    if (typeof rule.entityType !== 'string') {
      throw new Error(`Invalid entityType at ${path}: expected string, got ${typeof rule.entityType}`);
    }
  }

  private validateNamePatternRule(rule: any, path: string): void {
    this.validateClassificationRule(rule, path);
    if (typeof rule.pattern !== 'string') {
      throw new Error(`Invalid pattern at ${path}: expected string, got ${typeof rule.pattern}`);
    }
    if (rule.exclude !== undefined) {
      if (typeof rule.exclude !== 'object' || rule.exclude === null) {
        throw new Error(`Invalid exclude at ${path}: expected object`);
      }
    }
    if (rule.fileExtensions !== undefined && !Array.isArray(rule.fileExtensions)) {
      throw new Error(`Invalid fileExtensions at ${path}: expected array`);
    }
  }

  private validateDirectoryRule(rule: any, path: string): void {
    this.validateClassificationRule(rule, path);
    if (typeof rule.path !== 'string') {
      throw new Error(`Invalid path at ${path}: expected string, got ${typeof rule.path}`);
    }
  }

  private validateFileExtensionRule(rule: any, path: string): void {
    this.validateClassificationRule(rule, path);
    if (typeof rule.extension !== 'string') {
      throw new Error(`Invalid extension at ${path}: expected string, got ${typeof rule.extension}`);
    }
  }

  /**
   * Load classification rules from directory (per-framework files)
   *
   * Priority System:
   * - 1: Base class rules (lowest priority, most specific)
   * - 5: Directory-based rules
   * - 10: Name pattern rules (standard)
   * - 15: Name pattern rules (high priority, e.g., React hooks)
   * - 20: File extension rules (highest priority)
   *
   * Higher numbers win in conflicts.
   */
  private loadRules(rulesPath?: string): ClassificationRules {
    const projectRoot = findProjectRoot();
    const directoryPath = rulesPath || path.join(projectRoot, 'config/entity-classification');

    if (!fs.existsSync(directoryPath)) {
      throw new Error(`Classification rules directory not found: ${directoryPath}`);
    }

    try {
      // Get all JSON files from directory with safety checks
      const files = fs.readdirSync(directoryPath)
        .filter(f => {
          const fullPath = path.join(directoryPath, f);
          try {
            const stats = fs.statSync(fullPath);
            return stats.isFile() && f.endsWith('.json');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(`Failed to stat file ${f}: ${errorMessage}`);
            return false;
          }
        });

      if (files.length === 0) {
        throw new Error(`No JSON files found in ${directoryPath}`);
      }

      const mergedRules: ClassificationRules = {};

      for (const file of files) {
        const filePath = path.join(directoryPath, file);
        try {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          const fileRules = JSON.parse(fileContent);

          // Validate rule structure (catches typos and malformed configs)
          this.validateRuleStructure(fileRules, file);

          // Validate no duplicate framework definitions
          const frameworkKeys = Object.keys(fileRules);
          for (const key of frameworkKeys) {
            if (mergedRules[key]) {
              throw new Error(`Duplicate framework "${key}" found in ${file}. Framework already defined in another file.`);
            }
          }

          // Merge rules from this file into the overall rules object
          Object.assign(mergedRules, fileRules);
          logger.debug(`Loaded rules from ${file}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to load rules from ${file}: ${errorMessage}`);
          throw new Error(`Critical error loading classification rules from ${file}: ${errorMessage}`);
        }
      }

      logger.info(`Loaded entity classification rules from ${files.length} files in ${directoryPath}`);
      return mergedRules;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to load rules from directory ${directoryPath}: ${errorMessage}`);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): EntityTypeClassifier {
    if (!EntityTypeClassifier.instance) {
      EntityTypeClassifier.instance = new EntityTypeClassifier();
    }
    return EntityTypeClassifier.instance;
  }

  /**
   * Classify a symbol into an entity type
   *
   * @param symbolType - Raw symbol type (class, function, method, etc.)
   * @param name - Symbol name
   * @param baseClasses - Array of base classes/interfaces
   * @param filePath - File path (for directory/extension rules)
   * @param framework - Framework context (godot, laravel, vue, react)
   * @param namespace - Qualified namespace for the symbol
   * @param repoFrameworks - Frameworks detected at repository level
   * @returns Classification result with entity_type and base_class
   */
  classify(
    symbolType: string,
    name: string,
    baseClasses: string[],
    filePath: string,
    framework?: string,
    namespace?: string,
    repoFrameworks?: string[]
  ): ClassificationResult {
    const baseClass = baseClasses.length > 0 ? baseClasses[0] : null;

    // Auto-detect framework if not provided
    if (!framework) {
      framework = this.detectFramework(filePath, baseClasses, namespace, repoFrameworks);
    }

    // Collect all matching rules with their priorities
    const matchedRules: Array<{ rule: string; entityType: string; priority: number }> = [];

    // Get framework rules for this symbol type
    const frameworkRules = this.getFrameworkRules(framework, symbolType);
    if (!frameworkRules) {
      // No rules for this framework/symbolType - return defaults
      return {
        entityType: symbolType,
        baseClass,
        framework,
        matchedRule: 'default (no rules)',
      };
    }

    // 1. File extension rules (highest priority for framework detection)
    if (frameworkRules.fileExtensionRules) {
      for (const rule of frameworkRules.fileExtensionRules) {
        if (filePath.endsWith(rule.extension)) {
          matchedRules.push({
            rule: `file extension: ${rule.extension}`,
            entityType: rule.entityType,
            priority: rule.priority,
          });
        }
      }
    }

    // 2. Name pattern rules (suffix)
    if (frameworkRules.namePatterns?.suffix) {
      for (const rule of frameworkRules.namePatterns.suffix) {
        if (name.endsWith(rule.pattern)) {
          // Check exclusions
          if (rule.exclude?.baseClass && baseClass === rule.exclude.baseClass) {
            continue;
          }
          // Check file extension requirements
          if (rule.fileExtensions && !rule.fileExtensions.some(ext => filePath.endsWith(ext))) {
            continue;
          }
          matchedRules.push({
            rule: `name suffix: ${rule.pattern}`,
            entityType: rule.entityType,
            priority: rule.priority,
          });
        }
      }
    }

    // 3. Name pattern rules (prefix/regex)
    if (frameworkRules.namePatterns?.prefix) {
      for (const rule of frameworkRules.namePatterns.prefix) {
        const regex = new RegExp(rule.pattern);
        if (regex.test(name)) {
          // Check file extension requirements
          if (rule.fileExtensions && !rule.fileExtensions.some(ext => filePath.endsWith(ext))) {
            continue;
          }
          matchedRules.push({
            rule: `name prefix: ${rule.pattern}`,
            entityType: rule.entityType,
            priority: rule.priority,
          });
        }
      }
    }

    // 4. Directory rules
    if (frameworkRules.directoryRules) {
      for (const rule of frameworkRules.directoryRules) {
        if (filePath.includes(rule.path)) {
          matchedRules.push({
            rule: `directory: ${rule.path}`,
            entityType: rule.entityType,
            priority: rule.priority,
          });
        }
      }
    }

    // 5. Base class rules
    if (frameworkRules.baseClassRules && baseClass) {
      const baseClassRule = frameworkRules.baseClassRules[baseClass];
      if (baseClassRule) {
        matchedRules.push({
          rule: `base class: ${baseClass}`,
          entityType: baseClassRule.entityType,
          priority: baseClassRule.priority,
        });
      }
    }

    // Select rule with highest priority
    if (matchedRules.length > 0) {
      matchedRules.sort((a, b) => b.priority - a.priority);
      const winner = matchedRules[0];

      return {
        entityType: winner.entityType,
        baseClass,
        framework,
        matchedRule: winner.rule,
      };
    }

    // Fallback: return symbol_type as entity_type
    return {
      entityType: symbolType,
      baseClass,
      framework,
      matchedRule: 'fallback (no matching rules)',
    };
  }

  /**
   * Auto-detect framework from file path, namespace, and base classes
   *
   * Design Decision: PHP Framework Detection
   * ----------------------------------------
   * PHP files return `undefined` for framework when Laravel namespaces are not detected,
   * while C# files return `'csharp'` as a fallback. This is intentional:
   *
   * - C#: File extension (.cs) definitively indicates C# language. Returning 'csharp'
   *   is always correct, even if no specific framework (like Godot) is detected.
   *
   * - PHP: File extension (.php) only indicates PHP language, but could be Laravel,
   *   Symfony, plain PHP, or other frameworks. Returning `undefined` prevents false
   *   positives from name-based heuristics (e.g., a C# controller named "FooController"
   *   being incorrectly tagged as Laravel).
   *
   * We prioritize **qualified namespaces** (e.g., `Illuminate\` for Laravel, `Godot.`
   * for Godot) as the most reliable framework detection mechanism, avoiding simple
   * name pattern matching that leads to cross-language false positives.
   */
  private detectFramework(
    filePath: string,
    baseClasses: string[],
    namespace?: string,
    repoFrameworks?: string[]
  ): string | undefined {
    const ext = filePath.substring(filePath.lastIndexOf('.'));

    // PHP: Check Laravel namespace (definitive) - namespace check is primary, repo hint is secondary
    if (ext === '.php') {
      // Check for Laravel by qualified namespace (most reliable)
      if (this.hasLaravelNamespace(namespace, baseClasses)) {
        return 'laravel';
      }
      // If repo says it's Laravel but namespace doesn't confirm, still return undefined
      // This prevents false positives from simple name matching
      return undefined; // PHP but framework cannot be determined - don't guess!
    }

    // C#: Check Godot namespace (definitive)
    if (ext === '.cs') {
      // Check for Godot by qualified namespace or base classes
      if (namespace?.startsWith('Godot.') || this.hasGodotBaseClass(baseClasses)) {
        return 'godot';
      }
      // Fallback to generic C# (always safe for C# files)
      return 'csharp';
    }

    // Vue/React: File extension is definitive
    if (ext === '.vue') return 'vue';
    if (ext === '.jsx' || ext === '.tsx') {
      return repoFrameworks?.find(f => ['react', 'nextjs'].includes(f));
    }

    // Godot scene files (special case: .tscn files are always Godot scenes)
    if (ext === '.tscn' || ext === '.godot') return 'godot';

    return undefined;
  }

  /**
   * Check if namespace or base classes indicate Laravel framework
   */
  private hasLaravelNamespace(namespace?: string, baseClasses?: string[]): boolean {
    // Check qualified namespace (definitive)
    if (namespace?.startsWith('Illuminate\\')) return true;

    // Check qualified base classes (definitive)
    if (baseClasses?.some(bc => bc.startsWith('Illuminate\\'))) return true;

    // Otherwise: cannot determine (don't assume!)
    return false;
  }

  /**
   * Check if base classes include Godot types
   */
  private hasGodotBaseClass(baseClasses: string[]): boolean {
    const godotClasses = [
      'Node',
      'Node2D',
      'Node3D',
      'Control',
      'Resource',
      'RefCounted',
      'Object',
      'PackedScene',
      'GodotObject',
      'Area2D',
      'Area3D',
      'RigidBody2D',
      'RigidBody3D',
      'CharacterBody2D',
      'CharacterBody3D',
      'StaticBody2D',
      'StaticBody3D',
    ];

    return baseClasses.some(bc => godotClasses.includes(bc));
  }

  /**
   * Get framework rules for a specific symbol type
   */
  private getFrameworkRules(framework: string | undefined, symbolType: string): FrameworkRules | null {
    if (!framework || !this.rules[framework]) {
      return null;
    }

    // Try exact symbol type match
    if (this.rules[framework][symbolType]) {
      return this.rules[framework][symbolType];
    }

    // Try 'default' fallback
    if (this.rules[framework]['default']) {
      return this.rules[framework]['default'];
    }

    return null;
  }

  /**
   * Get all supported frameworks
   */
  getSupportedFrameworks(): string[] {
    return Object.keys(this.rules);
  }

  /**
   * Reload rules from disk (useful for development/testing)
   */
  reloadRules(rulesPath?: string): void {
    this.rules = this.loadRules(rulesPath);
    logger.info('Entity classification rules reloaded');
  }
}

// Export singleton instance
export const entityClassifier = EntityTypeClassifier.getInstance();
