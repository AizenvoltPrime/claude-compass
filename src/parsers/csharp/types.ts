import Parser from 'tree-sitter';
import { Visibility } from '../../database/models';
import { ParsedSymbol } from '../base';
import { FrameworkParseOptions } from '../base-framework';

/**
 * Type information with complete context
 */
export interface TypeInfo {
  type: string;
  fullQualifiedName: string;
  source: 'field' | 'property' | 'variable' | 'parameter' | 'method';
  declarationLine?: number;
  namespace?: string;
  genericArgs?: string[];
}

/**
 * Method information for enhanced resolution
 */
export interface MethodInfo {
  name: string;
  className: string;
  returnType: string;
  parameters: ParameterInfo[];
  isStatic: boolean;
  visibility: Visibility;
  line: number;
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type: string;
  defaultValue?: string;
  isRef?: boolean;
  isOut?: boolean;
  isParams?: boolean;
}

/**
 * AST context for efficient traversal
 */
export interface ASTContext {
  typeMap: Map<string, TypeInfo>;
  methodMap: Map<string, MethodInfo[]>;
  namespaceStack: string[];
  classStack: string[];
  currentNamespace?: string;
  currentClass?: string;
  currentClassFramework?: string; // Track framework of current class for method inheritance
  usingDirectives: Set<string>;
  symbolCache: Map<string, ParsedSymbol>;
  nodeCache: Map<string, Parser.SyntaxNode[]>;
  partialClassFields: Map<string, Map<string, TypeInfo>>;
  isPartialClass: boolean;
  currentMethodParameters: Map<string, string>;
  filePath?: string; // File path for entity classification
  options?: FrameworkParseOptions; // Parse options including repository frameworks
}

/**
 * Godot integration context
 */
export interface GodotContext {
  signals: Map<string, SignalInfo>;
  exports: Map<string, ExportInfo>;
  nodePaths: Set<string>;
  autoloads: Set<string>;
  sceneReferences: Set<string>;
}

export interface SignalInfo {
  name: string;
  parameters: string[];
  emitters: string[];
}

export interface ExportInfo {
  name: string;
  type: string;
  exportType?: string;
  defaultValue?: any;
}

export interface StructuralContext {
  type: 'class' | 'interface' | 'namespace';
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  namespace?: string;
  parentClass?: string;
}

export interface MethodCall {
  methodName: string;
  callingObject: string;
  resolvedClass?: string;
  parameters: string[];
  parameterTypes: string[];
  fullyQualifiedName: string;
}

/**
 * Pre-compiled regex patterns for performance
 */
export const PATTERNS = {
  // Method patterns
  methodCall: /(\w+)\s*\(/g,
  qualifiedCall: /(\w+)\.(\w+)\s*\(/g,
  conditionalAccess: /([_\w]+)\?\s*\.?\s*([_\w]+)\s*\(/g,
  memberAccess: /([_\w]+)\.([_\w]+)\s*\(/g,
  fieldAccess: /([_\w]+)\s*\(/g,

  // Godot patterns
  godotSignal: /\[Signal\]\s*(?:public\s+)?delegate\s+\w+\s+(\w+)\s*\(([^)]*)\)/g,
  godotExport: /\[Export(?:\(([^)]+)\))?\]\s*(?:public\s+)?(\w+)\s+(\w+)/g,
  godotNode: /GetNode(?:<(\w+)>)?\s*\(\s*["']([^"']+)["']\s*\)/g,
  godotAutoload: /GetNode<(\w+)>\s*\(\s*["']\/root\/(\w+)["']\s*\)/g,
  emitSignal: /EmitSignal\s*\(\s*(?:nameof\s*\()?["']?(\w+)/g,

  // Type patterns
  genericType: /^([^<]+)<(.+)>$/,
  interfacePrefix: /^I[A-Z]/,

  // Class patterns
  classDeclaration:
    /(?:public\s+|private\s+|internal\s+)?(?:partial\s+)?(?:static\s+)?(?:abstract\s+)?(?:sealed\s+)?class\s+(\w+)(?:\s*:\s*([^{]+))?/g,
  interfaceDeclaration:
    /(?:public\s+|private\s+|internal\s+)?interface\s+(\w+)(?:\s*:\s*([^{]+))?/g,
} as const;

/**
 * C# modifier keywords
 */
export const MODIFIER_KEYWORDS = new Set([
  'public',
  'private',
  'protected',
  'internal',
  'static',
  'partial',
  'abstract',
  'sealed',
  'virtual',
  'override',
  'readonly',
  'async',
  'const',
  'new',
  'extern',
  'unsafe',
  'volatile',
]);

/**
 * Godot engine base classes
 */
export const GODOT_BASE_CLASSES = new Set([
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
]);

/**
 * Godot lifecycle methods
 */
export const GODOT_LIFECYCLE_METHODS = new Set([
  '_Ready',
  '_EnterTree',
  '_ExitTree',
  '_Process',
  '_PhysicsProcess',
  '_Input',
  '_UnhandledInput',
  '_UnhandledKeyInput',
  '_Draw',
  '_Notification',
  '_GetPropertyList',
  '_PropertyCanRevert',
]);
