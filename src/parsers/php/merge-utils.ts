import { ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport } from '../base';

/**
 * Remove duplicate symbols based on name, type, and line number
 */
export function removeDuplicateSymbols(symbols: ParsedSymbol[]): ParsedSymbol[] {
  const seen = new Map<string, ParsedSymbol>();

  for (const symbol of symbols) {
    const key = `${symbol.name}:${symbol.symbol_type}:${symbol.start_line}`;
    if (!seen.has(key)) {
      seen.set(key, symbol);
    }
  }

  return Array.from(seen.values());
}

/**
 * Remove duplicate dependencies based on from/to symbols, type, and line
 */
export function removeDuplicateDependencies(dependencies: ParsedDependency[]): ParsedDependency[] {
  const seen = new Map<string, ParsedDependency>();

  for (const dep of dependencies) {
    const key = `${dep.from_symbol}:${dep.to_symbol}:${dep.dependency_type}:${dep.line_number}:${dep.call_instance_id || ''}`;
    if (!seen.has(key)) {
      seen.set(key, dep);
    }
  }

  return Array.from(seen.values());
}

/**
 * Remove duplicate imports based on source, imported names, type, and line
 */
export function removeDuplicateImports(imports: ParsedImport[]): ParsedImport[] {
  const seen = new Map<string, ParsedImport>();

  for (const imp of imports) {
    const key = `${imp.source}:${imp.imported_names.join(',')}:${imp.import_type}:${imp.line_number}`;
    if (!seen.has(key)) {
      seen.set(key, imp);
    }
  }

  return Array.from(seen.values());
}

/**
 * Remove duplicate exports based on exported names, type, source, and line
 */
export function removeDuplicateExports(exports: ParsedExport[]): ParsedExport[] {
  const seen = new Map<string, ParsedExport>();

  for (const exp of exports) {
    const key = `${exp.exported_names.join(',')}:${exp.export_type}:${exp.source || ''}:${exp.line_number}`;
    if (!seen.has(key)) {
      seen.set(key, exp);
    }
  }

  return Array.from(seen.values());
}
