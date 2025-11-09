import Parser from 'tree-sitter';
const CSharp: Parser.Language = require('tree-sitter-c-sharp');
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
  ParseOptions,
} from './base';
import {
  MergedParseResult,
  ChunkResult,
} from './chunked-parser';
import { DependencyType, SymbolType } from '../database/models';
import { createComponentLogger } from '../utils/logger';
import { CSharpParser } from './csharp';
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
}

/**
 * Godot node within a scene
 */
export interface GodotNode extends FrameworkEntity {
  type: 'godot_node';
  nodeType: string;
  nodeName: string;
  parent?: string;
  parentPath?: string;
  children: string[];
  script?: string;
  instanceScene?: string;
  properties: Record<string, any>;
  framework: 'godot';
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
  private csharpParser: CSharpParser;

  constructor(parser: Parser) {
    super(parser, 'godot');

    // Create C# parser instance for handling Godot C# scripts
    // This gives us full C# parsing with CONTAINS dependencies built-in
    this.csharpParser = new CSharpParser();
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
        description: 'Godot project configuration file',
      },
      {
        name: 'godot-scene',
        pattern: /\[gd_scene\s+load_steps=\d+\s+format=\d+\]/,
        fileExtensions: ['.tscn'],
        description: 'Godot scene file',
      },
      {
        name: 'godot-csharp-script',
        pattern: /using\s+Godot|extends\s+(Node|Node2D|Node3D|Control|Area2D|Area3D|RigidBody2D|RigidBody3D|CharacterBody2D|CharacterBody3D|Resource|RefCounted)\b|class\s+\w+\s*:\s*(Node|Node2D|Node3D|Control|Area2D|Area3D|RigidBody2D|RigidBody3D|CharacterBody2D|CharacterBody3D|Resource|RefCounted)\b/,
        fileExtensions: ['.cs'],
        description: 'C# script extending Godot classes',
      },
      {
        name: 'godot-export-attribute',
        pattern: /\[Export\]|\[Export\s*\(|\[Signal\]/,
        fileExtensions: ['.cs'],
        description: 'Godot C# export attributes',
      },
      {
        name: 'godot-api-calls',
        pattern: /GD\.Print|GetNode|EmitSignal|CallDeferred|AddChild|QueueFree/,
        fileExtensions: ['.cs'],
        description: 'Godot C# API calls',
      },
      {
        name: 'godot-input-handling',
        pattern: /_Ready\s*\(|_Process\s*\(|_PhysicsProcess\s*\(|_Input\s*\(/,
        fileExtensions: ['.cs'],
        description: 'Godot C# lifecycle methods',
      },
      {
        name: 'godot-node-types',
        pattern: /Node2D|Node3D|Area2D|Area3D|CollisionShape2D|CollisionShape3D|Sprite2D|Sprite3D|Camera2D|Camera3D/,
        fileExtensions: ['.cs', '.tscn'],
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
        const scene = await this.parseGodotScene(content, filePath, options);
        if (scene) {
          entities.push(scene);
          // Add individual nodes as entities
          entities.push(...scene.nodes);
        }
      } else if (filePath.endsWith('.cs') && this.isGodotScript(content)) {
        // Parse Godot C# script
        const script = await this.parseGodotScript(content, filePath, options);
        if (script) {
          entities.push(script);
        }
      } else if (filePath.endsWith('project.godot')) {
        // Parse project configuration for autoloads
        const autoloads = await this.parseGodotProject(content, filePath, options);
        entities.push(...autoloads);
      }


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

      const extResources = new Map<string, string>();
      const projectRoot = await this.findGodotProjectRoot(filePath);

      // Parse scene file format
      const lines = content.split('\n');
      let currentSection: string | null = null;
      let currentNode: Partial<GodotNode> | null = null;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        const lineNumber = lineIndex + 1;

        // Parse section headers
        if (trimmed.startsWith('[')) {
          if (currentNode && currentSection === 'node') {
            nodes.push(currentNode as GodotNode);
            currentNode = null;
          }

          const sectionMatch = trimmed.match(/\[(\w+)(?:\s+([^\]]+))?\]/);
          if (sectionMatch) {
            currentSection = sectionMatch[1];

            if (currentSection === 'ext_resource') {
              const extResourceMatch = trimmed.match(/\[ext_resource[^\]]*path="([^"]+)"[^\]]*id="([^"]+)"/);
              if (extResourceMatch) {
                const [, resourcePath, resourceId] = extResourceMatch;
                extResources.set(resourceId, resourcePath);
              }
            } else if (currentSection === 'node') {
              const nodeParams = this.parseNodeParams(sectionMatch[2] || '');
              currentNode = {
                type: 'godot_node',
                name: nodeParams.name || 'Unknown',
                filePath,
                metadata: {
                  line: lineNumber
                },
                nodeType: nodeParams.type || 'Node',
                nodeName: nodeParams.name || 'Unknown',
                parent: nodeParams.parent,
                parentPath: nodeParams.parentPath,
                children: [],
                properties: {},
                framework: 'godot',
              };

              if (nodeParams.instance) {
                const instancePath = extResources.get(nodeParams.instance);
                if (instancePath && projectRoot) {
                  currentNode.instanceScene = this.convertGodotPathToAbsolute(instancePath, projectRoot);
                } else if (instancePath) {
                  currentNode.instanceScene = instancePath;
                }
              }
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
              const resourceId = this.extractResourcePath(value);
              const godotPath = extResources.get(resourceId);

              if (godotPath && projectRoot) {
                currentNode.script = this.convertGodotPathToAbsolute(godotPath, projectRoot);
              } else if (godotPath) {
                currentNode.script = godotPath;
              } else {
                currentNode.script = resourceId;
              }
            }
          }
        }
      }

      if (currentNode && currentSection === 'node') {
        nodes.push(currentNode as GodotNode);
      }

      this.buildNodeHierarchy(nodes);

      const rootNode = nodes.find(node => !node.parent);
      const nodesWithParents = nodes.filter(node => node.parent);
      const nodesWithScripts = nodes.filter(node => node.script);

      logger.debug('Godot scene parsed', {
        filePath,
        sceneName,
        totalNodes: nodes.length,
        rootNode: rootNode?.nodeName,
        nodesWithParents: nodesWithParents.length,
        nodesWithScripts: nodesWithScripts.length,
        nodeTypes: [...new Set(nodes.map(n => n.nodeType))],
        parentReferences: [...new Set(nodesWithParents.map(n => n.parent))],
      });

      const scene: GodotScene = {
        type: 'godot_scene',
        name: sceneName,
        filePath,
        metadata: {
          nodeCount: nodes.length,
          hasScript: nodes.some(node => node.script),
          line: 1
        },
        scenePath: filePath,
        rootNode,
        nodes,
        resources,
        connections,
        framework: 'godot',
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

  private parseNodeParams(params: string): { name?: string; type?: string; parent?: string; parentPath?: string; instance?: string } {
    const result: { name?: string; type?: string; parent?: string; parentPath?: string; instance?: string } = {};

    const nameMatch = params.match(/name="([^"]+)"/);
    if (nameMatch) result.name = nameMatch[1];

    const typeMatch = params.match(/type="([^"]+)"/);
    if (typeMatch) result.type = typeMatch[1];

    const parentMatch = params.match(/parent="([^"]+)"/);
    if (parentMatch) {
      const parentPath = parentMatch[1];
      const isSceneRoot = parentPath === '.';
      if (!isSceneRoot) {
        result.parentPath = parentPath;
        result.parent = parentPath.split('/').pop();
      }
    }

    const instanceMatch = params.match(/instance[=\s]*ExtResource\s*\(\s*"([^"]+)"\s*\)/);
    if (instanceMatch) result.instance = instanceMatch[1];

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

  private extractGodotDependencies(content: string, symbols: ParsedSymbol[]): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const lineNumber = i + 1;

      let combinedLine = line;
      let lookAhead = 1;
      while (i + lookAhead < lines.length && lookAhead <= 3 && line.includes('.Connect(')) {
        combinedLine += ' ' + lines[i + lookAhead].trim();
        if (combinedLine.includes(');')) break;
        lookAhead++;
      }

      const connectMatch = combinedLine.match(/\.Connect\s*\(\s*(?:[\w.]+\.)?SignalName\.(\w+)\s*,\s*new\s+Callable\s*\(\s*this\s*,\s*(?:MethodName\.(\w+)|nameof\((\w+)\))\s*\)\s*\)/);
      if (connectMatch) {
        const signalName = connectMatch[1];
        const methodName = connectMatch[2] || connectMatch[3];
        const containingMethod = this.findContainingMethod(symbols, lineNumber);

        if (containingMethod && methodName) {
          dependencies.push({
            from_symbol: containingMethod,
            to_symbol: methodName,
            dependency_type: DependencyType.SIGNAL_CONNECTION,
            line_number: lineNumber,
          });
        }
      }

      const emitMatch = line.match(/EmitSignal\s*\(\s*SignalName\.(\w+)/);
      if (emitMatch) {
        const signalName = emitMatch[1];
        const containingMethod = this.findContainingMethod(symbols, lineNumber);

        if (containingMethod) {
          dependencies.push({
            from_symbol: containingMethod,
            to_symbol: `signal:${signalName}`,
            dependency_type: DependencyType.SIGNAL_CONNECTION,
            line_number: lineNumber,
          });
        }
      }

      const sceneLoadMatch = line.match(/(?:GD\.Load|ResourceLoader\.Load)\s*<\s*PackedScene\s*>\s*\(\s*"(res:\/\/[^"]+\.tscn)"\s*\)/);
      if (sceneLoadMatch) {
        const scenePath = sceneLoadMatch[1];
        const containingMethod = this.findContainingMethod(symbols, lineNumber);

        if (containingMethod) {
          dependencies.push({
            from_symbol: containingMethod,
            to_symbol: scenePath,
            dependency_type: DependencyType.REFERENCES,
            line_number: lineNumber,
          });
        }
      }
    }

    return dependencies;
  }

  private findContainingMethod(symbols: ParsedSymbol[], lineNumber: number): string | undefined {
    for (const symbol of symbols) {
      if (
        symbol.symbol_type === SymbolType.METHOD &&
        symbol.start_line &&
        symbol.end_line &&
        lineNumber >= symbol.start_line &&
        lineNumber <= symbol.end_line
      ) {
        return symbol.name;
      }
    }
    return undefined;
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

  private async findGodotProjectRoot(filePath: string): Promise<string | null> {
    let currentDir = path.dirname(filePath);
    const maxDepth = 10;
    let depth = 0;

    while (depth < maxDepth) {
      try {
        const projectGodotPath = path.join(currentDir, 'project.godot');
        await fs.access(projectGodotPath);
        return currentDir;
      } catch {
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
        depth++;
      }
    }

    return null;
  }

  private convertGodotPathToAbsolute(godotPath: string, projectRoot: string): string {
    const relativePath = godotPath.replace(/^res:\/\//, '');
    return path.join(projectRoot, relativePath);
  }

  // Override parseFile to handle Godot-specific files

  async parseFile(filePath: string, content: string, options?: FrameworkParseOptions): Promise<ParseFileResult> {
    const validatedOptions = this.validateOptions(options);

    try {
      // For .tscn and .godot files, use framework entity detection
      if (filePath.endsWith('.tscn') || filePath.endsWith('.godot')) {
        const frameworkResult = await this.detectFrameworkEntities(
          content,
          filePath,
          validatedOptions as FrameworkParseOptions
        );

        // Extract dependencies for .tscn files using file path context
        const dependencies = filePath.endsWith('.tscn')
          ? this.extractTscnDependencies(content, filePath)
          : [];

        return {
          filePath,
          symbols: [],
          dependencies,
          imports: [],
          exports: [],
          errors: [],
          frameworkEntities: frameworkResult.entities,
          success: true
        };
      }

      // For ALL C# files, delegate to C# parser for proper parsing
      if (filePath.endsWith('.cs')) {
        // Delegate to CSharpParser for full C# parsing with CONTAINS dependencies
        const csharpResult = await this.csharpParser.parseFile(filePath, content, validatedOptions);

        // Check if this is a Godot script (has Godot-specific patterns)
        const isGodot = this.isGodotScript(content);

        if (isGodot) {
          // Add Godot-specific framework entities (nodes, signals, exports)
          const frameworkResult = await this.detectFrameworkEntities(
            content,
            filePath,
            validatedOptions as FrameworkParseOptions
          );

          // Extract Godot-specific dependencies (signals, scene instantiation)
          const godotDependencies = this.extractGodotDependencies(content, csharpResult.symbols);

          // Merge C# parse results with Godot framework entities and Godot dependencies
          // Override framework field to 'godot' for all symbols since this is a Godot script
          const godotSymbols = csharpResult.symbols.map(symbol => ({
            ...symbol,
            framework: 'godot' as const
          }));

          return {
            filePath,
            symbols: godotSymbols,
            dependencies: [...csharpResult.dependencies, ...godotDependencies],
            imports: csharpResult.imports,
            exports: csharpResult.exports,
            errors: csharpResult.errors,
            frameworkEntities: frameworkResult.entities,
            success: true
          };
        } else {
          // Plain C# file without Godot patterns - return C# parse results as-is
          // Symbols already have framework='csharp' from entity classifier
          return {
            filePath,
            symbols: csharpResult.symbols,
            dependencies: csharpResult.dependencies,
            imports: csharpResult.imports,
            exports: csharpResult.exports,
            errors: csharpResult.errors,
            frameworkEntities: [],
            success: true
          };
        }
      }

      // Fallback to base implementation for non-C# files
      return super.parseFile(filePath, content, options);

    } catch (error) {
      logger.error('Godot parsing failed', {
        filePath,
        error: (error as Error).message
      });

      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: `Godot parsing failed: ${(error as Error).message}`,
          line: 1,
          column: 1,
          severity: 'error'
        }]
      };
    }
  }

  // Required implementations from ChunkedParser

  getSupportedExtensions(): string[] {
    return ['.tscn', '.godot'];
  }

  /**
   * Symbol extraction is not performed by this parser.
   * C# files are handled by CSharpParser, and .tscn files generate framework entities.
   */
  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    return [];
  }

  /**
   * Extract dependencies specifically for .tscn files with file path context
   */
  private extractTscnDependencies(content: string, filePath: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    if (content.includes('[gd_scene') || content.includes('[gd_resource')) {
      const extResources = new Map<string, string>();
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const extResourceMatch = line.match(/\[ext_resource[^\]]*path="([^"]+)"[^\]]*id="([^"]+)"/);
        if (extResourceMatch) {
          const [, resourcePath, resourceId] = extResourceMatch;
          extResources.set(resourceId, resourcePath);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.includes('script = ExtResource')) {
          const scriptMatch = line.match(/script = ExtResource\s*\(\s*"([^"]+)"\s*\)/);
          if (scriptMatch) {
            const resourceId = scriptMatch[1];
            const scriptPath = extResources.get(resourceId);

            if (scriptPath) {
              dependencies.push({
                from_symbol: filePath,
                to_symbol: scriptPath,
                dependency_type: DependencyType.REFERENCES,
                line_number: i + 1
              });
            }
          }
        }


        const resourceRefMatch = line.match(/ExtResource\s*\(\s*"([^"]+)"\s*\)/);
        if (resourceRefMatch && !line.includes('script =') && !line.includes('instance =')) {
          const resourceId = resourceRefMatch[1];
          const resourcePath = extResources.get(resourceId);

          if (resourcePath) {
            dependencies.push({
              from_symbol: filePath,
              to_symbol: resourcePath,
              dependency_type: DependencyType.REFERENCES,
              line_number: i + 1
            });
          }
        }
      }
    }

    return dependencies;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    // This method is kept for compatibility with C# files
    // For .tscn files, we use extractTscnDependencies which has access to filePath
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