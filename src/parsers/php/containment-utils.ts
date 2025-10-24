import { ParsedSymbol, ParsedDependency } from '../base';
import { DependencyType, SymbolType } from '../../database/models';

/**
 * Extract containment relationships between parent classes/services and their methods.
 * Creates CONTAINS dependencies when a class/interface/trait contains methods.
 * Uses line range overlap to identify parent-child relationships.
 *
 * NOTE: All symbols in the input array are from the same file (guaranteed by caller).
 * This function is called per-file during parsing, so same-file validation is implicit.
 *
 * Performance: O(n²) where n = number of symbols per file.
 * Acceptable because typical files have < 100 symbols, resulting in < 10k comparisons.
 * Early exit optimizations: skip if no line ranges, filter candidates by type first.
 */
export function extractContainmentDependencies(symbols: ParsedSymbol[]): ParsedDependency[] {
  const dependencies: ParsedDependency[] = [];

  const childCandidates = symbols.filter(
    s => s.symbol_type === SymbolType.METHOD || s.symbol_type === SymbolType.FUNCTION
  );

  const parentCandidates = symbols.filter(
    s => s.symbol_type === SymbolType.CLASS ||
         s.symbol_type === SymbolType.INTERFACE ||
         s.symbol_type === SymbolType.TRAIT ||
         s.entity_type === 'service' ||
         s.entity_type === 'controller' ||
         s.entity_type === 'model'
  );

  if (childCandidates.length === 0 || parentCandidates.length === 0) return dependencies;

  for (const child of childCandidates) {
    for (const parent of parentCandidates) {
      if (child === parent) continue;

      if (!child.start_line || !child.end_line || !parent.start_line || !parent.end_line) {
        continue;
      }

      const isContained =
        parent.start_line < child.start_line &&
        parent.end_line > child.end_line;

      if (isContained) {
        const hasIntermediateParent = parentCandidates.some(intermediate => {
          if (intermediate === parent || intermediate === child) return false;
          if (!intermediate.start_line || !intermediate.end_line) return false;

          const intermediateContainsChild =
            intermediate.start_line < child.start_line &&
            intermediate.end_line > child.end_line;

          const parentContainsIntermediate =
            parent.start_line < intermediate.start_line &&
            parent.end_line > intermediate.end_line;

          return intermediateContainsChild && parentContainsIntermediate;
        });

        if (!hasIntermediateParent) {
          dependencies.push({
            from_symbol: parent.name,
            to_symbol: child.name,
            dependency_type: DependencyType.CONTAINS,
            line_number: child.start_line,
          });
        }
      }
    }
  }

  return dependencies;
}
