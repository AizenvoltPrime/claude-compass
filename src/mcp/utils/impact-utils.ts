import { DependencyType, SimplifiedDependency } from '../../database/models';
import { ImpactItem } from '../types';
import { getClassNameFromPath } from './path-utils';
import { createComponentLogger } from '../../utils/logger';

const logger = createComponentLogger('impact-utils');

export function deduplicateImpactItems(items: ImpactItem[]): ImpactItem[] {
  const seen = new Set<string>();
  const deduplicatedItems: ImpactItem[] = [];

  for (const item of items) {
    const compositeKey = `${item.id}:${item.file_path}:${item.relationship_type || 'unknown'}:${item.line_number || 'unknown'}`;

    if (!seen.has(compositeKey)) {
      seen.add(compositeKey);
      deduplicatedItems.push(item);
    }
  }

  return deduplicatedItems;
}

export function convertImpactItemsToSimplifiedDeps(
  impactItems: ImpactItem[],
  targetSymbolName: string,
  targetSymbolFilePath: string | undefined,
  originalDependencies: any[]
): SimplifiedDependency[] {
  return impactItems.map(item => {
    if (!item.line_number) {
      logger.error('ImpactItem missing line_number', {
        item_id: item.id,
        item_name: item.name,
        direction: item.direction,
      });
    }
    if (!item.file_path) {
      logger.error('ImpactItem missing file_path', {
        item_id: item.id,
        item_name: item.name,
        direction: item.direction,
      });
    }
    if (!targetSymbolFilePath) {
      logger.error('Target symbol missing file path', {
        target_name: targetSymbolName,
      });
    }

    let from: string, to: string, filePath: string | undefined;
    if (item.direction === 'dependency') {
      from = targetSymbolFilePath
        ? `${getClassNameFromPath(targetSymbolFilePath)}.${targetSymbolName}`
        : targetSymbolName;

      if (item.to_qualified_name) {
        to = item.to_qualified_name;
      } else {
        to = item.file_path
          ? `${getClassNameFromPath(item.file_path)}.${item.name}`
          : item.name;
      }
      filePath = targetSymbolFilePath;
    } else if (item.direction === 'caller') {
      from = item.file_path
        ? `${getClassNameFromPath(item.file_path)}.${item.name}`
        : item.name;
      to = targetSymbolFilePath
        ? `${getClassNameFromPath(targetSymbolFilePath)}.${targetSymbolName}`
        : targetSymbolName;
      filePath = item.file_path;
    } else {
      throw new Error(`Invalid direction field in ImpactItem: ${item.direction}`);
    }

    if (!filePath && item.framework) {
      const frameworkName = item.framework.charAt(0).toUpperCase() + item.framework.slice(1);
      filePath = `[${frameworkName} Framework]`;
    }

    const dep: SimplifiedDependency = {
      from,
      to,
      type: item.relationship_type as DependencyType,
      line_number: item.line_number,
      file_path: filePath,
    };

    if (item.call_chain) {
      dep.call_chain = item.call_chain;
      dep.depth = item.depth;
    }

    return dep;
  });
}
