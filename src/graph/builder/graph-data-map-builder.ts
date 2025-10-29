import { File, Symbol, SymbolType } from '../../database/models';
import { ParseResult } from '../../parsers/base';

/**
 * Graph Data Map Builder
 * Pure functions for creating graph data structure mappings
 */

export function createImportsMap(
  files: File[],
  parseResults: Array<ParseResult & { filePath: string }>
): Map<number, any[]> {
  const map = new Map();

  for (const file of files) {
    const parseResult = parseResults.find(r => r.filePath === file.path);
    if (parseResult) {
      map.set(file.id, parseResult.imports);
    }
  }

  return map;
}

export function createExportsMap(
  files: File[],
  parseResults: Array<ParseResult & { filePath: string }>
): Map<number, any[]> {
  const map = new Map();

  for (const file of files) {
    const parseResult = parseResults.find(r => r.filePath === file.path);
    if (parseResult) {
      map.set(file.id, parseResult.exports);
    }
  }

  return map;
}

export function createDependenciesMap(
  symbols: Symbol[],
  parseResults: Array<ParseResult & { filePath: string }>,
  dbFiles: File[]
): Map<number, any[]> {
  const map = new Map();

  // Create a file-to-symbols map for efficient lookup
  const fileToSymbolsMap = new Map<string, Symbol[]>();

  // Create a mapping from file_id to file path
  const fileIdToPathMap = new Map<number, string>();
  for (const file of dbFiles) {
    fileIdToPathMap.set(file.id, file.path);
  }

  for (const symbol of symbols) {
    const filePath = fileIdToPathMap.get(symbol.file_id);
    if (filePath) {
      if (!fileToSymbolsMap.has(filePath)) {
        fileToSymbolsMap.set(filePath, []);
      }
      fileToSymbolsMap.get(filePath)!.push(symbol);
    }
  }

  // Process dependencies with file context preserved
  for (const parseResult of parseResults) {
    const filePath = parseResult.filePath;
    const fileSymbols = fileToSymbolsMap.get(filePath) || [];

    const dependencies = parseResult.dependencies.filter(
      d =>
        d.from_symbol && d.from_symbol.trim() !== '' && d.to_symbol && d.to_symbol.trim() !== ''
    );

    for (const dependency of dependencies) {
      // Extract the method/function name from qualified names (e.g., "Class.Method" -> "Method")
      // This handles C# qualified names like "CardManager.SetHandPositions" or "Namespace.Class.Method"
      const extractMethodName = (qualifiedName: string): string => {
        const parts = qualifiedName.split('.');
        // For patterns like "Class.<lambda>" or "Method.<local>", take the first meaningful part
        const lastPart = parts[parts.length - 1];
        if (lastPart.startsWith('<') && parts.length > 1) {
          return parts[parts.length - 2];
        }
        return lastPart;
      };

      const fromMethodName = extractMethodName(dependency.from_symbol);

      // Find the specific symbol that contains this dependency call
      // Must match: name (supporting both simple and qualified), file, and line range
      const containingSymbol = fileSymbols.find(symbol => {
        // Direct match (for non-qualified names)
        if (symbol.name === dependency.from_symbol) {
          return (
            dependency.line_number >= symbol.start_line &&
            dependency.line_number <= symbol.end_line
          );
        }

        // Qualified name match (for C# and similar languages)
        if (symbol.name === fromMethodName) {
          return (
            dependency.line_number >= symbol.start_line &&
            dependency.line_number <= symbol.end_line
          );
        }

        // Enhanced matching: check if dependency is within symbol line range
        // This handles cases where the dependency call is inside a method/function
        // but the from_symbol name doesn't exactly match the containing symbol name
        if (
          dependency.line_number >= symbol.start_line &&
          dependency.line_number <= symbol.end_line
        ) {
          // Prioritize methods/functions/properties over classes to avoid creating dependencies from the class
          if (
            symbol.symbol_type === SymbolType.METHOD ||
            symbol.symbol_type === SymbolType.FUNCTION ||
            symbol.symbol_type === SymbolType.PROPERTY
          ) {
            return true;
          }

          // Only match class if no method/function/property contains this line
          if (symbol.symbol_type === SymbolType.CLASS) {
            const hasContainingMethod = fileSymbols.some(
              s =>
                (s.symbol_type === SymbolType.METHOD ||
                  s.symbol_type === SymbolType.FUNCTION ||
                  s.symbol_type === SymbolType.PROPERTY) &&
                dependency.line_number >= s.start_line &&
                dependency.line_number <= s.end_line
            );
            if (!hasContainingMethod) {
              return true;
            }
            return false;
          }

          // Fallback: if no method/function/property/class contains this line,
          // accept any symbol that contains it
          const hasMethodOrFunction = fileSymbols.some(
            s =>
              (s.symbol_type === SymbolType.METHOD ||
                s.symbol_type === SymbolType.FUNCTION ||
                s.symbol_type === SymbolType.PROPERTY ||
                s.symbol_type === SymbolType.CLASS) &&
              dependency.line_number >= s.start_line &&
              dependency.line_number <= s.end_line
          );

          if (!hasMethodOrFunction) {
            return true;
          }
        }

        return false;
      });

      if (containingSymbol) {
        const existingDeps = map.get(containingSymbol.id) || [];
        existingDeps.push(dependency);
        map.set(containingSymbol.id, existingDeps);
      }
    }
  }

  return map;
}
