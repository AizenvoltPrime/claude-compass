import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import {
  BaseParser,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
  ParseResult,
  ParseOptions
} from './base';
import { SymbolType, DependencyType } from '../database/models';

/**
 * JavaScript-specific parser using Tree-sitter
 */
export class JavaScriptParser extends BaseParser {
  constructor() {
    const parser = new Parser();
    parser.setLanguage(JavaScript);
    super(parser, 'javascript');
  }

  getSupportedExtensions(): string[] {
    return ['.js', '.jsx', '.mjs', '.cjs'];
  }

  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    const validatedOptions = this.validateOptions(options);

    // Check file size limit
    if (content.length > validatedOptions.maxFileSize!) {
      this.logger.warn('File exceeds size limit', { filePath, size: content.length });
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: 'File too large to parse',
          line: 1,
          column: 1,
          severity: 'warning'
        }]
      };
    }

    const tree = this.parseContent(content);
    if (!tree) {
      return {
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [{
          message: 'Failed to parse syntax tree',
          line: 1,
          column: 1,
          severity: 'error'
        }]
      };
    }

    const symbols = this.extractSymbols(tree.rootNode, content);
    const dependencies = this.extractDependencies(tree.rootNode, content);
    const imports = this.extractImports(tree.rootNode, content);
    const exports = this.extractExports(tree.rootNode, content);

    return {
      symbols: validatedOptions.includePrivateSymbols ? symbols : symbols.filter(s => s.visibility !== 'private'),
      dependencies,
      imports,
      exports,
      errors: []
    };
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract function declarations
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const symbol = this.extractFunctionSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract arrow functions assigned to variables
    const variableNodes = this.findNodesOfType(rootNode, 'variable_declarator');
    for (const node of variableNodes) {
      const symbol = this.extractVariableSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract class declarations
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const symbol = this.extractClassSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract method definitions
    const methodNodes = this.findNodesOfType(rootNode, 'method_definition');
    for (const node of methodNodes) {
      const symbol = this.extractMethodSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract function calls
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');
    for (const node of callNodes) {
      const dependency = this.extractCallDependency(node, content);
      if (dependency) dependencies.push(dependency);
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract ES6 import declarations
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const importInfo = this.extractImportStatement(node, content);
      if (importInfo) imports.push(importInfo);
    }

    // Extract CommonJS require calls
    const requireCalls = this.findRequireCalls(rootNode, content);
    imports.push(...requireCalls);

    // Extract dynamic imports
    const dynamicImports = this.findDynamicImports(rootNode, content);
    imports.push(...dynamicImports);

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract named exports
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const exportInfo = this.extractExportStatement(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    // Extract default exports
    const defaultExportNodes = this.findNodesOfType(rootNode, 'export_statement')
      .filter(node => this.getNodeText(node, content).includes('default'));

    for (const node of defaultExportNodes) {
      const exportInfo = this.extractDefaultExport(node, content);
      if (exportInfo) exports.push(exportInfo);
    }

    // Extract CommonJS exports
    const commonJSExports = this.findCommonJSExports(rootNode, content);
    exports.push(...commonJSExports);

    return exports;
  }

  private extractFunctionSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);

    return {
      name,
      symbol_type: SymbolType.FUNCTION,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature
    };
  }

  private extractVariableSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    const valueNode = node.childForFieldName('value');

    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    let symbolType = SymbolType.VARIABLE;

    // Check if it's an arrow function
    if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression')) {
      symbolType = SymbolType.FUNCTION;
    }

    // Check if it's a constant
    const parent = node.parent;
    if (parent && parent.type === 'variable_declaration') {
      const kind = parent.childForFieldName('kind');
      if (kind && this.getNodeText(kind, content) === 'const') {
        symbolType = SymbolType.CONSTANT;
      }
    }

    return {
      name,
      symbol_type: symbolType,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: valueNode ? this.getNodeText(valueNode, content) : undefined
    };
  }

  private extractClassSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.CLASS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content)
    };
  }

  private extractMethodSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);
    const signature = this.extractFunctionSignature(node, content);

    // Determine visibility
    let visibility: 'public' | 'private' | 'protected' | undefined;
    if (name.startsWith('#')) {
      visibility = 'private';
    } else if (name.startsWith('_')) {
      visibility = 'private'; // Convention-based privacy
    }

    return {
      name,
      symbol_type: SymbolType.METHOD,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: false, // Methods are not directly exported
      visibility,
      signature
    };
  }

  private extractCallDependency(node: Parser.SyntaxNode, content: string): ParsedDependency | null {
    const functionNode = node.childForFieldName('function');
    if (!functionNode) return null;

    let functionName: string;

    if (functionNode.type === 'identifier') {
      functionName = this.getNodeText(functionNode, content);
    } else if (functionNode.type === 'member_expression') {
      // Handle method calls like obj.method()
      const propertyNode = functionNode.childForFieldName('property');
      if (!propertyNode) return null;
      functionName = this.getNodeText(propertyNode, content);
    } else {
      return null;
    }

    return {
      from_symbol: '', // Will be set by the caller who knows the current symbol
      to_symbol: functionName,
      dependency_type: DependencyType.CALLS,
      line_number: node.startPosition.row + 1,
      confidence: 1.0
    };
  }

  private extractImportStatement(node: Parser.SyntaxNode, content: string): ParsedImport | null {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return null;

    const source = this.getNodeText(sourceNode, content).replace(/['"]/g, '');
    const importedNames: string[] = [];
    let importType: 'named' | 'default' | 'namespace' | 'side_effect' = 'side_effect';

    const importClause = node.child(1);
    if (importClause) {
      if (importClause.type === 'import_specifier') {
        importType = 'named';
        const imported = importClause.childForFieldName('name');
        if (imported) {
          importedNames.push(this.getNodeText(imported, content));
        }
      } else if (importClause.type === 'identifier') {
        importType = 'default';
        importedNames.push(this.getNodeText(importClause, content));
      } else if (importClause.type === 'namespace_import') {
        importType = 'namespace';
        const alias = importClause.childForFieldName('alias');
        if (alias) {
          importedNames.push(this.getNodeText(alias, content));
        }
      }
    }

    return {
      source,
      imported_names: importedNames,
      import_type: importType,
      line_number: node.startPosition.row + 1,
      is_dynamic: false
    };
  }

  private findRequireCalls(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');

    for (const node of callNodes) {
      const functionNode = node.childForFieldName('function');
      if (!functionNode || this.getNodeText(functionNode, content) !== 'require') {
        continue;
      }

      const args = node.childForFieldName('arguments');
      if (!args || args.children.length === 0) continue;

      const firstArg = args.children[0];
      if (firstArg.type !== 'string') continue;

      const source = this.getNodeText(firstArg, content).replace(/['"]/g, '');

      imports.push({
        source,
        imported_names: [], // CommonJS doesn't have named imports in the same way
        import_type: 'default',
        line_number: node.startPosition.row + 1,
        is_dynamic: false
      });
    }

    return imports;
  }

  private findDynamicImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');

    for (const node of callNodes) {
      const functionNode = node.childForFieldName('function');
      if (!functionNode || this.getNodeText(functionNode, content) !== 'import') {
        continue;
      }

      const args = node.childForFieldName('arguments');
      if (!args || args.children.length === 0) continue;

      const firstArg = args.children[0];
      if (firstArg.type !== 'string') continue;

      const source = this.getNodeText(firstArg, content).replace(/['"]/g, '');

      imports.push({
        source,
        imported_names: [],
        import_type: 'default',
        line_number: node.startPosition.row + 1,
        is_dynamic: true
      });
    }

    return imports;
  }

  private extractExportStatement(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    const exportedNames: string[] = [];
    let exportType: 'named' | 'default' | 're_export' = 'named';
    let source: string | undefined;

    // Handle different export patterns
    const nodeText = this.getNodeText(node, content);

    if (nodeText.includes('export default')) {
      exportType = 'default';
    } else if (nodeText.includes('export * from')) {
      exportType = 're_export';
    }

    // Extract source if it's a re-export
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      source = this.getNodeText(sourceNode, content).replace(/['"]/g, '');
    }

    return {
      exported_names: exportedNames,
      export_type: exportType,
      source,
      line_number: node.startPosition.row + 1
    };
  }

  private extractDefaultExport(node: Parser.SyntaxNode, content: string): ParsedExport | null {
    return {
      exported_names: ['default'],
      export_type: 'default',
      line_number: node.startPosition.row + 1
    };
  }

  private findCommonJSExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];
    const assignmentNodes = this.findNodesOfType(rootNode, 'assignment_expression');

    for (const node of assignmentNodes) {
      const leftNode = node.childForFieldName('left');
      if (!leftNode) continue;

      const leftText = this.getNodeText(leftNode, content);
      if (leftText.startsWith('module.exports') || leftText.startsWith('exports.')) {
        exports.push({
          exported_names: [leftText],
          export_type: 'named',
          line_number: node.startPosition.row + 1
        });
      }
    }

    return exports;
  }

  private extractFunctionSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');

    let signature = '';
    if (nameNode) {
      signature += this.getNodeText(nameNode, content);
    }

    if (parametersNode) {
      signature += this.getNodeText(parametersNode, content);
    }

    return signature;
  }
}