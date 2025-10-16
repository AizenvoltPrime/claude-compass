import { DependencyType } from '../../database/models';

export function classifyRelationshipImpact(
  dependency: any,
  direction: 'dependency' | 'caller'
):
  | 'direct'
  | 'indirect'
  | 'cross_stack'
  | 'interface_contract'
  | 'implementation'
  | 'delegation' {
  const depType = dependency.dependency_type;

  if (isCrossStackRelationship(dependency)) {
    return 'cross_stack';
  }

  switch (depType) {
    case 'implements':
      return 'interface_contract';

    case 'inherits':
      return 'implementation';

    case 'calls':
      if (isDelegationPattern(dependency)) {
        return 'delegation';
      }
      return 'direct';

    case 'references':
      return 'direct';

    case 'imports':
      return 'direct';

    default:
      return 'direct';
  }
}

export function getRelationshipContext(dependency: any): string {
  const depType = dependency.dependency_type;
  const fromSymbol = dependency.from_symbol;
  const toSymbol = dependency.to_symbol;

  const contextParts: string[] = [];

  if (fromSymbol && toSymbol) {
    contextParts.push(`${fromSymbol.name} ${depType} ${toSymbol.name}`);
  }

  if (
    fromSymbol?.file?.path &&
    toSymbol?.file?.path &&
    fromSymbol.file.path !== toSymbol.file.path
  ) {
    contextParts.push('cross-file');
  }

  switch (depType) {
    case 'implements':
      contextParts.push('interface_implementation');
      break;
    case 'inherits':
      contextParts.push('class_inheritance');
      break;
    case 'calls':
      if (isDelegationPattern(dependency)) {
        contextParts.push('service_delegation');
      }
      break;
  }

  return contextParts.join(', ');
}

export function isDelegationPattern(dependency: any): boolean {
  const fromSymbol = dependency.from_symbol;
  const toSymbol = dependency.to_symbol;

  if (!fromSymbol || !toSymbol) return false;

  const delegationPatterns = [
    'Service',
    'Manager',
    'Handler',
    'Controller',
    'Repository',
    'Factory',
    'Provider',
    'Gateway',
    'Adapter',
    'Coordinator',
  ];

  const fromName = fromSymbol.name || '';
  const toName = toSymbol.name || '';
  const fromFile = fromSymbol.file?.path || '';
  const toFile = toSymbol.file?.path || '';

  const isFromService = delegationPatterns.some(
    pattern => fromName.includes(pattern) || fromFile.includes(pattern.toLowerCase())
  );

  const isToService = delegationPatterns.some(
    pattern => toName.includes(pattern) || toFile.includes(pattern.toLowerCase())
  );

  return isFromService || isToService;
}

export function isCrossStackRelationship(result: any): boolean {
  if (!result.dependency_type) return false;

  return (
    result.dependency_type === DependencyType.API_CALL ||
    result.dependency_type === DependencyType.SHARES_SCHEMA ||
    result.dependency_type === DependencyType.FRONTEND_BACKEND
  );
}

export function deduplicateRelationships(
  newRelationships: any[],
  existingRelationships: any[]
): any[] {
  const existingKeys = new Set<string>();

  for (const existing of existingRelationships) {
    const key = createRelationshipKey(existing);
    if (key) existingKeys.add(key);
  }

  return newRelationships.filter(newRel => {
    const key = createRelationshipKey(newRel);
    return key && !existingKeys.has(key);
  });
}

export function createRelationshipKey(relationship: any): string | null {
  const fromSymbolId = relationship.from_symbol_id || relationship.from_symbol?.id;
  const toSymbolId = relationship.to_symbol_id || relationship.to_symbol?.id;
  const depType = relationship.dependency_type || relationship.type;
  const lineNum = relationship.line_number || 0;

  if (!fromSymbolId || !toSymbolId || !depType) {
    return null;
  }

  return `${fromSymbolId}->${toSymbolId}:${depType}:${lineNum}`;
}

export function consolidateRelatedSymbols(relationships: any[]): any[] {
  const uniqueRelationships = new Map<string, any>();

  for (const rel of relationships) {
    const fromSymbolId = rel.from_symbol_id || rel.from_symbol?.id;
    const lineNumber = rel.line_number || 0;
    const depType = rel.dependency_type || rel.type;
    const toSymbolId = rel.to_symbol_id || rel.to_symbol?.id;

    const key = `${fromSymbolId}->${toSymbolId}:${depType}:${lineNumber}`;

    if (!uniqueRelationships.has(key)) {
      uniqueRelationships.set(key, rel);
    }
  }

  return Array.from(uniqueRelationships.values());
}
