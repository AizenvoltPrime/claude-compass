import { Symbol, SymbolType, Visibility } from '../../database/models';
import { ParsedDependency, ParsedImport, ParsedExport } from '../../parsers/base';

export type Language = 'javascript' | 'typescript' | 'php' | 'csharp' | 'python' | 'go' | 'rust';

export interface IResolutionContext {
  readonly fileId: number;
  readonly filePath: string;
  readonly language: Language;
  readonly symbols: Symbol[];
  readonly imports: ParsedImport[];
  readonly exports: ParsedExport[];

  setLanguageContext<T>(key: string, value: T): void;
  getLanguageContext<T>(key: string): T | undefined;
  hasLanguageContext(key: string): boolean;
  clearLanguageContext(): void;
}

export interface SymbolResolutionResult {
  symbol: Symbol;
  confidence: 'high' | 'medium' | 'low';
  resolutionStrategy: string;
}

export interface ILanguageResolver {
  readonly name: string;
  readonly supportedLanguages: Language[];
  readonly priority: number;

  canResolve(context: IResolutionContext, targetSymbol: string, dependency?: ParsedDependency): boolean;
  resolve(context: IResolutionContext, targetSymbol: string, dependency?: ParsedDependency): SymbolResolutionResult | null;
  initialize(indexManager: ISymbolIndexManager, virtualFactory: IVirtualSymbolFactory): void;
  cleanup(): void;
}

export interface VirtualSymbolConfig {
  name: string;
  type: SymbolType;
  framework?: string;
  library?: string;
  signature?: string;
  description?: string;
  visibility?: Visibility;
}

export interface IVirtualSymbolFactory {
  createFrameworkSymbol(config: VirtualSymbolConfig): Symbol;
  createExternalLibrarySymbol(config: VirtualSymbolConfig): Symbol;
  getVirtualSymbol(key: string): Symbol | undefined;
  getAllVirtualSymbols(): Symbol[];
  clear(): void;
}

export interface SymbolLocation {
  fileId: number;
  symbolId: number;
  filePath: string;
}

export interface ExportedSymbol {
  symbol: Symbol;
  fromFile: number;
}

export interface ISymbolIndexManager {
  buildGlobalIndex(files: any[], symbols: Symbol[]): void;
  buildTransientIndexes(contexts: IResolutionContext[]): void;

  getSymbolById(symbolId: number): Symbol | undefined;
  getSymbolsByName(name: string): Symbol[];
  getExportedSymbols(name: string): ExportedSymbol[];
  getSymbolByQualifiedName(qualifiedName: string): Symbol | undefined;
  getFileId(filePath: string): number | undefined;

  clearTransient(): void;
  clearAll(): void;
}

export interface ImportResolutionOptions {
  resolveAliases?: boolean;
  resolveBarrelFiles?: boolean;
  followReExports?: boolean;
}

export interface ResolvedImportPath {
  resolvedPath: string;
  isExternal: boolean;
  isRelative: boolean;
  isBarrelFile: boolean;
}

export interface IImportPathResolver {
  resolvePath(
    importSource: string,
    currentFilePath: string,
    projectRoot: string,
    options?: ImportResolutionOptions
  ): ResolvedImportPath | null;

  isExternalImport(source: string): boolean;
  isRelativeImport(source: string): boolean;
  resolveBarrelFile(dirPath: string): string[];
  resolvePathAlias(source: string, tsconfig?: any): string | null;
}

export interface MemberExpressionPart {
  name: string;
  isLast: boolean;
  fullPath: string;
}

export interface IMemberExpressionResolver {
  parse(expression: string): MemberExpressionPart[];
  resolve(
    expression: string,
    context: IResolutionContext,
    indexManager: ISymbolIndexManager
  ): Symbol | null;
}

export interface FrameworkContext {
  framework: string;
  isTestFile: boolean;
  isValidationContext: boolean;
  isRequestContext: boolean;
  contextHints: string[];
}

export interface IContextAnalyzer {
  analyzeContext(context: IResolutionContext, dependency?: ParsedDependency): FrameworkContext;
  isTestFile(filePath: string): boolean;
  detectFramework(filePath: string, imports: ParsedImport[]): string | null;
}

export interface ResolutionStats {
  totalResolutions: number;
  successfulResolutions: number;
  failedResolutions: number;
  resolutionsByStrategy: Map<string, number>;
  resolutionsByLanguage: Map<Language, number>;
}
