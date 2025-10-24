import Parser from 'tree-sitter';
import { ParsedSymbol } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { SymbolType, Visibility } from '../../database/models';
import { entityClassifier } from '../../utils/entity-classifier';
import { PHPParsingContext } from './types';
import {
  extractPhpDocComment,
  buildQualifiedName,
  extractClassSignature,
  extractFunctionSignature,
  extractModifiers,
  buildMethodSignature,
  extractVisibility,
  extractBaseClasses
} from './';

export function extractNamespaceSymbol(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const description = extractPhpDocComment(node, content, getNodeText);

  return {
    name,
    symbol_type: SymbolType.NAMESPACE,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    description,
  };
}

export function extractClassSymbol(
  node: Parser.SyntaxNode,
  content: string,
  context: { currentNamespace: string | null; currentClass: string | null; filePath?: string; options?: FrameworkParseOptions },
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const signature = extractClassSignature(node, content, getNodeText);
  const description = extractPhpDocComment(node, content, getNodeText);
  const qualifiedName = buildQualifiedName(context, name);

  const baseClasses = extractBaseClasses(node, content, getNodeText);

  const frameworkContext = (context.options as any)?.frameworkContext?.framework;
  const classification = entityClassifier.classify(
    'class',
    name,
    baseClasses,
    context.filePath || '',
    frameworkContext,
    context.currentNamespace || undefined,
    context.options?.repositoryFrameworks
  );

  return {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.CLASS,
    entity_type: classification.entityType,
    base_class: classification.baseClass || undefined,
    framework: classification.framework,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    signature,
    description,
  };
}

export function extractInterfaceSymbol(
  node: Parser.SyntaxNode,
  content: string,
  context: { currentNamespace: string | null; currentClass: string | null },
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const description = extractPhpDocComment(node, content, getNodeText);
  const qualifiedName = buildQualifiedName(context, name);

  return {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.INTERFACE,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    description,
  };
}

export function extractTraitSymbol(
  node: Parser.SyntaxNode,
  content: string,
  context: { currentNamespace: string | null; currentClass: string | null },
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const description = extractPhpDocComment(node, content, getNodeText);
  const qualifiedName = buildQualifiedName(context, name);

  return {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.TRAIT,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    description,
  };
}

export function extractFunctionSymbol(
  node: Parser.SyntaxNode,
  content: string,
  context: { currentNamespace: string | null; currentClass: string | null },
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedSymbol | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const signature = extractFunctionSignature(node, content, getNodeText);
  const description = extractPhpDocComment(node, content, getNodeText);
  const qualifiedName = buildQualifiedName(context, name);

  return {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.FUNCTION,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: true,
    visibility: Visibility.PUBLIC,
    signature,
    description,
  };
}

export function extractMethodSymbol(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol | null {
  if (node.type !== 'method_declaration') {
    return null;
  }

  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);
  const modifiers = extractModifiers(node);
  const paramsNode = node.childForFieldName('parameters');
  const params = paramsNode ? getNodeText(paramsNode, content) : '()';
  const returnTypeNode = node.childForFieldName('return_type');
  const returnType = returnTypeNode ? getNodeText(returnTypeNode, content) : null;
  const signature = buildMethodSignature(name, modifiers, params, returnType);
  const visibility = extractVisibility(node, content, getNodeText, findNodesOfType);
  const description = extractPhpDocComment(node, content, getNodeText);

  let qualifiedName: string | undefined;
  if (context.currentClass) {
    const classQualifiedName = buildQualifiedName(context, context.currentClass);
    qualifiedName = `${classQualifiedName}::${name}`;
  }

  const frameworkContext = (context.options as any)?.frameworkContext?.framework;
  const classification = entityClassifier.classify(
    'method',
    name,
    context.parentClass ? [context.parentClass] : [],
    context.filePath,
    frameworkContext,
    context.currentNamespace || undefined,
    context.options?.repositoryFrameworks
  );

  return {
    name,
    qualified_name: qualifiedName,
    symbol_type: SymbolType.METHOD,
    entity_type: classification.entityType,
    framework: classification.framework,
    base_class: classification.baseClass || undefined,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    is_exported: visibility === Visibility.PUBLIC,
    visibility,
    signature,
    description,
  };
}

export function extractPropertySymbols(
  node: Parser.SyntaxNode,
  content: string,
  context: PHPParsingContext,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const visibility = extractVisibility(node, content, getNodeText, findNodesOfType);
  const description = extractPhpDocComment(node, content, getNodeText);

  const propertyElements = findNodesOfType(node, 'property_element');
  for (const element of propertyElements) {
    const nameNode = element.childForFieldName('name');
    if (nameNode) {
      const name = getNodeText(nameNode, content);
      const cleanName = name.replace('$', '');

      const frameworkContext = (context.options as any)?.frameworkContext?.framework;
      const classification = entityClassifier.classify(
        'property',
        cleanName,
        context.parentClass ? [context.parentClass] : [],
        context.filePath,
        frameworkContext,
        context.currentNamespace || undefined,
        context.options?.repositoryFrameworks
      );

      symbols.push({
        name: cleanName,
        symbol_type: SymbolType.PROPERTY,
        entity_type: classification.entityType,
        framework: classification.framework,
        base_class: classification.baseClass || undefined,
        start_line: element.startPosition.row + 1,
        end_line: element.endPosition.row + 1,
        is_exported: visibility === Visibility.PUBLIC,
        visibility,
        description,
      });
    }
  }

  return symbols;
}

export function extractConstantSymbols(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];
  const description = extractPhpDocComment(node, content, getNodeText);

  const constElements = findNodesOfType(node, 'const_element');
  for (const element of constElements) {
    const nameNode = element.childForFieldName('name');
    if (nameNode) {
      const name = getNodeText(nameNode, content);
      symbols.push({
        name,
        symbol_type: SymbolType.CONSTANT,
        start_line: element.startPosition.row + 1,
        end_line: element.endPosition.row + 1,
        is_exported: true,
        visibility: Visibility.PUBLIC,
        description,
      });
    }
  }

  return symbols;
}
