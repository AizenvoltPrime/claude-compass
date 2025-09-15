import { DatabaseService } from '../database/services';
import { DependencyType } from '../database/models';
import { createComponentLogger } from '../utils/logger';

const logger = createComponentLogger('mcp-tools');

// Input validation helpers
function validateGetFileArgs(args: any): GetFileArgs {
  if (!args.file_id && !args.file_path) {
    throw new Error('Either file_id or file_path must be provided');
  }
  if (args.file_id && typeof args.file_id !== 'number') {
    throw new Error('file_id must be a number');
  }
  if (args.file_path && typeof args.file_path !== 'string') {
    throw new Error('file_path must be a string');
  }
  if (args.include_symbols !== undefined && typeof args.include_symbols !== 'boolean') {
    throw new Error('include_symbols must be a boolean');
  }
  return args as GetFileArgs;
}

function validateGetSymbolArgs(args: any): GetSymbolArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.include_dependencies !== undefined && typeof args.include_dependencies !== 'boolean') {
    throw new Error('include_dependencies must be a boolean');
  }
  if (args.include_callers !== undefined && typeof args.include_callers !== 'boolean') {
    throw new Error('include_callers must be a boolean');
  }
  return args as GetSymbolArgs;
}

function validateSearchCodeArgs(args: any): SearchCodeArgs {
  if (!args.query || typeof args.query !== 'string') {
    throw new Error('query is required and must be a string');
  }
  if (args.repo_id !== undefined && typeof args.repo_id !== 'number') {
    throw new Error('repo_id must be a number');
  }
  if (args.symbol_type !== undefined && typeof args.symbol_type !== 'string') {
    throw new Error('symbol_type must be a string');
  }
  if (args.is_exported !== undefined && typeof args.is_exported !== 'boolean') {
    throw new Error('is_exported must be a boolean');
  }
  if (args.limit !== undefined) {
    const limit = Number(args.limit);
    if (isNaN(limit) || limit < 1 || limit > 200) {
      throw new Error('limit must be a number between 1 and 200');
    }
    args.limit = limit;
  }
  return args as SearchCodeArgs;
}

function validateWhoCallsArgs(args: any): WhoCallsArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  return args as WhoCallsArgs;
}

function validateListDependenciesArgs(args: any): ListDependenciesArgs {
  if (!args.symbol_id || typeof args.symbol_id !== 'number') {
    throw new Error('symbol_id is required and must be a number');
  }
  if (args.dependency_type !== undefined && typeof args.dependency_type !== 'string') {
    throw new Error('dependency_type must be a string');
  }
  if (args.include_indirect !== undefined && typeof args.include_indirect !== 'boolean') {
    throw new Error('include_indirect must be a boolean');
  }
  return args as ListDependenciesArgs;
}

export interface GetFileArgs {
  file_id?: number;
  file_path?: string;
  include_symbols?: boolean;
}

export interface GetSymbolArgs {
  symbol_id: number;
  include_dependencies?: boolean;
  include_callers?: boolean;
}

export interface SearchCodeArgs {
  query: string;
  repo_id?: number;
  symbol_type?: string;
  is_exported?: boolean;
  limit?: number;
}

export interface WhoCallsArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
}

export interface ListDependenciesArgs {
  symbol_id: number;
  dependency_type?: string;
  include_indirect?: boolean;
}

export class McpTools {
  private dbService: DatabaseService;
  private logger: any;
  private sessionId?: string;

  constructor(dbService: DatabaseService, sessionId?: string) {
    this.dbService = dbService;
    this.sessionId = sessionId;
    this.logger = logger;
  }

  async getFile(args: any) {
    const validatedArgs = validateGetFileArgs(args);
    this.logger.debug('Getting file', validatedArgs);

    let file;

    if (validatedArgs.file_id) {
      file = await this.dbService.getFileWithRepository(validatedArgs.file_id);
    } else if (validatedArgs.file_path) {
      // Find file by path - this would need additional database method
      throw new Error('Finding file by path not yet implemented');
    }

    if (!file) {
      throw new Error('File not found');
    }

    let symbols = [];
    if (validatedArgs.include_symbols !== false) {
      symbols = await this.dbService.getSymbolsByFile(file.id);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            file: {
              id: file.id,
              path: file.path,
              language: file.language,
              size: file.size,
              last_modified: file.last_modified,
              is_test: file.is_test,
              is_generated: file.is_generated,
              repository: file.repository ? {
                name: file.repository.name,
                path: file.repository.path,
              } : null,
            },
            symbols: symbols.map(symbol => ({
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
            })),
            symbol_count: symbols.length,
          }, null, 2),
        },
      ],
    };
  }

  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);
    this.logger.debug('Getting symbol', validatedArgs);

    const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let dependencies = [];
    let callers = [];

    if (validatedArgs.include_dependencies !== false) {
      dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
    }

    if (validatedArgs.include_callers === true) {
      callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
              file: symbol.file ? {
                id: symbol.file.id,
                path: symbol.file.path,
                language: symbol.file.language,
                repository: symbol.file.repository || null,
              } : null,
            },
            dependencies: dependencies.map(dep => ({
              id: dep.id,
              type: dep.dependency_type,
              line_number: dep.line_number,
              confidence: dep.confidence,
              to_symbol: dep.to_symbol ? {
                id: dep.to_symbol.id,
                name: dep.to_symbol.name,
                type: dep.to_symbol.symbol_type,
                file_path: dep.to_symbol.file?.path,
              } : null,
            })),
            callers: callers.map(caller => ({
              id: caller.id,
              type: caller.dependency_type,
              line_number: caller.line_number,
              confidence: caller.confidence,
              from_symbol: caller.from_symbol ? {
                id: caller.from_symbol.id,
                name: caller.from_symbol.name,
                type: caller.from_symbol.symbol_type,
                file_path: caller.from_symbol.file?.path,
              } : null,
            })),
          }, null, 2),
        },
      ],
    };
  }

  async searchCode(args: any) {
    const validatedArgs = validateSearchCodeArgs(args);
    this.logger.debug('Searching code', validatedArgs);

    const symbols = await this.dbService.searchSymbols(validatedArgs.query, validatedArgs.repo_id);

    // Apply additional filters
    let filteredSymbols = symbols;

    if (validatedArgs.symbol_type) {
      filteredSymbols = filteredSymbols.filter(s => s.symbol_type === validatedArgs.symbol_type);
    }

    if (validatedArgs.is_exported !== undefined) {
      filteredSymbols = filteredSymbols.filter(s => s.is_exported === validatedArgs.is_exported);
    }

    // Apply limit
    const limit = validatedArgs.limit || 50;
    filteredSymbols = filteredSymbols.slice(0, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: validatedArgs.query,
            results: filteredSymbols.map(symbol => ({
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
              start_line: symbol.start_line,
              end_line: symbol.end_line,
              is_exported: symbol.is_exported,
              visibility: symbol.visibility,
              signature: symbol.signature,
              file: symbol.file ? {
                id: symbol.file.id,
                path: symbol.file.path,
                language: symbol.file.language,
              } : null,
            })),
            total_results: filteredSymbols.length,
            query_filters: {
              symbol_type: validatedArgs.symbol_type,
              is_exported: validatedArgs.is_exported,
              repo_id: validatedArgs.repo_id,
            },
          }, null, 2),
        },
      ],
    };
  }

  async whoCalls(args: any) {
    const validatedArgs = validateWhoCallsArgs(args);
    this.logger.debug('Finding who calls symbol', validatedArgs);

    const symbol = await this.dbService.getSymbol(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

    // Filter by dependency type if specified
    if (validatedArgs.dependency_type) {
      const depType = validatedArgs.dependency_type as DependencyType;
      callers = callers.filter(caller => caller.dependency_type === depType);
    }

    // TODO: Implement indirect callers (transitive dependencies)
    if (validatedArgs.include_indirect) {
      this.logger.warn('Indirect caller analysis not yet implemented');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
            },
            callers: callers.map(caller => ({
              id: caller.id,
              dependency_type: caller.dependency_type,
              line_number: caller.line_number,
              confidence: caller.confidence,
              from_symbol: caller.from_symbol ? {
                id: caller.from_symbol.id,
                name: caller.from_symbol.name,
                type: caller.from_symbol.symbol_type,
                file_path: caller.from_symbol.file?.path,
              } : null,
            })),
            total_callers: callers.length,
            filters: {
              dependency_type: validatedArgs.dependency_type,
              include_indirect: validatedArgs.include_indirect,
            },
          }, null, 2),
        },
      ],
    };
  }

  async listDependencies(args: any) {
    const validatedArgs = validateListDependenciesArgs(args);
    this.logger.debug('Listing dependencies for symbol', validatedArgs);

    const symbol = await this.dbService.getSymbol(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    let dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);

    // Filter by dependency type if specified
    if (validatedArgs.dependency_type) {
      const depType = validatedArgs.dependency_type as DependencyType;
      dependencies = dependencies.filter(dep => dep.dependency_type === depType);
    }

    // TODO: Implement indirect dependencies (transitive)
    if (validatedArgs.include_indirect) {
      this.logger.warn('Indirect dependency analysis not yet implemented');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            symbol: {
              id: symbol.id,
              name: symbol.name,
              type: symbol.symbol_type,
            },
            dependencies: dependencies.map(dep => ({
              id: dep.id,
              dependency_type: dep.dependency_type,
              line_number: dep.line_number,
              confidence: dep.confidence,
              to_symbol: dep.to_symbol ? {
                id: dep.to_symbol.id,
                name: dep.to_symbol.name,
                type: dep.to_symbol.symbol_type,
                file_path: dep.to_symbol.file?.path,
              } : null,
            })),
            total_dependencies: dependencies.length,
            filters: {
              dependency_type: validatedArgs.dependency_type,
              include_indirect: validatedArgs.include_indirect,
            },
          }, null, 2),
        },
      ],
    };
  }
}