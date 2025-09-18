export { BaseParser, ParserFactory } from './base';
export { JavaScriptParser } from './javascript';
export { TypeScriptParser } from './typescript';
export { BaseFrameworkParser } from './base-framework';
export { VueParser } from './vue';
export { NextJSParser } from './nextjs';
export { ReactParser } from './react';
export { NodeJSParser } from './nodejs';
export { TestFrameworkParser } from './test-framework';
export { PackageManagerParser } from './package-manager';
export { BackgroundJobParser } from './background-job';
export { ORMParser } from './orm';
export { FrameworkDetector } from './framework-detector';
export { MultiParser } from './multi-parser';
export * from './base';
export * from './framework-detector';
export * from './multi-parser';

// Register parsers in the factory
import { ParserFactory } from './base';
import { JavaScriptParser } from './javascript';
import { TypeScriptParser } from './typescript';
import { VueParser } from './vue';
import { NextJSParser } from './nextjs';
import { ReactParser } from './react';
import { NodeJSParser } from './nodejs';
import { TestFrameworkParser } from './test-framework';
import { PackageManagerParser } from './package-manager';
import { BackgroundJobParser } from './background-job';
import { ORMParser } from './orm';

// Register base language parsers
ParserFactory.registerParser('javascript', () => new JavaScriptParser());
ParserFactory.registerParser('typescript', () => new TypeScriptParser());

// Register framework parsers
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

ParserFactory.registerParser('vue', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return new VueParser(parser);
});
ParserFactory.registerParser('nextjs', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return new NextJSParser(parser);
});
ParserFactory.registerParser('react', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return new ReactParser(parser);
});
ParserFactory.registerParser('nodejs', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return new NodeJSParser(parser);
});
ParserFactory.registerParser('test-framework', () => {
  return new TestFrameworkParser();
});
ParserFactory.registerParser('package-manager', () => {
  return new PackageManagerParser();
});
ParserFactory.registerParser('background-job', () => {
  return new BackgroundJobParser();
});
ParserFactory.registerParser('orm', () => {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  return new ORMParser(parser);
});

// Convenience function to get parser for file
export function getParserForFile(filePath: string) {
  return ParserFactory.getParserForFile(filePath);
}

// Convenience function to get all supported languages
export function getSupportedLanguages() {
  return ParserFactory.getSupportedLanguages();
}