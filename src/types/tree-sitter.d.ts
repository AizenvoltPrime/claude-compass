// Type definitions for tree-sitter
declare module 'tree-sitter' {
  namespace Parser {
    export interface SyntaxNode {
      type: string;
      startPosition: { row: number; column: number };
      endPosition: { row: number; column: number };
      startIndex: number;
      endIndex: number;
      text: string;
      children: SyntaxNode[];
      parent: SyntaxNode | null;
      hasError: boolean;
      child(index: number): SyntaxNode | null;
      childForFieldName(fieldName: string): SyntaxNode | null;
    }

    export interface Tree {
      rootNode: SyntaxNode;
    }

    export interface Language {}
  }

  class Parser {
    setLanguage(language: Parser.Language): void;
    parse(input: string): Parser.Tree;
  }

  export = Parser;
}

declare module 'tree-sitter-javascript' {
  import Parser from 'tree-sitter';
  const JavaScript: Parser.Language;
  export = JavaScript;
}

declare module 'tree-sitter-typescript' {
  import Parser from 'tree-sitter';
  export const typescript: Parser.Language;
  export const tsx: Parser.Language;
}

declare module 'tree-sitter-php' {
  import Parser from 'tree-sitter';
  export const php: Parser.Language;
  export const php_only: Parser.Language;
}