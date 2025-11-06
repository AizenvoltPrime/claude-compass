/**
 * Direction Resolver
 *
 * Determines traversal direction for symbols based on their role, entity type,
 * depth, and parent context. Prevents transitive 'both' explosion while enabling
 * legitimate bidirectional discovery.
 */

import type {
  SymbolInfo,
  TraversalDirection,
} from './symbol-classifier';
import { getTraversalDirection, SymbolRole } from './symbol-classifier';
import type { SymbolGraphQueries } from './symbol-graph-queries';

export class DirectionResolver {
  constructor(
    private readonly queries: SymbolGraphQueries,
    private readonly entryPointEntityType?: string
  ) {}

  async resolveInitialDirection(
    symbol: SymbolInfo,
    role: SymbolRole
  ): Promise<TraversalDirection> {
    let direction = getTraversalDirection(symbol, role);

    if (role === SymbolRole.EXECUTOR && symbol.symbol_type === 'method') {
      const parentEntityType = await this.queries.getParentEntityType(symbol.id);
      if (parentEntityType === 'service') {
        direction = 'both';
      }
    }

    return direction;
  }

  async resolveNextDirection(
    currentDirection: TraversalDirection,
    targetRole: SymbolRole,
    targetSymbol: SymbolInfo,
    currentDepth: number
  ): Promise<TraversalDirection> {
    if (targetRole === SymbolRole.EXECUTOR) {
      const parentEntityType = await this.queries.getParentEntityType(targetSymbol.id);

      if (parentEntityType === 'controller' || parentEntityType === 'store') {
        if ((currentDirection === 'backward' || currentDirection === 'both') && currentDepth <= 1) {
          return currentDirection === 'backward' ? 'backward' : 'both';
        }
        return 'forward';
      }

      return 'forward';
    }

    if (targetRole === SymbolRole.ENTITY || targetRole === SymbolRole.CONTAINER) {
      const naturalDirection = getTraversalDirection(targetSymbol, targetRole);

      if ((naturalDirection === 'backward' || naturalDirection === 'both') && currentDepth > 0) {
        return 'forward';
      }

      return naturalDirection;
    }

    return getTraversalDirection(targetSymbol, targetRole);
  }

  resolveMethodDirection(
    targetSymbol: SymbolInfo,
    direction: TraversalDirection,
    depth: number
  ): TraversalDirection {
    let methodDirection: TraversalDirection = direction;

    if (targetSymbol.entity_type === 'service') {
      const containerDepth = depth + 1;
      if (containerDepth === 1) {
        methodDirection = 'both';
      } else if (containerDepth > 1) {
        methodDirection = 'forward';
      }
    } else if (depth > 0 && targetSymbol.entity_type === 'model') {
      methodDirection = 'forward';
    }

    return methodDirection;
  }
}
