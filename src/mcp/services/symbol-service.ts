import { DatabaseService } from '../../database/services';
import { SimplifiedSymbolResponse } from '../../database/models';
import { GetSymbolArgs } from '../types';
import { validateGetSymbolArgs } from '../validators';

export class SymbolService {
  constructor(private dbService: DatabaseService) {}

  async getSymbol(args: any) {
    const validatedArgs = validateGetSymbolArgs(args);

    const symbol = await this.dbService.getSymbolWithFile(validatedArgs.symbol_id);
    if (!symbol) {
      throw new Error('Symbol not found');
    }

    const dependencies = await this.dbService.getDependenciesFrom(validatedArgs.symbol_id);
    const callers = await this.dbService.getDependenciesTo(validatedArgs.symbol_id);

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
