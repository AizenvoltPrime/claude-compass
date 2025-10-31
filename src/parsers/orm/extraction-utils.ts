/**
 * Field and relationship extraction utilities
 * Helper functions for extracting field types, default values, and relationship properties
 */

import * as path from 'path';
import { RelationType } from './types';

export function extractDefaultValue(modifiers: string): any {
  const defaultMatch = modifiers.match(/@default\(([^)]+)\)/);
  if (!defaultMatch) return undefined;

  const defaultValue = defaultMatch[1];
  if (defaultValue === 'autoincrement()' || defaultValue === 'cuid()') return null;
  if (defaultValue === 'now()') return new Date();
  if (defaultValue.startsWith('"') && defaultValue.endsWith('"')) {
    return defaultValue.slice(1, -1);
  }
  return defaultValue;
}

export function extractRelationField(relationParams: string, fieldType: string): string | undefined {
  const regex = new RegExp(`${fieldType}:\\s*\\[([^\\]]+)\\]`);
  const match = relationParams.match(regex);
  return match ? match[1].replace(/['"]/g, '') : undefined;
}

export function extractTypeORMInverseProperty(relationParams: string): string | undefined {
  const inverseMatch = relationParams.match(/(\w+)\s*=>\s*\w+\.(\w+)/);
  return inverseMatch ? inverseMatch[2] : undefined;
}

export function extractMikroORMInverseProperty(relationParams: string): string | undefined {
  const inverseMatch = relationParams.match(/inversedBy:\s*['"`](\w+)['"`]/);
  return inverseMatch ? inverseMatch[1] : undefined;
}

export function extractSequelizeFieldType(fieldConfig: string): string {
  const typeMatch = fieldConfig.match(/type:\s*DataTypes\.(\w+)/);
  return typeMatch ? typeMatch[1] : 'unknown';
}

export function extractMongooseFieldType(fieldConfig: string): string {
  const typeMatch = fieldConfig.match(/type:\s*(\w+)/) || fieldConfig.match(/^(\w+)$/);
  return typeMatch ? typeMatch[1] : 'unknown';
}

export function extractJsonSchemaType(fieldConfig: string): string {
  const typeMatch = fieldConfig.match(/type:\s*['"`](\w+)['"`]/);
  return typeMatch ? typeMatch[1] : 'unknown';
}

export function extractObjectionRelationType(relationConfig: string): RelationType | null {
  if (relationConfig.includes('BelongsToOneRelation')) return RelationType.BELONGS_TO;
  if (relationConfig.includes('HasManyRelation')) return RelationType.HAS_MANY;
  if (relationConfig.includes('HasOneRelation')) return RelationType.HAS_ONE;
  if (relationConfig.includes('ManyToManyRelation')) return RelationType.MANY_TO_MANY;
  return null;
}

export function extractObjectionTargetModel(relationConfig: string): string | null {
  const modelMatch = relationConfig.match(/modelClass:\s*['"`]([^'"`]+)['"`]/);
  if (modelMatch) return modelMatch[1];

  const requireMatch = relationConfig.match(/modelClass:\s*require\(['"`]([^'"`]+)['"`]\)/);
  if (requireMatch) {
    const modulePath = requireMatch[1];
    return path.basename(modulePath, path.extname(modulePath));
  }

  return null;
}
