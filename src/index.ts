/**
 * Claude Compass - AI-native development environment
 *
 * This is the main entry point for the Claude Compass system.
 * Phase 1 implementation focusing on JavaScript/TypeScript foundation.
 */

// Re-export all modules for library usage
export {
  BaseParser,
  ParserFactory,
  JavaScriptParser,
  TypeScriptParser,
  BaseFrameworkParser,
  VueParser,
  NextJSParser,
  ReactParser,
  NodeJSParser,
  FrameworkDetector,
  MultiParser,
  getParserForFile,
  getSupportedLanguages
} from './parsers';
export * from './database';
export * from './graph';
export * from './mcp';
export * from './utils';

// Main components for programmatic usage
export { GraphBuilder } from './graph/builder';
export { ClaudeCompassMCPServer } from './mcp/server';
export { databaseService } from './database/services';
export { logger, config } from './utils';