import Parser from 'tree-sitter';
import * as CSharp from 'tree-sitter-c-sharp';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  FrameworkPattern,
  ParseFileResult,
} from './base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  PropDefinition,
  ParsedDependency,
  ParsedSymbol,
  ParseResult,
  ParsedImport,
  ParsedExport,
  ParseError,
} from './base';
import {
  MergedParseResult,
  ChunkResult,
} from './chunked-parser';
import { DependencyType, SymbolType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs/promises';

const logger = createComponentLogger('godot-parser');

/**
 * Godot scene entity representing a .tscn file
 */
export interface GodotScene extends FrameworkEntity {
  type: 'godot_scene';
  scenePath: string;
  rootNode?: GodotNode;
  nodes: GodotNode[];
  resources: GodotResource[];
  connections: GodotConnection[];
  framework: 'godot';
  confidence: number;
}

/**
 * Godot node within a scene
 */
export interface GodotNode extends FrameworkEntity {
  type: 'godot_node';
  nodeType: string;
  nodeName: string;
  parent?: string;
  children: string[];
  script?: string;
  properties: Record<string, any>;
  framework: 'godot';
  confidence: number;
}

/**
 * Godot script entity (C# class extending Godot classes)
 */
export interface GodotScript extends FrameworkEntity {
  type: 'godot_script';
  className: string;
  baseClass?: string;
  signals: GodotSignal[];
  exports: GodotExport[];
  isAutoload: boolean;
  attachedScenes: string[];
  framework: 'godot';
  confidence: number;
}

/**
 * Godot autoload (singleton script)
 */
export interface GodotAutoload extends FrameworkEntity {
  type: 'godot_autoload';
  autoloadName: string;
  scriptPath: string;
  className: string;
  framework: 'godot';
  confidence: number;
}

/**
 * Godot resource (custom resource class)
 */
export interface GodotResource extends FrameworkEntity {
  type: 'godot_resource';
  resourceType: string;
  resourcePath?: string;
  properties: Record<string, any>;
  framework: 'godot';
  confidence: number;
}

/**
 * Godot signal definition
 */
export interface GodotSignal {
  name: string;
  parameters: Array<{
    name: string;
    type?: string;
  }>;
  line: number;
}

/**
 * Godot export property (with [Export] attribute)
 */
export interface GodotExport {
  name: string;
  type: string;
  defaultValue?: any;
  exportType?: string; // Range, File, etc.
  line: number;
}

/**
 * Godot signal connection
 */
export interface GodotConnection {
  signal: string;
  from: string;
  to: string;
  method: string;
  binds?: any[];
}

/**
 * Godot-specific parser for game development framework
 * Handles C# scripts with Godot patterns and .tscn scene files
 */
export class GodotParser extends BaseFrameworkParser {
  private csharpParser: Parser;

  constructor(parser: Parser) {
    super(parser, 'godot');

    // Create C# parser for handling C# script content
    this.csharpParser = new Parser();
    this.csharpParser.setLanguage(CSharp as any);
  }

  /**
   * Define framework patterns for detecting Godot projects and code
   */
  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'godot-project',
        pattern: /\[application\]|\[rendering\]|\[physics\]/,
        fileExtensions: ['.godot'],
        confidence: 0.98,
        description: 'Godot project configuration file',
      },
      {
        name: 'godot-scene',
        pattern: /\[gd_scene\s+load_steps=\d+\s+format=\d+\]/,
        fileExtensions: ['.tscn'],
        confidence: 0.95,
        description: 'Godot scene file',
      },
      {
        name: 'godot-csharp-script',
        pattern: /extends\s+(Node|Control|RigidBody|CharacterBody|Resource)|class\s+\w+\s*:\s*(Node|Control|RigidBody|CharacterBody|Resource)/,
        fileExtensions: ['.cs'],
        confidence: 0.9,
        description: 'C# script extending Godot classes',
      },
      {
        name: 'godot-export-attribute',
        pattern: /\[Export\]|\[Export\s*\(|\[Signal\]/,
        fileExtensions: ['.cs'],
        confidence: 0.85,
        description: 'Godot C# export attributes',
      },
      {
        name: 'godot-api-calls',
        pattern: /GD\.Print|GetNode|EmitSignal|CallDeferred|AddChild|QueueFree/,
        fileExtensions: ['.cs'],
        confidence: 0.8,
        description: 'Godot C# API calls',
      },
      {
        name: 'godot-input-handling',
        pattern: /_Ready\s*\(|_Process\s*\(|_PhysicsProcess\s*\(|_Input\s*\(/,
        fileExtensions: ['.cs'],
        confidence: 0.85,
        description: 'Godot C# lifecycle methods',
      },
      {
        name: 'godot-node-types',
        pattern: /Node2D|Node3D|Area2D|Area3D|CollisionShape2D|CollisionShape3D|Sprite2D|Sprite3D|Camera2D|Camera3D/,
        fileExtensions: ['.cs', '.tscn'],
        confidence: 0.8,
        description: 'Godot node type references',
      }
    ];
  }

  /**
   * Detect framework-specific entities in Godot files
   */
  public async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    const entities: FrameworkEntity[] = [];

    try {
      if (filePath.endsWith('.tscn')) {
        // Parse Godot scene file
        logger.debug('Attempting to parse Godot scene file', { filePath });
        const scene = await this.parseGodotScene(content, filePath, options);
        if (scene) {
          entities.push(scene);
          // Add individual nodes as entities
          entities.push(...scene.nodes);
        }
      } else if (filePath.endsWith('.cs') && this.isGodotScript(content)) {
        // Parse Godot C# script
        logger.debug('Attempting to parse Godot C# script', { filePath });
        const script = await this.parseGodotScript(content, filePath, options);
        if (script) {
          entities.push(script);
        }
      } else if (filePath.endsWith('project.godot')) {
        // Parse project configuration for autoloads
        logger.debug('Attempting to parse Godot project config', { filePath });
        const autoloads = await this.parseGodotProject(content, filePath, options);
        entities.push(...autoloads);
      }

      logger.debug('Godot framework entities detected', {
        filePath,
        entityCount: entities.length,
        entityTypes: entities.map(e => e.type)
      });

      return { entities };
    } catch (error) {
      logger.error('Failed to detect Godot framework entities', {
        filePath,
        error: (error as Error).message
      });

      return { entities: [] };
    }
  }

  /**
   * Check if a C# file contains Godot-specific patterns
   */
  private isGodotScript(content: string): boolean {
    // Check for common Godot patterns
    const godotPatterns = [
      /extends\s+(Node|Control|RigidBody|CharacterBody|Resource|RefCounted)/,
      /class\s+\w+\s*:\s*(Node|Control|RigidBody|CharacterBody|Resource|RefCounted)/,
      /\[Export\]/,
      /\[Signal\]/,
      /GD\.Print/,
      /GetNode/,
      /EmitSignal/,
      /_Ready\s*\(/,
      /_Process\s*\(/,
      /_PhysicsProcess\s*\(/
    ];

    return godotPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Parse a Godot scene file (.tscn)
   */
  private async parseGodotScene(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<GodotScene | null> {
    try {
      const sceneName = path.basename(filePath, '.tscn');
      const nodes: GodotNode[] = [];
      const resources: GodotResource[] = [];
      const connections: GodotConnection[] = [];

      // Parse scene file format
      const lines = content.split('\n');
      let currentSection: string | null = null;
      let currentNode: Partial<GodotNode> | null = null;

      for (const line of lines) {
        const trimmed = line.trim();

        // Parse section headers
        if (trimmed.startsWith('[')) {
          if (currentNode && currentSection === 'node') {
            nodes.push(currentNode as GodotNode);
            currentNode = null;
          }

          const sectionMatch = trimmed.match(/\[(\w+)(?:\s+([^\]]+))?\]/);
          if (sectionMatch) {
            currentSection = sectionMatch[1];

            if (currentSection === 'node') {
              const nodeParams = this.parseNodeParams(sectionMatch[2] || '');
              currentNode = {
                type: 'godot_node',
                name: nodeParams.name || 'Unknown',
                filePath,
                metadata: {},
                nodeType: nodeParams.type || 'Node',
                nodeName: nodeParams.name || 'Unknown',
                parent: nodeParams.parent,
                children: [],
                properties: {},
                framework: 'godot',
                confidence: 0.9
              };
            }
          }
        } else if (trimmed && !trimmed.startsWith(';') && currentSection) {
          // Parse properties
          const propMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
          if (propMatch && currentNode) {
            const [, key, value] = propMatch;
            currentNode.properties = currentNode.properties || {};
            currentNode.properties[key] = this.parsePropertyValue(value);

            // Handle script attachment
            if (key === 'script' && value.includes('ExtResource')) {
              currentNode.script = this.extractResourcePath(value);
            }
          }
        }
      }

      // Add the last node if any
      if (currentNode && currentSection === 'node') {
        nodes.push(currentNode as GodotNode);
      }

      // Build node hierarchy
      this.buildNodeHierarchy(nodes);

      const scene: GodotScene = {
        type: 'godot_scene',
        name: sceneName,
        filePath,
        metadata: {
          nodeCount: nodes.length,
          hasScript: nodes.some(node => node.script)
        },
        scenePath: filePath,
        rootNode: nodes.find(node => !node.parent),
        nodes,
        resources,
        connections,
        framework: 'godot',
        confidence: 0.95
      };

      return scene;
    } catch (error) {
      logger.error('Failed to parse Godot scene', {
        filePath,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Parse a Godot C# script
   */
  private async parseGodotScript(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<GodotScript | null> {
    try {
      const className = this.extractClassName(content, filePath);
      const baseClass = this.extractBaseClass(content);
      const signals = this.extractSignals(content);
      const exports = this.extractGodotExports(content);
      const isAutoload = this.isAutoloadScript(filePath, content);

      const script: GodotScript = {
        type: 'godot_script',
        name: className,
        filePath,
        metadata: {
          baseClass,
          signalCount: signals.length,
          exportCount: exports.length,
          isAutoload
        },
        className,
        baseClass,
        signals,
        exports,
        isAutoload,
        attachedScenes: [], // TODO: Find scenes that reference this script
        framework: 'godot',
        confidence: 0.9
      };

      return script;
    } catch (error) {
      logger.error('Failed to parse Godot script', {
        filePath,
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * Parse Godot project configuration for autoloads
   */
  private async parseGodotProject(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<GodotAutoload[]> {
    const autoloads: GodotAutoload[] = [];

    try {
      // Look for autoload section
      const autoloadSection = content.match(/\[autoload\]([\s\S]*?)(?=\n\[|\n*$)/);
      if (!autoloadSection) return autoloads;

      const lines = autoloadSection[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';')) continue;

        const match = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
        if (match) {
          const [, autoloadName, scriptPath] = match;
          const className = this.extractClassNameFromPath(scriptPath);

          autoloads.push({
            type: 'godot_autoload',
            name: autoloadName,
            filePath,
            metadata: {
              scriptPath,
              className
            },
            autoloadName,
            scriptPath,
            className,
            framework: 'godot',
            confidence: 0.95
          });
        }
      }
    } catch (error) {
      logger.error('Failed to parse Godot project autoloads', {
        filePath,
        error: (error as Error).message
      });
    }

    return autoloads;
  }

  // Helper methods for parsing scene files

  private parseNodeParams(params: string): { name?: string; type?: string; parent?: string } {
    const result: { name?: string; type?: string; parent?: string } = {};

    // Parse name="NodeName"
    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) result.name = nameMatch[1];

    // Parse type="NodeType"
    const typeMatch = params.match(/type="([^"]+)"/);
    if (typeMatch) result.type = typeMatch[1];

    // Parse parent="ParentNode"
    const parentMatch = params.match(/parent="([^"]+)"/);
    if (parentMatch) result.parent = parentMatch[1];

    return result;
  }

  private parsePropertyValue(value: string): any {
    // Remove quotes and parse basic types
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }

    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;

    // Try to parse as number
    const num = parseFloat(value);
    if (!isNaN(num)) return num;

    return value;
  }

  private extractResourcePath(value: string): string {
    const match = value.match(/ExtResource\s*\(\s*"([^"]+)"\s*\)/);
    return match ? match[1] : value;
  }

  private buildNodeHierarchy(nodes: GodotNode[]): void {
    // Build parent-child relationships
    for (const node of nodes) {
      if (node.parent) {
        const parentNode = nodes.find(n => n.nodeName === node.parent);
        if (parentNode) {
          parentNode.children.push(node.nodeName);
        }
      }
    }
  }

  // Helper methods for parsing C# scripts

  private extractClassName(content: string, filePath: string): string {
    // Try to extract from class declaration
    const classMatch = content.match(/class\s+(\w+)/);
    if (classMatch) return classMatch[1];

    // Fallback to filename
    return path.basename(filePath, '.cs');
  }

  private extractBaseClass(content: string): string | undefined {
    // Match "extends BaseClass" or "class MyClass : BaseClass"
    const extendsMatch = content.match(/extends\s+(\w+)/);
    if (extendsMatch) return extendsMatch[1];

    const classMatch = content.match(/class\s+\w+\s*:\s*(\w+)/);
    if (classMatch) return classMatch[1];

    return undefined;
  }

  private extractSignals(content: string): GodotSignal[] {
    const signals: GodotSignal[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const signalMatch = line.match(/\[Signal\]\s*(?:public\s+)?delegate\s+\w+\s+(\w+)\s*\(([^)]*)\)/);

      if (signalMatch) {
        const [, name, params] = signalMatch;
        signals.push({
          name,
          parameters: this.parseSignalParameters(params),
          line: i + 1
        });
      }
    }

    return signals;
  }

  private extractGodotExports(content: string): GodotExport[] {
    const exports: GodotExport[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const exportMatch = line.match(/\[Export(?:\(([^)]+)\))?\]\s*(?:public\s+)?(\w+)\s+(\w+)(?:\s*=\s*([^;]+))?/);

      if (exportMatch) {
        const [, exportType, type, name, defaultValue] = exportMatch;
        exports.push({
          name,
          type,
          defaultValue: defaultValue?.trim(),
          exportType: exportType?.trim(),
          line: i + 1
        });
      }
    }

    return exports;
  }

  private parseSignalParameters(params: string): Array<{ name: string; type?: string }> {
    if (!params.trim()) return [];

    return params.split(',').map(param => {
      const parts = param.trim().split(/\s+/);
      if (parts.length >= 2) {
        return { type: parts[0], name: parts[1] };
      }
      return { name: parts[0] };
    });
  }

  private isAutoloadScript(filePath: string, content: string): boolean {
    // Check if file is in autoload directory or has singleton patterns
    return filePath.includes('/autoload/') ||
           filePath.includes('/singletons/') ||
           content.includes('public static ') ||
           content.includes('Singleton');
  }

  private extractClassNameFromPath(scriptPath: string): string {
    return path.basename(scriptPath, '.cs');
  }

  // Required implementations from ChunkedParser

  getSupportedExtensions(): string[] {
    return ['.cs', '.tscn', '.godot'];
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    // For .cs files, this will be handled by the C# parser
    // For .tscn files, symbols are extracted as framework entities
    return [];
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    // For .cs files, this will be handled by the C# parser
    // For .tscn files, dependencies are scene/script relationships
    return [];
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    // Godot doesn't have traditional imports like other languages
    return [];
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    // Godot exports are handled as framework entities
    return [];
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const boundaries: number[] = [];
    // Search within 85% of max size for safe boundaries
    const searchLimit = Math.floor(maxChunkSize * 0.85);
    const searchContent = content.substring(0, Math.min(searchLimit, content.length));

    // Godot-specific boundary patterns
    const boundaryPatterns = [
      // Scene section boundaries
      /^\[(?:gd_scene|ext_resource|node|connection)\]/gm,
      // Node declarations
      /^\[node\s+name="[^"]+"\]/gm,
      // Script boundaries in C# files
      /^\s*(?:public\s+|private\s+)?class\s+\w+/gm,
      /^\s*namespace\s+\w+/gm,
      // End of methods/classes
      /^\s*}\s*$/gm
    ];

    for (const pattern of boundaryPatterns) {
      let match;
      pattern.lastIndex = 0; // Reset regex state

      while ((match = pattern.exec(searchContent)) !== null) {
        const position = match.index + match[0].length;

        if (position > maxChunkSize * 0.3 && position < searchLimit) {
          boundaries.push(position);
        }

        // Prevent infinite loops
        if (pattern.lastIndex === match.index) {
          pattern.lastIndex++;
        }
      }
    }

    return [...new Set(boundaries)].sort((a, b) => a - b);
  }

  protected mergeChunkResults(chunks: ParseResult[], chunkMetadata: ChunkResult[]): MergedParseResult {
    const allSymbols: ParsedSymbol[] = [];
    const allDependencies: ParsedDependency[] = [];
    const allImports: ParsedImport[] = [];
    const allExports: ParsedExport[] = [];
    const allErrors: ParseError[] = [];

    // Collect all results
    for (const chunk of chunks) {
      allSymbols.push(...chunk.symbols);
      allDependencies.push(...chunk.dependencies);
      allImports.push(...chunk.imports);
      allExports.push(...chunk.exports);
      allErrors.push(...chunk.errors);
    }

    // Remove duplicates using inherited methods
    const uniqueSymbols = this.removeDuplicateSymbols(allSymbols);
    const uniqueDependencies = this.removeDuplicateDependencies(allDependencies);

    return {
      symbols: uniqueSymbols,
      dependencies: uniqueDependencies,
      imports: allImports,
      exports: allExports,
      errors: allErrors,
      chunksProcessed: chunks.length,
      metadata: {
        totalChunks: chunkMetadata.length,
        duplicatesRemoved: (allSymbols.length - uniqueSymbols.length) +
                          (allDependencies.length - uniqueDependencies.length),
        crossChunkReferencesFound: 0
      }
    };
  }
}