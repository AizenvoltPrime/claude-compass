/**
 * Base parser implementations for Tree-sitter operations
 * Abstract method implementations required by BaseFrameworkParser
 */

import Parser from 'tree-sitter';
import { SymbolType, DependencyType } from '../../database/models';
import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport } from '../base';

export function extractBaseSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
  const symbols: ParsedSymbol[] = [];

  // Extract class declarations (entities/models)
  const classNodes = findNodesOfType(rootNode, 'class_declaration');
  for (const node of classNodes) {
    const nameNode = node.namedChild(0);
    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        symbol_type: SymbolType.ORM_ENTITY,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        is_exported: isNodeExported(node),
      });
    }
  }

  // Extract function declarations
  const functionNodes = findNodesOfType(rootNode, 'function_declaration');
  for (const node of functionNodes) {
    const nameNode = node.namedChild(0);
    if (nameNode) {
      symbols.push({
        name: nameNode.text,
        symbol_type: SymbolType.FUNCTION,
        start_line: node.startPosition.row + 1,
        end_line: node.endPosition.row + 1,
        is_exported: isNodeExported(node),
      });
    }
  }

  return symbols;
}

export function extractBaseDependencies(
  rootNode: Parser.SyntaxNode,
  content: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  // Extract method calls
  const callNodes = findNodesOfType(rootNode, 'call_expression');
  for (const node of callNodes) {
    const memberNode = node.namedChild(0);
    if (memberNode) {
      dependencies.push({
        from_symbol: 'unknown',
        to_symbol: memberNode.text,
        dependency_type: DependencyType.CALLS,
        line_number: node.startPosition.row + 1,
      });
    }
  }

  return dependencies;
}

export function extractBaseImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];

  // Extract import statements
  const importNodes = findNodesOfType(rootNode, 'import_statement');
  for (const node of importNodes) {
    const sourceNode = node.namedChild(0);
    if (sourceNode) {
      imports.push({
        source: sourceNode.text.replace(/['"]/g, ''),
        imported_names: [],
        import_type: 'side_effect',
        line_number: node.startPosition.row + 1,
        is_dynamic: false,
      });
    }
  }

  return imports;
}

export function extractBaseExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
  const exports: ParsedExport[] = [];

  // Extract export statements
  const exportNodes = findNodesOfType(rootNode, 'export_statement');
  for (const node of exportNodes) {
    const nameNode = node.namedChild(0);
    if (nameNode) {
      exports.push({
        exported_names: [nameNode.text],
        export_type: node.text.includes('default') ? 'default' : 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  return exports;
}

export function isNodeExported(node: Parser.SyntaxNode): boolean {
  // Check if the node or its parent has export keyword
  return node.type.includes('export') || (node.parent && node.parent.type.includes('export'));
}

export function findNodesOfType(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
  const nodes: Parser.SyntaxNode[] = [];

  function traverse(node: Parser.SyntaxNode) {
    if (node.type === type) {
      nodes.push(node);
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      traverse(node.namedChild(i)!);
    }
  }

  traverse(rootNode);
  return nodes;
}
