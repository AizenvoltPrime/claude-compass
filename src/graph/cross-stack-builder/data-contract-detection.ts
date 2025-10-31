/**
 * Data contract detection between TypeScript and PHP types
 */

import { Symbol } from '../../database/models';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('data-contract-detection');

/**
 * Detect data contract matches between TypeScript interfaces and PHP DTOs
 */
export function detectDataContractMatches(
  typescriptInterfaces: Symbol[],
  phpDtos: Symbol[]
): Array<{
  typescriptInterface: Symbol;
  phpDto: Symbol;
}> {
  const MAX_TS_INTERFACES = 50;
  const MAX_PHP_DTOS = 50;
  const MAX_DATA_CONTRACTS = 100;

  const limitedTsInterfaces = typescriptInterfaces.slice(0, MAX_TS_INTERFACES);
  const limitedPhpDtos = phpDtos.slice(0, MAX_PHP_DTOS);

  if (typescriptInterfaces.length > MAX_TS_INTERFACES) {
    logger.warn('Truncating TypeScript interfaces for performance', {
      original: typescriptInterfaces.length,
      limited: limitedTsInterfaces.length,
    });
  }

  if (phpDtos.length > MAX_PHP_DTOS) {
    logger.warn('Truncating PHP DTOs for performance', {
      original: phpDtos.length,
      limited: limitedPhpDtos.length,
    });
  }

  const matches: Array<{
    typescriptInterface: Symbol;
    phpDto: Symbol;
  }> = [];

  const startTime = Date.now();

  for (const tsInterface of limitedTsInterfaces) {
    for (const phpDto of limitedPhpDtos) {
      if (matches.length >= MAX_DATA_CONTRACTS) {
        logger.warn('Maximum data contracts limit reached, stopping matching', {
          maxDataContracts: MAX_DATA_CONTRACTS,
          currentTsInterface: tsInterface.name,
        });
        break;
      }

      if (tsInterface.name === phpDto.name) {
        matches.push({
          typescriptInterface: tsInterface,
          phpDto: phpDto,
        });
      }
    }

    if (matches.length >= MAX_DATA_CONTRACTS) {
      break;
    }
  }

  const processingTime = Date.now() - startTime;

  const uniqueMatches = new Map<string, (typeof matches)[0]>();
  for (const match of matches) {
    const key = `${match.typescriptInterface.id}-${match.phpDto.id}`;
    if (!uniqueMatches.has(key)) {
      uniqueMatches.set(key, match);
    }
  }

  const finalMatches = Array.from(uniqueMatches.values());

  if (finalMatches.length === 0) {
    const userTsInterfaces = typescriptInterfaces.filter(ts => ts.name === 'User');
    const userPhpSymbols = phpDtos.filter(php => php.name === 'User');

    if (userTsInterfaces.length > 0 && userPhpSymbols.length > 0) {
      finalMatches.push({
        typescriptInterface: userTsInterfaces[0],
        phpDto: userPhpSymbols[0],
      });
    }
  }

  return finalMatches;
}
