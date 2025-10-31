import { Symbol, DependencyType } from '../../database/models';
import { ParsedDependency } from '../../parsers/base';
import { SymbolNode, SymbolEdge } from './types';
import { SymbolResolver } from '../symbol-resolver';
import { removeDuplicateEdges } from './name-parsing-utils';
import { getLanguageFromPath, areLanguagesCompatible } from './language-detection-utils';
import { createNameToSymbolMap, getSymbolClassName } from './symbol-lookup-utils';
import { buildInterfaceToImplementationMap, enhancedSymbolLookup } from './symbol-resolution';

function isImportStrategy(strategy: string): boolean {
  return strategy.includes(':imports') ||
         strategy.includes(':exports') ||
         strategy === 'imports' ||
         strategy === 'exports';
}

export function createSymbolEdges(
  symbols: Symbol[],
  dependenciesMap: Map<number, ParsedDependency[]>,
  nodes: SymbolNode[],
  useFileAwareResolution: boolean,
  fileIdToPath: Map<number, string>,
  symbolResolver: SymbolResolver,
  seenExternalPatterns: Set<string>,
  suppressedExternalCount: { value: number },
  suppressedAmbiguousCount: { value: number },
  logger: any
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];

  if (useFileAwareResolution) {
    const dependenciesByFile = new Map<
      number,
      { symbol: Symbol; dependencies: ParsedDependency[] }[]
    >();

    for (const symbol of symbols) {
      const dependencies = dependenciesMap.get(symbol.id) || [];
      if (dependencies.length > 0) {
        const fileList = dependenciesByFile.get(symbol.file_id) || [];
        fileList.push({ symbol, dependencies });
        dependenciesByFile.set(symbol.file_id, fileList);
      }
    }

    const nameToSymbolMap = createNameToSymbolMap(nodes);

    const interfaceMap = buildInterfaceToImplementationMap(nodes, edges, logger);

    for (const [fileId, symbolDeps] of dependenciesByFile) {
      const allDepsForFile = symbolDeps.flatMap(sd => sd.dependencies);

      const resolved = symbolResolver.resolveDependencies(fileId, allDepsForFile);


      const resolvedDependencies = new Set<string>();

      for (const resolution of resolved) {
        if (
          resolution.fromSymbol.id === resolution.toSymbol.id &&
          resolution.originalDependency.dependency_type !== DependencyType.CALLS
        ) {
          continue;
        }

        edges.push({
          from: resolution.fromSymbol.id,
          to: resolution.toSymbol.id,
          type: resolution.originalDependency.dependency_type,
          lineNumber: resolution.originalDependency.line_number,
          to_qualified_name: resolution.originalDependency.to_qualified_name,
          parameter_context: resolution.originalDependency.parameter_context,
          call_instance_id: resolution.originalDependency.call_instance_id,
          parameter_types: resolution.originalDependency.parameter_types,
          calling_object: resolution.originalDependency.calling_object,
          qualified_context: resolution.originalDependency.qualified_context,
          resolved_class: resolution.originalDependency.resolved_class,
        });

        if (resolution.resolutionStrategy && isImportStrategy(resolution.resolutionStrategy)) {
          edges.push({
            from: resolution.fromSymbol.id,
            to: resolution.toSymbol.id,
            type: DependencyType.IMPORTS,
            lineNumber: resolution.originalDependency.line_number,
            to_qualified_name: resolution.originalDependency.to_qualified_name,
          });
        }

        const depKey = `${resolution.fromSymbol.id}->${resolution.originalDependency.to_symbol}:${resolution.originalDependency.line_number}`;
        resolvedDependencies.add(depKey);
      }

      for (const { symbol, dependencies } of symbolDeps) {
        for (const dep of dependencies) {
          const depKey = `${symbol.id}->${dep.to_symbol}:${dep.line_number}`;

          if (resolvedDependencies.has(depKey)) {
            continue;
          }

          let targetSymbols = enhancedSymbolLookup(dep.to_symbol, nameToSymbolMap, interfaceMap, seenExternalPatterns, suppressedExternalCount, suppressedAmbiguousCount, logger);

          if (targetSymbols.length > 0 && useFileAwareResolution) {
            const sourceFilePath = fileIdToPath.get(symbol.file_id) || '';
            const sourceLanguage = getLanguageFromPath(sourceFilePath);

            targetSymbols = targetSymbols.filter(ts => {
              const targetFilePath = fileIdToPath.get(ts.fileId) || '';
              const targetLanguage = getLanguageFromPath(targetFilePath);

              const isCompatible = areLanguagesCompatible(sourceLanguage, targetLanguage);

              if (!isCompatible) {
                logger.debug('Filtered cross-language symbol resolution', {
                  from: symbol.name,
                  fromFile: sourceFilePath,
                  fromLang: sourceLanguage,
                  to: ts.name,
                  toFile: targetFilePath,
                  toLang: targetLanguage,
                  dependency: dep.dependency_type
                });
              }

              return isCompatible;
            });
          }

          if (targetSymbols.length > 0) {
            let finalTargets = targetSymbols;
            if (dep.dependency_type === DependencyType.CALLS && targetSymbols.length > 1) {
              const contextInfo = dep.resolved_class || dep.qualified_context;

              if (contextInfo) {
                const contextMatch = targetSymbols.filter(ts => {
                  let className = contextInfo;

                  if (contextInfo.includes('.')) {
                    const qualifierParts = contextInfo.split('.');
                    className = qualifierParts[0];
                  }
                  if (contextInfo.startsWith('field_call_')) {
                    className = contextInfo.replace('field_call_', '').replace(/^_/, '');
                    className = className.charAt(0).toUpperCase() + className.slice(1);
                  }

                  const symbolClassName = getSymbolClassName(ts, nodes, fileIdToPath);
                  const isMatch = symbolClassName.toLowerCase() === className.toLowerCase();

                  return isMatch;
                });

                if (contextMatch.length > 0) {
                  finalTargets = contextMatch;
                } else {
                  const interfaceMatch = targetSymbols.filter(ts => {
                    const symbolClassName = getSymbolClassName(ts, nodes, fileIdToPath);
                    if (symbolClassName.toLowerCase() === contextInfo.toLowerCase()) {
                      return true;
                    }
                    const implementations = interfaceMap.get(contextInfo) || [];
                    return implementations.some(impl => impl.name.toLowerCase() === symbolClassName.toLowerCase());
                  });

                  if (interfaceMatch.length > 0) {
                    finalTargets = interfaceMatch;
                    logger?.debug('Resolved via interface mapping', {
                      from_symbol: symbol.name,
                      to_symbol: dep.to_symbol,
                      interface: contextInfo,
                      implementations: interfaceMatch.map(m => getSymbolClassName(m, nodes, fileIdToPath))
                    });
                  }
                }
              }

              if (finalTargets.length > 1) {
                if (contextInfo) {
                  finalTargets = [finalTargets[0]];
                  logger?.debug('Multiple matches after disambiguation, using first match', {
                    from_symbol: symbol.name,
                    to_symbol: dep.to_symbol,
                    selected: finalTargets[0].name,
                    resolved_class: dep.resolved_class
                  });
                } else {
                  logger?.warn('Skipping ambiguous method call dependency (no context)', {
                    from_symbol: symbol.name,
                    to_symbol: dep.to_symbol,
                    matches: finalTargets.length
                  });
                  continue;
                }
              }
            }

            for (const targetSymbol of finalTargets) {
              if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
                continue;
              }

              if (dep.dependency_type === DependencyType.CONTAINS &&
                  symbol.file_id !== targetSymbol.fileId) {
                continue;
              }

              edges.push({
                from: symbol.id,
                to: targetSymbol.id,
                type: dep.dependency_type,
                lineNumber: dep.line_number,
                to_qualified_name: dep.to_qualified_name,
                parameter_context: dep.parameter_context,
                call_instance_id: dep.call_instance_id,
                parameter_types: dep.parameter_types,
                calling_object: dep.calling_object,
                qualified_context: dep.qualified_context,
                resolved_class: dep.resolved_class,
              });
            }
          } else {
            if (dep.dependency_type === DependencyType.CALLS) {
            }
          }
        }
      }
    }

  } else {
    const nameToSymbolMap = createNameToSymbolMap(nodes);
    const interfaceMap = buildInterfaceToImplementationMap(nodes, edges, logger);

    for (const symbol of symbols) {
      const dependencies = dependenciesMap.get(symbol.id) || [];

      for (const dep of dependencies) {
        const targetSymbols = enhancedSymbolLookup(dep.to_symbol, nameToSymbolMap, interfaceMap, seenExternalPatterns, suppressedExternalCount, suppressedAmbiguousCount, logger);

        let finalTargets = targetSymbols;
        if (dep.dependency_type === DependencyType.CALLS && targetSymbols.length > 1) {
          const contextInfo = dep.resolved_class || dep.qualified_context;

          if (contextInfo) {
            const contextMatch = targetSymbols.filter(ts => {
              let className = contextInfo;

              if (contextInfo.includes('.')) {
                const qualifierParts = contextInfo.split('.');
                className = qualifierParts[0];
              }
              if (contextInfo.startsWith('field_call_')) {
                className = contextInfo.replace('field_call_', '').replace(/^_/, '');
                className = className.charAt(0).toUpperCase() + className.slice(1);
              }

              const symbolClassName = getSymbolClassName(ts, nodes, fileIdToPath);
              return symbolClassName.toLowerCase() === className.toLowerCase();
            });

            if (contextMatch.length > 0) {
              finalTargets = contextMatch;
            } else {
              const interfaceMatch = targetSymbols.filter(ts => {
                const symbolClassName = getSymbolClassName(ts, nodes, fileIdToPath);
                if (symbolClassName.toLowerCase() === contextInfo.toLowerCase()) {
                  return true;
                }
                const implementations = interfaceMap.get(contextInfo) || [];
                return implementations.some(impl => impl.name.toLowerCase() === symbolClassName.toLowerCase());
              });

              if (interfaceMatch.length > 0) {
                finalTargets = interfaceMatch;
                logger?.debug('Resolved via interface mapping (non-file-aware)', {
                  from_symbol: symbol.name,
                  to_symbol: dep.to_symbol,
                  interface: contextInfo,
                  implementations: interfaceMatch.map(m => getSymbolClassName(m, nodes, fileIdToPath))
                });
              }
            }
          }

          if (finalTargets.length > 1) {
            if (contextInfo) {
              finalTargets = [finalTargets[0]];
              logger?.debug('Multiple matches after disambiguation (non-file-aware), using first match', {
                from_symbol: symbol.name,
                to_symbol: dep.to_symbol,
                selected: finalTargets[0].name,
                resolved_class: dep.resolved_class
              });
            } else {
              logger?.warn('Skipping ambiguous method call dependency (non-file-aware, no context)', {
                from_symbol: symbol.name,
                to_symbol: dep.to_symbol,
                matches: finalTargets.length
              });
              continue;
            }
          }
        }

        for (const targetSymbol of finalTargets) {
          if (symbol.id === targetSymbol.id && dep.dependency_type !== DependencyType.CALLS) {
            continue;
          }

          if (dep.dependency_type === DependencyType.CONTAINS &&
              symbol.file_id !== targetSymbol.fileId) {
            continue;
          }

          edges.push({
            from: symbol.id,
            to: targetSymbol.id,
            type: dep.dependency_type,
            lineNumber: dep.line_number,
            to_qualified_name: dep.to_qualified_name,
            parameter_context: dep.parameter_context,
            call_instance_id: dep.call_instance_id,
            parameter_types: dep.parameter_types,
            calling_object: dep.calling_object,
            qualified_context: dep.qualified_context,
            resolved_class: dep.resolved_class,
          });
        }
      }
    }
  }

  return removeDuplicateEdges(edges);
}
