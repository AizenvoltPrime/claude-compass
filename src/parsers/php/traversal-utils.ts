import Parser from 'tree-sitter';
import {
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
} from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { PHPParsingContext } from './types';
import {
  extractPhpDocComment,
  extractParentClass,
  trackPropertyTypes,
  trackConstructorParameterTypes,
  trackPropertyAssignment,
  extractNamespaceSymbol,
  extractClassSymbol,
  extractInterfaceSymbol,
  extractTraitSymbol,
  extractFunctionSymbol,
  extractAnonymousFunctionSymbol,
  extractMethodSymbol,
  extractPropertySymbols,
  extractConstantSymbols,
  extractCallDependency,
  extractMethodCallDependency,
  extractNewDependency,
  extractScopedCallDependency,
  extractConstructorDependencies,
  extractMethodTypeDependencies,
  extractRelationshipDefinition,
  extractUseStatement,
  findIncludeStatements,
  extractNamedExport,
  convertUseStatementsToDependencies,
  extractContainmentDependencies,
} from './';

export interface TraversalCallbacks {
  cacheNode: (type: string, node: Parser.SyntaxNode) => void;
  getNodeText: (node: Parser.SyntaxNode, content: string) => string;
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[];
}

export interface TraversalResult {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: ParsedImport[];
  exports: ParsedExport[];
}

/**
 * Perform single-pass extraction of symbols, dependencies, imports, and exports from PHP AST
 */
export function performSinglePassExtraction(
  rootNode: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: TraversalCallbacks
): TraversalResult {
  const symbols: ParsedSymbol[] = [];
  const dependencies: ParsedDependency[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];

  const context: PHPParsingContext = {
    currentNamespace: null,
    currentClass: null,
    typeMap: new Map<string, string>(),
    parentClass: null,
    filePath: filePath || '',
    useStatements: [],
    options: options,
    // Use shared registry if provided, otherwise create new empty one
    relationshipRegistry:
      options?.eloquentRelationshipRegistry || new Map<string, Map<string, string>>(),
  };

  const traverse = (node: Parser.SyntaxNode): void => {
    callbacks.cacheNode(node.type, node);

    switch (node.type) {
      case 'namespace_definition': {
        const symbol = extractNamespaceSymbol(node, content, callbacks.getNodeText);
        if (symbol) {
          symbols.push(symbol);
          context.currentNamespace = symbol.name;
        }
        break;
      }
      case 'class_declaration': {
        const symbol = extractClassSymbol(node, content, context, callbacks.getNodeText);
        if (symbol) {
          symbols.push(symbol);
          const previousClass = context.currentClass;
          const previousParent = context.parentClass;
          context.currentClass = symbol.name;
          context.parentClass = extractParentClass(node, content, callbacks.getNodeText);

          for (const child of node.children) {
            traverse(child);
          }

          context.currentClass = previousClass;
          context.parentClass = previousParent;

          const exportInfo = extractNamedExport(node, content, callbacks.getNodeText);
          if (exportInfo) exports.push(exportInfo);
        }
        return;
      }
      case 'interface_declaration': {
        const symbol = extractInterfaceSymbol(
          node,
          content,
          context,
          callbacks.getNodeText
        );
        if (symbol) {
          symbols.push(symbol);
          const previousClass = context.currentClass;
          context.currentClass = symbol.name;

          for (const child of node.children) {
            traverse(child);
          }

          context.currentClass = previousClass;

          const exportInfo = extractNamedExport(node, content, callbacks.getNodeText);
          if (exportInfo) exports.push(exportInfo);
        }
        return;
      }
      case 'trait_declaration': {
        const symbol = extractTraitSymbol(node, content, context, callbacks.getNodeText);
        if (symbol) {
          symbols.push(symbol);
          const previousClass = context.currentClass;
          context.currentClass = symbol.name;

          for (const child of node.children) {
            traverse(child);
          }

          context.currentClass = previousClass;

          const exportInfo = extractNamedExport(node, content, callbacks.getNodeText);
          if (exportInfo) exports.push(exportInfo);
        }
        return;
      }
      case 'function_definition': {
        const symbol = extractFunctionSymbol(node, content, context, callbacks.getNodeText);
        if (symbol) {
          symbols.push(symbol);
          const exportInfo = extractNamedExport(node, content, callbacks.getNodeText);
          if (exportInfo) exports.push(exportInfo);

          const typeDeps = extractMethodTypeDependencies(
            node,
            content,
            context,
            callbacks.getNodeText
          );
          dependencies.push(...typeDeps);
        }
        break;
      }
      case 'anonymous_function':
      case 'arrow_function': {
        const symbol = extractAnonymousFunctionSymbol(node, content, context, callbacks.getNodeText);
        if (symbol) {
          symbols.push(symbol);

          const typeDeps = extractMethodTypeDependencies(
            node,
            content,
            context,
            callbacks.getNodeText
          );
          dependencies.push(...typeDeps);
        }
        break;
      }
      case 'method_declaration': {
        const symbol = extractMethodSymbol(
          node,
          content,
          context,
          callbacks.getNodeText,
          callbacks.findNodesOfType
        );
        if (symbol) {
          symbols.push(symbol);
          if (symbol.name === '__construct') {
            trackConstructorParameterTypes(
              node,
              content,
              context.typeMap,
              callbacks.getNodeText
            );
            const constructorDeps = extractConstructorDependencies(
              node,
              content,
              context,
              callbacks.getNodeText
            );
            dependencies.push(...constructorDeps);
          } else {
            const typeDeps = extractMethodTypeDependencies(
              node,
              content,
              context,
              callbacks.getNodeText
            );
            dependencies.push(...typeDeps);
          }
          if (context.currentClass) {
            extractRelationshipDefinition(node, content, context, callbacks.getNodeText);
          }
        }
        break;
      }
      case 'property_declaration': {
        const propertySymbols = extractPropertySymbols(
          node,
          content,
          context,
          callbacks.getNodeText,
          callbacks.findNodesOfType
        );
        symbols.push(...propertySymbols);
        trackPropertyTypes(
          node,
          content,
          context.typeMap,
          callbacks.getNodeText,
          callbacks.findNodesOfType,
          (n, c) => extractPhpDocComment(n, c, callbacks.getNodeText)
        );
        break;
      }
      case 'const_declaration': {
        const constSymbols = extractConstantSymbols(
          node,
          content,
          callbacks.getNodeText,
          callbacks.findNodesOfType
        );
        symbols.push(...constSymbols);
        break;
      }
      case 'function_call_expression': {
        const dependency = extractCallDependency(
          node,
          content,
          context,
          callbacks.getNodeText
        );
        if (dependency) dependencies.push(dependency);
        break;
      }
      case 'member_call_expression': {
        const dependency = extractMethodCallDependency(
          node,
          content,
          context,
          callbacks.getNodeText
        );
        if (dependency) dependencies.push(dependency);
        break;
      }
      case 'scoped_call_expression': {
        const scopedDeps = extractScopedCallDependency(
          node,
          content,
          context,
          callbacks.getNodeText
        );
        if (scopedDeps) dependencies.push(...scopedDeps);
        break;
      }
      case 'object_creation_expression': {
        const dependency = extractNewDependency(
          node,
          content,
          context,
          callbacks.getNodeText
        );
        if (dependency) dependencies.push(dependency);
        break;
      }
      case 'namespace_use_declaration': {
        const importInfo = extractUseStatement(
          node,
          content,
          callbacks.getNodeText,
          callbacks.findNodesOfType
        );
        if (importInfo) {
          imports.push(importInfo);
          context.useStatements.push(importInfo);
        }
        break;
      }
      case 'assignment_expression': {
        trackPropertyAssignment(node, content, context.typeMap, callbacks.getNodeText);
        break;
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) traverse(child);
    }
  };

  traverse(rootNode);

  const includeNodes = findIncludeStatements(
    rootNode,
    content,
    callbacks.getNodeText,
    callbacks.findNodesOfType
  );
  imports.push(...includeNodes);

  const useStatementDeps = convertUseStatementsToDependencies(imports, symbols, exports);
  dependencies.push(...useStatementDeps);

  // Extract containment relationships (classes/services containing methods)
  const containmentDeps = extractContainmentDependencies(symbols);
  dependencies.push(...containmentDeps);

  return { symbols, dependencies, imports, exports };
}
