import { Symbol } from '../../../database/models';
import { ParsedImport, ParsedExport } from '../../../parsers/base';
import { IResolutionContext, Language } from '../interfaces';

export class ResolutionContext implements IResolutionContext {
  readonly fileId: number;
  readonly filePath: string;
  readonly language: Language;
  readonly symbols: Symbol[];
  readonly imports: ParsedImport[];
  readonly exports: ParsedExport[];

  private languageContext: Map<string, any> = new Map();

  constructor(
    fileId: number,
    filePath: string,
    language: Language,
    symbols: Symbol[],
    imports: ParsedImport[],
    exports: ParsedExport[]
  ) {
    this.fileId = fileId;
    this.filePath = filePath;
    this.language = language;
    this.symbols = symbols;
    this.imports = imports;
    this.exports = exports;
  }

  setLanguageContext<T>(key: string, value: T): void {
    this.languageContext.set(key, value);
  }

  getLanguageContext<T>(key: string): T | undefined {
    return this.languageContext.get(key) as T | undefined;
  }

  hasLanguageContext(key: string): boolean {
    return this.languageContext.has(key);
  }

  clearLanguageContext(): void {
    this.languageContext.clear();
  }

  static fromFileContext(
    fileId: number,
    filePath: string,
    symbols: Symbol[],
    imports: ParsedImport[],
    exports: ParsedExport[]
  ): ResolutionContext {
    const language = ResolutionContext.detectLanguage(filePath);
    return new ResolutionContext(fileId, filePath, language, symbols, imports, exports);
  }

  private static detectLanguage(filePath: string): Language {
    const ext = filePath.split('.').pop()?.toLowerCase();

    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
      case 'vue':
        return 'javascript';
      case 'php':
        return 'php';
      case 'cs':
        return 'csharp';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      case 'rs':
        return 'rust';
      default:
        return 'javascript';
    }
  }
}
