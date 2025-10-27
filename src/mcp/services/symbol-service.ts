import type { Knex } from 'knex';
import * as SymbolService from '../../database/services/symbol-service';
import * as DependencyService from '../../database/services/dependency-service';
import { SimplifiedSymbolResponse } from '../../database/models';
import { GetSymbolArgs } from '../types';
import { validateGetSymbolArgs } from '../validators';

export class MCPSymbolService {
  constructor(private db: Knex) {}

  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);

    const symbol = await SymbolService.getSymbolWithFile(this.db, validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    const dependencies = await DependencyService.getDependenciesFrom(this.db, validatedArgs.symbol_id);
    const callers = await DependencyService.getDependenciesTo(this.db, validatedArgs.symbol_id);

    const response: SimplifiedSymbolResponse = {
      symbol: {
        id: symbol.id,
        name: symbol.name,
        type: symbol.symbol_type,
        start_line: symbol.start_line,
        end_line: symbol.end_line,
        is_exported: symbol.is_exported,
        visibility: symbol.visibility,
        signature: symbol.signature,
      },
      file_path: symbol.file?.path || '',
      repository_name: symbol.file?.repository?.name,
      dependencies_count: dependencies.length,
      callers_count: callers.length,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
}
