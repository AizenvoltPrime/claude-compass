import type { Knex } from 'knex';
import * as FileService from '../../database/services/file-service';
import * as SymbolService from '../../database/services/symbol-service';
import { GetFileArgs } from '../types';
import { validateGetFileArgs } from '../validators';

export class MCPFileService {
  constructor(private db: Knex) {}

  async getFile(args: any) {
    const validatedArgs = validateGetFileArgs(args);

    let file;

    if (validatedArgs.file_id) {
      file = await FileService.getFileWithRepository(this.db, validatedArgs.file_id);
    } else if (validatedArgs.file_path) {
      file = await FileService.getFileByPath(this.db, validatedArgs.file_path);
    }

    if (!file) {
      throw new Error('File not found');
    }

    const symbols = await SymbolService.getSymbolsByFile(this.db, file.id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              file: {
                id: file.id,
                path: file.path,
                language: file.language,
                size: file.size,
                last_modified: file.last_modified,
                is_test: file.is_test,
                is_generated: file.is_generated,
                repository: file.repository
                  ? {
                      name: file.repository.name,
                      path: file.repository.path,
                    }
                  : null,
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
            },
            null,
            2
          ),
        },
      ],
    };
  }
}
