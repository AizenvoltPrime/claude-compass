import Parser from 'tree-sitter';
import { typescript as TypeScript } from 'tree-sitter-typescript';
import { JavaScriptParser } from './javascript';
import {
  ParsedSymbol,
  ParseResult,
  ParseOptions
} from './base';
import { SymbolType } from '../database/models';

/**
 * TypeScript-specific parser extending JavaScript parser
 */
export class TypeScriptParser extends JavaScriptParser {
  constructor() {
    super();
    // Override the parser with TypeScript language
    this.parser = new Parser();
    this.parser.setLanguage(TypeScript);
    this.language = 'typescript';
  }

  getSupportedExtensions(): string[] {
    return ['.ts', '.tsx'];
  }

  async parseFile(filePath: string, content: string, options?: ParseOptions): Promise<ParseResult> {
    // Use the parent method but add TypeScript-specific processing
    const result = await super.parseFile(filePath, content, options);

    // Add TypeScript-specific symbols
    const tree = this.parseContent(content);
    if (tree) {
      const tsSymbols = this.extractTypeScriptSymbols(tree.rootNode, content);
      result.symbols.push(...tsSymbols);
    }

    return result;
  }

  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols = super.extractSymbols(rootNode, content);

    // Add TypeScript-specific symbols
    symbols.push(...this.extractTypeScriptSymbols(rootNode, content));

    return symbols;
  }

  private extractTypeScriptSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract interfaces
    const interfaceNodes = this.findNodesOfType(rootNode, 'interface_declaration');
    for (const node of interfaceNodes) {
      const symbol = this.extractInterfaceSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract type aliases
    const typeNodes = this.findNodesOfType(rootNode, 'type_alias_declaration');
    for (const node of typeNodes) {
      const symbol = this.extractTypeAliasSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract enums
    const enumNodes = this.findNodesOfType(rootNode, 'enum_declaration');
    for (const node of enumNodes) {
      const symbol = this.extractEnumSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract decorators
    const decoratorNodes = this.findNodesOfType(rootNode, 'decorator');
    for (const node of decoratorNodes) {
      const symbol = this.extractDecoratorSymbol(node, content);
      if (symbol) symbols.push(symbol);
    }

    // Extract abstract classes and methods
    const abstractNodes = this.findAbstractSymbols(rootNode, content);
    symbols.push(...abstractNodes);

    return symbols;
  }

  private extractInterfaceSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.INTERFACE,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.extractInterfaceSignature(node, content)
    };
  }

  private extractTypeAliasSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.TYPE_ALIAS,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      signature: this.getNodeText(node, content)
    };
  }

  private extractEnumSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.getNodeText(nameNode, content);

    return {
      name,
      symbol_type: SymbolType.ENUM,
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      is_exported: this.isSymbolExported(node, name, content),
      visibility: this.extractVisibility(node, content)
    };
  }

  private extractDecoratorSymbol(node: Parser.SyntaxNode, content: string): ParsedSymbol | null {
    // Decorators are typically not symbols themselves, but they modify other symbols
    // We might want to track them for dependency analysis
    return null;
  }

  private findAbstractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Find abstract classes
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const modifiers = this.extractModifiers(node, content);
      if (modifiers.includes('abstract')) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const name = this.getNodeText(nameNode, content);
          symbols.push({
            name,
            symbol_type: SymbolType.CLASS,
            start_line: node.startPosition.row + 1,
            end_line: node.endPosition.row + 1,
            is_exported: this.isSymbolExported(node, name, content),
            visibility: this.getVisibilityFromModifiers(modifiers)
          });
        }
      }
    }

    // Find abstract methods
    const methodNodes = this.findNodesOfType(rootNode, 'method_signature');
    for (const node of methodNodes) {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const name = this.getNodeText(nameNode, content);
        symbols.push({
          name,
          symbol_type: SymbolType.METHOD,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          is_exported: false,
          signature: this.getNodeText(node, content)
        });
      }
    }

    return symbols;
  }

  private extractInterfaceSignature(node: Parser.SyntaxNode, content: string): string {
    const nameNode = node.childForFieldName('name');
    const bodyNode = node.childForFieldName('body');

    let signature = '';
    if (nameNode) {
      signature += `interface ${this.getNodeText(nameNode, content)}`;
    }

    // Add type parameters if present
    const typeParamsNode = node.childForFieldName('type_parameters');
    if (typeParamsNode) {
      signature += this.getNodeText(typeParamsNode, content);
    }

    // Add extends clause if present
    const extendsNode = node.childForFieldName('extends');
    if (extendsNode) {
      signature += ` extends ${this.getNodeText(extendsNode, content)}`;
    }

    return signature;
  }

  private extractModifiers(node: Parser.SyntaxNode, content: string): string[] {
    const modifiers: string[] = [];

    // Look for modifier nodes
    for (const child of node.children) {
      if (child.type === 'abstract' ||
          child.type === 'public' ||
          child.type === 'private' ||
          child.type === 'protected' ||
          child.type === 'static' ||
          child.type === 'readonly' ||
          child.type === 'async' ||
          child.type === 'export') {
        modifiers.push(child.type);
      }
    }

    return modifiers;
  }

  private extractVisibility(node: Parser.SyntaxNode, content: string): 'public' | 'private' | 'protected' | undefined {
    const modifiers = this.extractModifiers(node, content);
    return this.getVisibilityFromModifiers(modifiers);
  }

  protected isSymbolExported(node: Parser.SyntaxNode, symbolName: string, content: string): boolean {
    // Check for export keyword in modifiers
    const modifiers = this.extractModifiers(node, content);
    if (modifiers.includes('export')) {
      return true;
    }

    // Fall back to parent class implementation
    return super.isSymbolExported(node, symbolName, content);
  }
}