import { Symbol, SymbolType, Visibility } from '../../../database/models';
import { IVirtualSymbolFactory, VirtualSymbolConfig } from '../interfaces';
import { createComponentLogger } from '../../../utils/logger';

const logger = createComponentLogger('virtual-symbol-factory');

export class VirtualSymbolFactory implements IVirtualSymbolFactory {
  private virtualSymbolCache: Map<string, Symbol> = new Map();
  private usedIds: Set<number> = new Set();
  private nextVirtualId: number = -1000000;

  createFrameworkSymbol(config: VirtualSymbolConfig): Symbol {
    const key = this.generateFrameworkKey(config);
    const cached = this.virtualSymbolCache.get(key);

    if (cached) {
      logger.debug('Reusing cached framework symbol', { name: config.name, framework: config.framework });
      return cached;
    }

    const virtualSymbol = this.createVirtualSymbol(config, -1);
    this.virtualSymbolCache.set(key, virtualSymbol);

    logger.debug('Created new framework symbol', {
      name: config.name,
      framework: config.framework,
      id: virtualSymbol.id
    });

    return virtualSymbol;
  }

  createExternalLibrarySymbol(config: VirtualSymbolConfig): Symbol {
    const key = this.generateExternalKey(config);
    const cached = this.virtualSymbolCache.get(key);

    if (cached) {
      logger.debug('Reusing cached external library symbol', { name: config.name, library: config.library });
      return cached;
    }

    const virtualSymbol = this.createVirtualSymbol(config, -2);
    this.virtualSymbolCache.set(key, virtualSymbol);

    logger.debug('Created new external library symbol', {
      name: config.name,
      library: config.library,
      id: virtualSymbol.id
    });

    return virtualSymbol;
  }

  getVirtualSymbol(key: string): Symbol | undefined {
    return this.virtualSymbolCache.get(key);
  }

  getAllVirtualSymbols(): Symbol[] {
    return Array.from(this.virtualSymbolCache.values());
  }

  clear(): void {
    this.virtualSymbolCache.clear();
    this.usedIds.clear();
    this.nextVirtualId = -1000000;
    logger.debug('Virtual symbol factory cleared');
  }

  private createVirtualSymbol(config: VirtualSymbolConfig, fileIdIndicator: number): Symbol {
    const id = this.generateUniqueId(config);

    const signature = config.signature || this.generateSignature(config);

    const virtualSymbol: Symbol = {
      id,
      file_id: fileIdIndicator,
      name: config.name,
      symbol_type: config.type,
      start_line: 1,
      end_line: 1,
      is_exported: true,
      visibility: config.visibility || Visibility.PUBLIC,
      signature,
      description: config.description,
      framework: config.framework || config.library,
      created_at: new Date(),
      updated_at: new Date(),
    };

    return virtualSymbol;
  }

  private generateUniqueId(config: VirtualSymbolConfig): number {
    let candidateId = this.nextVirtualId;
    let attempts = 0;
    const maxAttempts = 1000;

    while (this.usedIds.has(candidateId) && attempts < maxAttempts) {
      candidateId--;
      attempts++;
    }

    if (attempts >= maxAttempts) {
      logger.error('Failed to generate unique virtual symbol ID after max attempts', {
        name: config.name,
        type: config.type,
        framework: config.framework,
        library: config.library
      });
      throw new Error(`Failed to generate unique virtual symbol ID for ${config.name}`);
    }

    this.usedIds.add(candidateId);
    this.nextVirtualId = candidateId - 1;

    return candidateId;
  }

  private generateFrameworkKey(config: VirtualSymbolConfig): string {
    return `framework:${config.framework}:${config.type}:${config.name}`;
  }

  private generateExternalKey(config: VirtualSymbolConfig): string {
    return `external:${config.library}:${config.type}:${config.name}`;
  }

  private generateSignature(config: VirtualSymbolConfig): string {
    const source = config.framework || config.library || 'unknown';
    return `${source}::${config.name}`;
  }
}
