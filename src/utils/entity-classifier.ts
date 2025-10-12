/**
 * Configuration-driven entity type classifier
 *
 * Classifies code symbols into semantic entity types based on:
 * - Base class inheritance
 * - Name patterns (prefix/suffix)
 * - File paths and extensions
 * - Framework context
 *
 * Rules are loaded from config/entity-classification-rules.json
 * and applied with priority-based resolution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createComponentLogger } from './logger';

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
    const configPath = rulesPath || path.join(__dirname, '../../../config/entity-classification-rules.json');

    try {
      const rulesContent = fs.readFileSync(configPath, 'utf-8');
      this.rules = JSON.parse(rulesContent);
      logger.info(`Loaded entity classification rules from ${configPath}`);
    } catch (error) {
      logger.warn(`Failed to load classification rules from ${configPath}, using empty rules`, error);
      this.rules = {};
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
   * @returns Classification result with entity_type and base_class
   */
  classify(
    symbolType: string,
    name: string,
    baseClasses: string[],
    filePath: string,
    framework?: string
  ): ClassificationResult {
    const baseClass = baseClasses.length > 0 ? baseClasses[0] : null;

    // Auto-detect framework if not provided
    if (!framework) {
      framework = this.detectFramework(filePath, baseClasses);
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
   * Auto-detect framework from file path and base classes
   */
  private detectFramework(filePath: string, baseClasses: string[]): string | undefined {
    // Framework detection based ONLY on base class inheritance
    // No file path checks - if you inherit from a framework class, you're using that framework

    // Godot detection (C# game engine)
    if (this.hasGodotBaseClass(baseClasses)) return 'godot';

    // Laravel detection (PHP framework)
    if (baseClasses.some(bc => ['Model', 'Controller', 'Job', 'Middleware', 'Eloquent'].includes(bc))) {
      return 'laravel';
    }

    // Vue detection (special case: .vue files are components by definition, not based on inheritance)
    if (filePath.endsWith('.vue')) return 'vue';

    // Godot scene files (special case: .tscn files are always Godot scenes)
    if (filePath.endsWith('.tscn') || filePath.endsWith('.godot')) return 'godot';

    return undefined;
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
    const configPath = rulesPath || path.join(__dirname, '../../config/entity-classification-rules.json');
    const rulesContent = fs.readFileSync(configPath, 'utf-8');
    this.rules = JSON.parse(rulesContent);
    logger.info(`Reloaded entity classification rules from ${configPath}`);
  }
}

// Export singleton instance
export const entityClassifier = EntityTypeClassifier.getInstance();
