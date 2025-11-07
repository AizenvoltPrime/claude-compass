import Parser from 'tree-sitter';
import { ParsedSymbol, ParsedImport, ParsedExport, ParseError } from '../base';
import { ChunkResult } from '../chunked-parser';

// Symbol name for anonymous arrow function callbacks (e.g., onMounted(() => {...}))
// This matches the symbol_type created by the parser for arrow functions
const ARROW_FUNCTION_SYMBOL_NAME = 'arrow_function';

export function extractComponentReference(
  callNode: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): { name: string; lineNumber: number } | null {
  const args = callNode.childForFieldName('arguments');
  if (!args || args.namedChildCount === 0) return null;

  const firstArg = args.namedChild(0);
  if (!firstArg) return null;

  if (firstArg.type !== 'identifier') return null;

  const componentName = getNodeText(firstArg, content);

  if (!isPascalCaseComponent(componentName)) return null;

  return {
    name: componentName,
    lineNumber: firstArg.startPosition.row + 1
  };
}

export function isPascalCaseComponent(name: string): boolean {
  if (name.length === 0) return false;

  if (name[0] !== name[0].toUpperCase()) return false;

  if (name === name.toUpperCase()) return false;

  if (name.includes('_')) return false;

  return true;
}

export function findContainingFunction(
  callNode: Parser.SyntaxNode,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): string {
  let parent = callNode.parent;
  const MAX_DEPTH = 15;
  let depth = 0;

  while (parent && depth < MAX_DEPTH) {
    if (
      parent.type === 'function_declaration' ||
      parent.type === 'function_expression' ||
      parent.type === 'arrow_function' ||
      parent.type === 'method_definition'
    ) {
      if (parent.type === 'function_declaration') {
        const nameNode = parent.childForFieldName('name');
        if (nameNode) return nameNode.text;
      }
      if (parent.type === 'method_definition') {
        const keyNode = parent.childForFieldName('key');
        if (keyNode) return keyNode.text;
      }

      if (parent.type === 'arrow_function' || parent.type === 'function_expression') {
        if (parent.parent && parent.parent.type === 'variable_declarator') {
          const varNameNode = parent.parent.childForFieldName('name');
          if (varNameNode) return varNameNode.text;
        }

        // Arrow functions passed as callbacks (e.g., onMounted(() => {...}))
        // Return the arrow_function symbol name so dependencies get properly attached
        // to the callback function instead of being orphaned to 'global'
        if (parent.type === 'arrow_function') {
          return ARROW_FUNCTION_SYMBOL_NAME;
        }
      }
    }

    parent = parent.parent;
    depth++;
  }

  return 'global';
}

export function isActualClassDeclaration(
  node: Parser.SyntaxNode,
  content: string,
  getNodeText: (node: Parser.SyntaxNode, content: string) => string
): boolean {
  const parent = node.parent;
  if (!parent) return true;

  if (parent.type === 'import_statement' || parent.type === 'import_clause' || parent.type === 'import_specifier') {
    return false;
  }

  if (parent.type === 'export_statement') {
    const declaration = parent.childForFieldName('declaration');
    if (declaration && declaration.id === node.id) {
      return true;
    }
  }

  const nodeText = getNodeText(node, content);
  return /^\s*(?:export\s+)?(?:default\s+)?class\s+/i.test(nodeText);
}

export function removeDuplicateImports(imports: ParsedImport[]): ParsedImport[] {
  const seen = new Map<string, ParsedImport>();

  for (const imp of imports) {
    const key = `${imp.source}:${imp.imported_names.join(',')}:${imp.import_type}:${imp.line_number}`;
    if (!seen.has(key)) {
      seen.set(key, imp);
    }
  }

  return Array.from(seen.values());
}

export function removeDuplicateExports(exports: ParsedExport[]): ParsedExport[] {
  const seen = new Map<string, ParsedExport>();

  for (const exp of exports) {
    const key = `${exp.exported_names.join(',')}:${exp.export_type}:${exp.source || ''}:${exp.line_number}`;
    if (!seen.has(key)) {
      seen.set(key, exp);
    }
  }

  return Array.from(seen.values());
}

export function filterFalsePositiveErrors(errors: ParseError[]): ParseError[] {
  return errors.filter(error => {
    const message = error.message.toLowerCase();

    const falsePositivePatterns = [
      'google.maps',
      'google.analytics',
      'microsoft.maps',
      'parsing error in error: interface',
      'parsing error in labeled_statement',
      'parsing error in expression_statement',
      'parsing error in subscript_expression',
      'parsing error in identifier:',
      'syntax errors in vue script section',
      'parsing error in program',
      'parsing error in statement_block',
      'parsing error in identifier: \n',
      'parsing error in identifier: ',
    ];

    const isFalsePositive = falsePositivePatterns.some(pattern => message.includes(pattern));

    if (isFalsePositive) {
      return false;
    }

    return true;
  });
}

export function detectCrossChunkReferences(
  symbols: ParsedSymbol[],
  dependencies: any[],
  chunkMetadata: ChunkResult[]
): number {
  let crossReferences = 0;

  for (const dep of dependencies) {
    const fromSymbol = symbols.find(s => s.name === dep.from_symbol);
    const toSymbol = symbols.find(s => s.name === dep.to_symbol);

    if (fromSymbol && toSymbol) {
      const fromChunk = chunkMetadata.findIndex(
        chunk => dep.line_number >= chunk.startLine && dep.line_number <= chunk.endLine
      );
      const toChunkFrom = chunkMetadata.findIndex(
        chunk =>
          fromSymbol.start_line >= chunk.startLine && fromSymbol.start_line <= chunk.endLine
      );
      const toChunkTo = chunkMetadata.findIndex(
        chunk => toSymbol.start_line >= chunk.startLine && toSymbol.start_line <= chunk.endLine
      );

      if (toChunkFrom !== toChunkTo && toChunkFrom !== -1 && toChunkTo !== -1) {
        crossReferences++;
      }
    }
  }

  return crossReferences;
}
