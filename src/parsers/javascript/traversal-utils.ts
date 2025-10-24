import Parser from 'tree-sitter';
import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport } from '../base';
import { FrameworkParseOptions } from '../base-framework';
import { CONTROL_FLOW_KEYWORDS } from './types';
import { extractFunctionSymbol, extractVariableSymbol, extractClassSymbol, extractMethodSymbol, extractArrowFunctionSymbol, SymbolExtractorCallbacks } from './symbol-extractors';
import { extractCallDependency, extractContainmentDependencies } from './dependency-extractors';
import { extractImportStatement, extractExportStatement, extractDefaultExport, extractCommonJSExport, extractRequireOrDynamicImport } from './import-export-extractors';
import { extractStateFieldTypes } from './type-utils';
import { isActualClassDeclaration } from './helper-utils';

export function performSinglePassExtraction(
  rootNode: Parser.SyntaxNode,
  content: string,
  filePath: string | undefined,
  options: FrameworkParseOptions | undefined,
  callbacks: SymbolExtractorCallbacks
): {
  symbols: ParsedSymbol[];
  dependencies: ParsedDependency[];
  imports: ParsedImport[];
  exports: ParsedExport[];
} {
  const symbols: ParsedSymbol[] = [];
  const dependencies: ParsedDependency[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];

  const processedArrowFunctions = new Set<Parser.SyntaxNode>();

  const traverse = (node: Parser.SyntaxNode): void => {
    callbacks.cacheNode(node.type, node);

    switch (node.type) {
      case 'function_declaration': {
        const symbol = extractFunctionSymbol(node, content, filePath, options, callbacks);
        if (symbol) symbols.push(symbol);
        break;
      }
      case 'variable_declarator': {
        const symbol = extractVariableSymbol(node, content, filePath, options, callbacks);
        if (symbol) symbols.push(symbol);
        const valueNode = node.childForFieldName('value');
        if (valueNode?.type === 'arrow_function') {
          processedArrowFunctions.add(valueNode);
        }

        if (valueNode?.type === 'call_expression') {
          const callee = valueNode.child(0);
          if (callee?.text === 'defineStore' && symbol) {
            const stateTypeDeps = extractStateFieldTypes(valueNode, symbol.name);
            dependencies.push(...stateTypeDeps);
          }
        }
        break;
      }
      case 'class_declaration': {
        if (isActualClassDeclaration(node, content, callbacks.getNodeText)) {
          const symbol = extractClassSymbol(node, content, filePath, options, callbacks);
          if (symbol) symbols.push(symbol);
        }
        break;
      }
      case 'method_definition': {
        const nameNode = node.childForFieldName('name');
        const isControlFlow = nameNode && CONTROL_FLOW_KEYWORDS.includes(nameNode.text);

        if (isControlFlow) {
          break;
        }

        const symbol = extractMethodSymbol(node, content, filePath, options, callbacks);
        if (symbol) {
          symbols.push(symbol);
        }
        break;
      }
      case 'arrow_function': {
        if (
          !processedArrowFunctions.has(node) &&
          node.parent?.type !== 'variable_declarator' &&
          node.parent?.type !== 'assignment_expression'
        ) {
          const symbol = extractArrowFunctionSymbol(node, content, filePath, options, callbacks);
          if (symbol) symbols.push(symbol);
        }
        break;
      }
      case 'call_expression': {
        const dependency = extractCallDependency(node, content, callbacks.getNodeText);
        if (dependency) dependencies.push(dependency);
        const calleeText = node.childForFieldName('function')
          ? callbacks.getNodeText(node.childForFieldName('function')!, content)
          : '';
        if (calleeText === 'require' || calleeText === 'import') {
          const importInfo = extractRequireOrDynamicImport(node, content, calleeText, callbacks.getNodeText);
          if (importInfo) imports.push(importInfo);
        }
        break;
      }
      case 'import_statement': {
        const importInfo = extractImportStatement(node, content, callbacks.getNodeText);
        if (importInfo) imports.push(importInfo);
        break;
      }
      case 'export_statement': {
        const exportInfo = extractExportStatement(node, content, callbacks.getNodeText);
        if (exportInfo) exports.push(exportInfo);
        const nodeText = callbacks.getNodeText(node, content);
        if (nodeText.includes('default')) {
          const defaultExport = extractDefaultExport(node, content);
          if (defaultExport && defaultExport !== exportInfo) exports.push(defaultExport);
        }
        break;
      }
      case 'assignment_expression': {
        const leftNode = node.childForFieldName('left');
        if (leftNode) {
          const leftText = callbacks.getNodeText(leftNode, content);
          if (leftText.startsWith('module.exports') || leftText.startsWith('exports.')) {
            const commonJSExport = extractCommonJSExport(node, content, callbacks.getNodeText);
            if (commonJSExport) exports.push(commonJSExport);
          }
        }
        break;
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) traverse(child);
    }
  };

  traverse(rootNode);

  const containmentDeps = extractContainmentDependencies(symbols);
  dependencies.push(...containmentDeps);

  return { symbols, dependencies, imports, exports };
}
