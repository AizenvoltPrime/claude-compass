import type { Knex } from 'knex';
import * as SearchService from '../../database/services/search-service';

export class VueSearch {
  constructor(private db: Knex) {}

  async searchComponents(query: string, repoIds: number[], framework?: string): Promise<any[]> {
    const symbols = await SearchService.searchSymbols(this.db, query, repoIds?.[0]);

    return symbols.filter(symbol => {
      if (framework === 'vue') {
        return symbol.file?.path?.endsWith('.vue') || symbol.symbol_type === 'component';
      } else if (framework === 'react') {
        return symbol.symbol_type === 'function' && symbol.name.match(/^[A-Z]/);
      }
      return symbol.symbol_type === 'component';
    });
  }
}
