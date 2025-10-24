import Parser from 'tree-sitter';
import { ParsedSymbol } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { SymbolType, Visibility } from '../../database/models';
import { entityClassifier } from '../../utils/entity-classifier';
import { extractFunctionSignature, buildArrowFunctionSignature, extractModifiers, buildMethodSignature, buildVariableSignature } from './signature-utils';
import { TraversalCallbacks } from './types';

export interface SymbolExtractorCallbacks extends TraversalCallbacks {
  extractJSDocComment: (node: Parser.SyntaxNode, content: string) => string | undefined;
  isSymbolExported: (node: Parser.SyntaxNode, name: string, content: string) => boolean;
}

export function extractFunctionSymbol(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = callbacks.getNodeText(nameNode, content);
  const signature = extractFunctionSignature(node, content, callbacks.getNodeText);
  const description = callbacks.extractJSDocComment(node, content);

  const frameworkContext = options?.frameworkContext?.framework;

  const classification = entityClassifier.classify(
    'function',
    name,
    [],
    filePath || '',
    frameworkContext,
    undefined,
    options?.repositoryFrameworks
  );

  const isExported = callbacks.isSymbolExported(node, name, content);

  let entityType = classification.entityType;
  if (
    frameworkContext === 'vue' &&
    classification.entityType === 'composable' &&
    !isExported
  ) {
    entityType = 'function';
  }

  return {
    name,
    symbol_type: SymbolType.FUNCTION,
    entity_type: entityType,
    base_class: classification.baseClass || undefined,
    framework: classification.framework,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: isExported,
    signature,
    description,
  };
}

export function extractVariableSymbol(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  const valueNode = node.childForFieldName('value');

  if (!nameNode) return null;

  const name = callbacks.getNodeText(nameNode, content);
  let symbolType = SymbolType.VARIABLE;
  let signature: string | undefined;

  if (valueNode) {
    if (valueNode.type === 'arrow_function') {
      symbolType = SymbolType.FUNCTION;
    } else if (valueNode.type === 'function_expression') {
      symbolType = SymbolType.FUNCTION;
    }
    signature = buildVariableSignature(valueNode, content, callbacks.getNodeText);
  }

  const parent = node.parent;
  if (parent && parent.type === 'variable_declaration') {
    const kind = parent.childForFieldName('kind');
    if (kind && callbacks.getNodeText(kind, content) === 'const') {
      symbolType = SymbolType.CONSTANT;
    }
  }

  const description = callbacks.extractJSDocComment(node, content);

  const frameworkContext = options?.frameworkContext?.framework;

  const classification = entityClassifier.classify(
    symbolType === SymbolType.FUNCTION ? 'function' : 'variable',
    name,
    [],
    filePath || '',
    frameworkContext,
    undefined,
    options?.repositoryFrameworks
  );

  let entityType = classification.entityType;
  if (
    frameworkContext === 'vue' &&
    signature &&
    signature.includes('defineStore(')
  ) {
    entityType = 'store';
  }

  const isExported = callbacks.isSymbolExported(node, name, content);

  if (
    frameworkContext === 'vue' &&
    classification.entityType === 'composable' &&
    !isExported
  ) {
    entityType = 'function';
  }

  return {
    name,
    symbol_type: symbolType,
    entity_type: entityType,
    framework: classification.framework,
    base_class: classification.baseClass || undefined,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: isExported,
    signature,
    description,
  };
}

export function extractClassSymbol(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = callbacks.getNodeText(nameNode, content);
  const description = callbacks.extractJSDocComment(node, content);

  const baseClasses: string[] = [];
  const heritageNode = node.childForFieldName('heritage');
  if (heritageNode) {
    const baseClassName = callbacks.getNodeText(heritageNode, content).replace(/^extends\s+/, '').trim();
    if (baseClassName) {
      baseClasses.push(baseClassName);
    }
  }

  const frameworkContext = options?.frameworkContext?.framework;

  const classification = entityClassifier.classify(
    'class',
    name,
    baseClasses,
    filePath || '',
    frameworkContext,
    undefined,
    options?.repositoryFrameworks
  );

  return {
    name,
    symbol_type: SymbolType.CLASS,
    entity_type: classification.entityType,
    base_class: classification.baseClass || undefined,
    framework: classification.framework,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: callbacks.isSymbolExported(node, name, content),
    description,
  };
}

export function extractMethodSymbol(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): ParsedSymbol | null {
  if (node.type !== 'method_definition') {
    return null;
  }

  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = callbacks.getNodeText(nameNode, content);
  if (name === 'constructor') {
    return null;
  }

  const modifiers = extractModifiers(node);
  const paramsNode = node.childForFieldName('parameters');
  const params = paramsNode ? callbacks.getNodeText(paramsNode, content) : '()';
  const signature = buildMethodSignature(name, modifiers, params);
  const description = callbacks.extractJSDocComment(node, content);

  let visibility: Visibility | undefined;
  if (name.startsWith('#')) {
    visibility = Visibility.PRIVATE;
  } else if (name.startsWith('_')) {
    visibility = Visibility.PRIVATE;
  }

  const frameworkContext = options?.frameworkContext?.framework;

  const classification = entityClassifier.classify(
    'method',
    name,
    [],
    filePath || '',
    frameworkContext,
    undefined,
    options?.repositoryFrameworks
  );

  return {
    name,
    symbol_type: SymbolType.METHOD,
    entity_type: classification.entityType,
    framework: classification.framework,
    base_class: classification.baseClass || undefined,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: false,
    visibility,
    signature,
    description,
  };
}

export function extractArrowFunctionSymbol(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): ParsedSymbol | null {
  const frameworkContext = options?.frameworkContext?.framework;

  const classification = entityClassifier.classify(
    'function',
    'arrow_function',
    [],
    filePath || '',
    frameworkContext,
    undefined,
    options?.repositoryFrameworks
  );

  return {
    name: 'arrow_function',
    symbol_type: SymbolType.FUNCTION,
    entity_type: classification.entityType,
    framework: classification.framework,
    base_class: classification.baseClass || undefined,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: false,
    visibility: Visibility.PRIVATE,
    signature: buildArrowFunctionSignature(node, content, callbacks.getNodeText),
  };
}
