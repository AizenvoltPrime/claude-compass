import Parser from 'tree-sitter';
import { ParsedImport, ParsedExport, ParsedDependency, ParsedSymbol } from '../base';
import { SymbolType, DependencyType } from '../../database/models';

export function extractUseStatement(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedImport | null {
  const importedNames: string[] = [];
  let source = '';

  const useClauses = findNodesOfType(node, 'namespace_use_clause');
  for (const clause of useClauses) {
    const nameNode = clause.children.find(child => child.type === 'qualified_name');
    if (nameNode) {
      const fullName = getNodeText(nameNode, content);
      importedNames.push(fullName);
      if (!source) {
        source = fullName;
      }
    }
  }

  if (importedNames.length === 0) return null;

  return {
    source,
    imported_names: importedNames,
    import_type: 'named',
    line_number: node.startPosition.row + 1,
    is_dynamic: false
  };
}

export function findIncludeStatements(
  rootNode: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string,
  findNodesOfType: (node: Parser.SyntaxNode, type: string) => Parser.SyntaxNode[]
): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const includeNodes = findNodesOfType(rootNode, 'include_expression');
  const includeOnceNodes = findNodesOfType(rootNode, 'include_once_expression');
  const requireNodes = findNodesOfType(rootNode, 'require_expression');
  const requireOnceNodes = findNodesOfType(rootNode, 'require_once_expression');

  const allIncludeNodes = [...includeNodes, ...includeOnceNodes, ...requireNodes, ...requireOnceNodes];

  for (const node of allIncludeNodes) {
    const argNode = node.child(1);
    if (!argNode) continue;

    let source = '';
    if (argNode.type === 'string') {
      source = getNodeText(argNode, content).replace(/['"]/g, '');
    }

    if (source) {
      imports.push({
        source,
        imported_names: [],
        import_type: 'side_effect',
        line_number: node.startPosition.row + 1,
        is_dynamic: false
      });
    }
  }

  return imports;
}

export function extractNamedExport(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): ParsedExport | null {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return null;

  const name = getNodeText(nameNode, content);

  return {
    exported_names: [name],
    export_type: 'named',
    line_number: node.startPosition.row + 1
  };
}

export function convertUseStatementsToDependencies(
  imports: ParsedImport[],
  symbols: ParsedSymbol[],
  exports: ParsedExport[]
): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  let fromSymbol = '';
  let fromSymbolLineNumber = 1;

  if (exports.length > 0 && exports[0].exported_names.length > 0) {
    fromSymbol = exports[0].exported_names[0];
  }

  if (!fromSymbol && symbols.length > 0) {
    const firstClass = symbols.find(
      s => s.symbol_type === SymbolType.CLASS ||
           s.symbol_type === SymbolType.INTERFACE ||
           s.symbol_type === SymbolType.TRAIT
    );
    fromSymbol = firstClass?.name || symbols[0].name;
  }

  if (!fromSymbol) {
    return dependencies;
  }

  const classSymbol = symbols.find(s => s.name === fromSymbol);
  if (classSymbol) {
    fromSymbolLineNumber = classSymbol.start_line;
  }

  for (const importInfo of imports) {
    if (importInfo.import_type === 'side_effect') {
      continue;
    }

    for (const importedName of importInfo.imported_names) {
      const parts = importedName.split('\\');
      const shortName = parts[parts.length - 1];

      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: shortName,
        to_qualified_name: importedName,
        dependency_type: DependencyType.IMPORTS,
        line_number: fromSymbolLineNumber,
        qualified_context: `use ${importedName}`,
      });

      dependencies.push({
        from_symbol: fromSymbol,
        to_symbol: shortName,
        to_qualified_name: importedName,
        dependency_type: DependencyType.REFERENCES,
        line_number: fromSymbolLineNumber,
        qualified_context: `use ${importedName}`,
      });
    }
  }

  return dependencies;
}
