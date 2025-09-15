export { BaseParser, ParserFactory } from './base';
export { JavaScriptParser } from './javascript';
export { TypeScriptParser } from './typescript';
export * from './base';

// Register parsers in the factory
import { ParserFactory } from './base';
import { JavaScriptParser } from './javascript';
import { TypeScriptParser } from './typescript';

// Register JavaScript parser
ParserFactory.registerParser('javascript', () => new JavaScriptParser());

// Register TypeScript parser
ParserFactory.registerParser('typescript', () => new TypeScriptParser());

// Convenience function to get parser for file
export function getParserForFile(filePath: string) {
  return ParserFactory.getParserForFile(filePath);
}

// Convenience function to get all supported languages
export function getSupportedLanguages() {
  return ParserFactory.getSupportedLanguages();
}