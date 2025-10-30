import { SymbolType, Visibility } from '../../../database/models';
import { FrameworkSymbol } from '../core/interfaces';

/**
 * Initialize .NET Framework symbols
 */
export function initializeDotNetFrameworkSymbols(): FrameworkSymbol[] {
  const symbols: FrameworkSymbol[] = [];

  // System.Threading namespace
  const threadingTypes = [
    'SemaphoreSlim', 'ReaderWriterLockSlim', 'Mutex', 'AutoResetEvent', 'ManualResetEvent',
    'CountdownEvent', 'Barrier', 'Thread', 'Task', 'CancellationToken', 'CancellationTokenSource'
  ];

  for (const type of threadingTypes) {
    symbols.push({
      name: type,
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'System.Threading',
      signature: `class ${type}`,
      description: `System.Threading.${type}`
    });

    // Add common methods for threading types
    const commonMethods = ['WaitAsync', 'Release', 'EnterWriteLock', 'ExitWriteLock', 'EnterReadLock', 'ExitReadLock', 'Dispose'];
    for (const method of commonMethods) {
      symbols.push({
        name: `${type}.${method}`,
        symbol_type: SymbolType.METHOD,
        visibility: Visibility.PUBLIC,
        framework: 'System.Threading',
        signature: `${method}()`,
        description: `${type}.${method} method`
      });
    }
  }

  // System namespace common types
  const systemTypes = [
    'Exception', 'ArgumentException', 'InvalidOperationException', 'NotSupportedException',
    'IDisposable', 'IAsyncDisposable', 'EventArgs', 'DateTime', 'TimeSpan', 'Guid', 'Uri'
  ];

  for (const type of systemTypes) {
    symbols.push({
      name: type,
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'System',
      signature: `class ${type}`,
      description: `System.${type}`
    });
  }

  const exceptionProperties = [
    'Message', 'StackTrace', 'Source', 'HelpLink', 'HResult',
    'InnerException', 'Data', 'TargetSite'
  ];

  for (const prop of exceptionProperties) {
    symbols.push({
      name: prop,
      symbol_type: SymbolType.PROPERTY,
      visibility: Visibility.PUBLIC,
      framework: 'System',
      signature: `Exception.${prop}`,
      description: `Exception.${prop} property`
    });
  }

  // System.Collections.Generic
  const collectionTypes = ['List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'IEnumerable', 'ICollection'];
  for (const type of collectionTypes) {
    symbols.push({
      name: type,
      symbol_type: SymbolType.CLASS,
      visibility: Visibility.PUBLIC,
      framework: 'System.Collections.Generic',
      signature: `class ${type}<T>`,
      description: `System.Collections.Generic.${type}`
    });
  }

  const listMethods = [
    'Add', 'AddRange', 'Clear', 'Contains', 'Remove', 'RemoveAt', 'RemoveAll',
    'Insert', 'InsertRange', 'IndexOf', 'LastIndexOf', 'Find', 'FindAll',
    'FindIndex', 'FindLast', 'FindLastIndex', 'Sort', 'Reverse', 'ToArray',
    'CopyTo', 'GetRange', 'Count', 'ForEach', 'Exists', 'TrueForAll', 'constructor'
  ];

  for (const method of listMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'System.Collections.Generic',
      signature: `List<T>.${method}()`,
      description: `List<T>.${method} method`
    });
  }

  const dictionaryMethods = [
    'Add', 'Clear', 'ContainsKey', 'ContainsValue', 'Remove', 'TryGetValue',
    'TryAdd', 'GetValueOrDefault', 'Keys', 'Values', 'Count', 'constructor'
  ];

  for (const method of dictionaryMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'System.Collections.Generic',
      signature: `Dictionary<TKey,TValue>.${method}()`,
      description: `Dictionary<TKey,TValue>.${method} method`
    });
  }

  const hashSetMethods = [
    'Add', 'Clear', 'Contains', 'Remove', 'RemoveWhere', 'UnionWith',
    'IntersectWith', 'ExceptWith', 'SymmetricExceptWith', 'IsSubsetOf',
    'IsSupersetOf', 'Overlaps', 'SetEquals', 'Count', 'constructor'
  ];

  for (const method of hashSetMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'System.Collections.Generic',
      signature: `HashSet<T>.${method}()`,
      description: `HashSet<T>.${method} method`
    });
  }

  // Common method names that might appear
  const frameworkMethods = [
    'WaitAsync', 'Release', 'EnterWriteLock', 'ExitWriteLock', 'EnterReadLock', 'ExitReadLock',
    'Dispose', 'ToString', 'GetHashCode', 'Equals', 'GetType', 'nameof'
  ];

  for (const method of frameworkMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'System',
      signature: `${method}()`,
      description: `Framework method ${method}`
    });
  }

  // System.Linq extension methods
  const linqMethods = [
    'Select', 'Where', 'OrderBy', 'OrderByDescending', 'GroupBy', 'Join',
    'First', 'FirstOrDefault', 'Last', 'LastOrDefault', 'Single', 'SingleOrDefault',
    'Any', 'All', 'Count', 'Sum', 'Average', 'Min', 'Max',
    'ToList', 'ToArray', 'ToDictionary', 'ToHashSet',
    'Skip', 'Take', 'Distinct', 'Union', 'Intersect', 'Except',
    'Concat', 'Zip', 'Aggregate', 'Contains', 'SequenceEqual'
  ];

  for (const method of linqMethods) {
    symbols.push({
      name: method,
      symbol_type: SymbolType.METHOD,
      visibility: Visibility.PUBLIC,
      framework: 'System.Linq',
      signature: `${method}()`,
      description: `LINQ extension method ${method}`
    });
  }

  // Common enum values that might appear in code (like ServiceState)
  const commonEnumValues = [
    'Idle', 'StartingTurn', 'ExecutingPhase', 'TransitioningPhase', 'Stopped', 'Running', 'Paused',
    'Success', 'Failed', 'Pending', 'Completed', 'InProgress'
  ];

  for (const enumValue of commonEnumValues) {
    symbols.push({
      name: enumValue,
      symbol_type: SymbolType.VARIABLE,
      visibility: Visibility.PUBLIC,
      framework: 'System',
      signature: enumValue,
      description: `Common enum value ${enumValue}`
    });
  }

  return symbols;
}
