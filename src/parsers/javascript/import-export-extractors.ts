import Parser from 'tree-sitter';
import { ParsedImport, ParsedExport, ParsedSymbol, ParsedDependency } from '../base';
import { DependencyType } from '../../database/models';
import { TraversalCallbacks } from './types';

export function extractImportStatement(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedImport | null {
  const importedNames: string[] = [];
  let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';
  let source = '';

  const secondChild = node.child(1);
  if (!secondChild) return null;

  if (secondChild.type === 'string') {
    source = getNodeText(secondChild, content).replace(/['"]/g, '');
    importType = 'side_effect';
  } else if (secondChild.type === 'import_clause') {
    const sourceNode = node.child(3);
    if (!sourceNode || sourceNode.type !== 'string') return null;

    source = getNodeText(sourceNode, content).replace(/['"]/g, '');

    const clauseChild = secondChild.child(0);
    if (!clauseChild) return null;

    if (clauseChild.type === 'identifier') {
      importType = 'default';
      importedNames.push(getNodeText(clauseChild, content));
    } else if (clauseChild.type === 'named_imports') {
      importType = 'named';

      for (let i = 0; i < clauseChild.childCount; i++) {
        const child = clauseChild.child(i);
        if (child.type === 'import_specifier') {
          const nameNode = child.child(0);
          if (nameNode && nameNode.type === 'identifier') {
            importedNames.push(getNodeText(nameNode, content));
          }
        }
      }
    } else if (clauseChild.type === 'namespace_import') {
      importType = 'namespace';

      const aliasNode = clauseChild.child(clauseChild.childCount - 1);
      if (aliasNode && aliasNode.type === 'identifier') {
        importedNames.push(getNodeText(aliasNode, content));
      }
    }
  } else {
    return null;
  }

  return {
    source,
    imported_names: importedNames,
    import_type: importType,
    line_number: node.startPosition.row + 1,
    is_dynamic: false,
  };
}

export function extractExportStatement(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedExport | null {
  const exportedNames: string[] = [];
  let exportType: 'named' | 'default' | 're_export' = 'named';
  let source: string | undefined;

  const nodeText = getNodeText(node, content);

  if (nodeText.includes('export default')) {
    exportType = 'default';
  } else if (nodeText.includes('export * from')) {
    exportType = 're_export';
  }

  const sourceNode = node.childForFieldName('source');
  if (sourceNode) {
    source = getNodeText(sourceNode, content).replace(/['"]/g, '');
  }

  return {
    exported_names: exportedNames,
    export_type: exportType,
    source,
    line_number: node.startPosition.row + 1,
  };
}

export function extractDefaultExport(
  node: Parser.SyntaxNode,
  _content: string
): ParsedExport | null {
  return {
    exported_names: ['default'],
    export_type: 'default',
    line_number: node.startPosition.row + 1,
  };
}

export function extractCommonJSExport(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedExport | null {
  const leftNode = node.childForFieldName('left');
  if (!leftNode) return null;

  const leftText = getNodeText(leftNode, content);

  return {
    exported_names: [leftText],
    export_type: 'named',
    line_number: node.startPosition.row + 1,
  };
}

export function extractRequireOrDynamicImport(
  node: Parser.SyntaxNode,
  content: string,
  calleeText: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedImport | null {
  const args = node.childForFieldName('arguments');
  if (!args || args.namedChildCount === 0) return null;

  const firstArg = args.namedChild(0);
  if (!firstArg || firstArg.type !== 'string') return null;

  const source = getNodeText(firstArg, content).replace(/['"]/g, '');

  return {
    source,
    imported_names: [],
    import_type: 'default',
    line_number: node.startPosition.row + 1,
    is_dynamic: calleeText === 'import',
  };
}

export function findRequireCalls(
  rootNode: Parser.SyntaxNode,
  content: string,
  callbacks: TraversalCallbacks
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const callNodes = callbacks.findNodesOfType(rootNode, 'call_expression');

  for (const node of callNodes) {
    const functionNode = node.childForFieldName('function');
    if (!functionNode || callbacks.getNodeText(functionNode, content) !== 'require') {
      continue;
    }

    const args = node.childForFieldName('arguments');
    if (!args || args.namedChildCount === 0) continue;

    const firstArg = args.namedChild(0);
    if (!firstArg || firstArg.type !== 'string') continue;

    const source = callbacks.getNodeText(firstArg, content).replace(/['"]/g, '');

    imports.push({
      source,
      imported_names: [],
      import_type: 'default',
      line_number: node.startPosition.row + 1,
      is_dynamic: false,
    });
  }

  return imports;
}

export function findDynamicImports(
  rootNode: Parser.SyntaxNode,
  content: string,
  callbacks: TraversalCallbacks
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const callNodes = callbacks.findNodesOfType(rootNode, 'call_expression');

  for (const node of callNodes) {
    const functionNode = node.childForFieldName('function');
    if (!functionNode || callbacks.getNodeText(functionNode, content) !== 'import') {
      continue;
    }

    const args = node.childForFieldName('arguments');
    if (!args || args.namedChildCount === 0) continue;

    const firstArg = args.namedChild(0);
    if (!firstArg || firstArg.type !== 'string') continue;

    const source = callbacks.getNodeText(firstArg, content).replace(/['"]/g, '');

    imports.push({
      source,
      imported_names: [],
      import_type: 'default',
      line_number: node.startPosition.row + 1,
      is_dynamic: true,
    });
  }

  return imports;
}

export function findCommonJSExports(
  rootNode: Parser.SyntaxNode,
  content: string,
  callbacks: TraversalCallbacks
): ParsedExport[] {
  const exports: ParsedExport[] = [];
  const assignmentNodes = callbacks.findNodesOfType(rootNode, 'assignment_expression');

  for (const node of assignmentNodes) {
    const leftNode = node.childForFieldName('left');
    if (!leftNode) continue;

    const leftText = callbacks.getNodeText(leftNode, content);
    if (leftText.startsWith('module.exports') || leftText.startsWith('exports.')) {
      exports.push({
        exported_names: [leftText],
        export_type: 'named',
        line_number: node.startPosition.row + 1,
      });
    }
  }

  return exports;
}

export function convertImportsToDependencies(
  imports: ParsedImport[],
  symbols: ParsedSymbol[],
  exports: ParsedExport[],
  _filePath?: string
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  let fromSymbol = '';
  if (exports.length > 0) {
    const defaultExport = exports.find(e => e.export_type === 'default');
    if (defaultExport && defaultExport.exported_names.length > 0) {
      fromSymbol = defaultExport.exported_names[0];
    } else if (exports[0].exported_names.length > 0) {
      fromSymbol = exports[0].exported_names[0];
    }
  }
  if (!fromSymbol && symbols.length > 0) {
    const firstExportedSymbol = symbols.find(s => s.is_exported);
    fromSymbol = firstExportedSymbol?.name || symbols[0].name;
  }
  if (!fromSymbol) {
    return dependencies;
  }

  for (const importInfo of imports) {
    const isLocalImport =
      importInfo.source.startsWith('./') ||
      importInfo.source.startsWith('../') ||
      importInfo.source.startsWith('/') ||
      importInfo.source.startsWith('src/') ||
      importInfo.source.startsWith('@/');

    if (!isLocalImport) {
      continue;
    }

    for (const importedName of importInfo.imported_names) {
      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: importedName,
        dependency_type: DependencyType.IMPORTS,
        line_number: importInfo.line_number,
        qualified_context: `import from ${importInfo.source}`,
      });

      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: importedName,
        dependency_type: DependencyType.REFERENCES,
        line_number: importInfo.line_number,
        qualified_context: `import from ${importInfo.source}`,
      });
    }
  }

  return dependencies;
}
