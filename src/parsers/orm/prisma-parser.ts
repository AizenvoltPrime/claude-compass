/**
 * Prisma schema parser
 * Parses Prisma schema files (.prisma) and extracts models, fields, relationships, and indexes
 */

import * as path from 'path';
import { ORMType, RelationType, ORMEntity, ORMField, ORMRelationship } from './types';
import { extractDefaultValue, extractRelationField } from './extraction-utils';
import { SymbolType } from '../../database/models';

export async function parsePrismaSchema(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[],
  getLineNumber: (position: number, content: string) => number
): Promise<void> {
  // Parse Prisma models
  const modelRegex = /model\s+(\w+)\s*{([^}]+)}/g;
  let modelMatch;

  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const modelName = modelMatch[1];
    const modelBody = modelMatch[2];

    const entity: ORMEntity = {
      name: modelName,
      fileName: path.basename(filePath),
      orm: ORMType.PRISMA,
      fields: [],
      relationships: [],
      indexes: [],
      validations: [],
    };

    // Parse fields and relationships
    const fieldLines = modelBody
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'));

    for (const line of fieldLines) {
      if (line.includes('@@')) {
        // Parse model-level directives (indexes, etc.)
        parsePrismaModelDirective(line, entity);
      } else {
        // Parse field definitions
        parsePrismaField(line, entity);
      }
    }

    entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(modelName);

    // Create symbol for the model
    symbols.push({
      name: modelName,
      symbol_type: SymbolType.ORM_ENTITY,
      start_line: getLineNumber(modelMatch.index!, content),
      end_line: getLineNumber(modelMatch.index! + modelMatch[0].length, content),
      is_exported: true,
    });
  }

  // Parse enums
  const enumRegex = /enum\s+(\w+)\s*{([^}]+)}/g;
  let enumMatch;

  while ((enumMatch = enumRegex.exec(content)) !== null) {
    const enumName = enumMatch[1];

    symbols.push({
      name: enumName,
      symbol_type: SymbolType.ENUM,
      start_line: getLineNumber(enumMatch.index!, content),
      end_line: getLineNumber(enumMatch.index! + enumMatch[0].length, content),
      is_exported: true,
    });
  }
}

export function parsePrismaField(line: string, entity: ORMEntity): void {
  // Parse field definition: fieldName FieldType modifiers
  const fieldMatch = line.match(/(\w+)\s+(\w+(\[\])?(\?)?)\s*(.*)/);
  if (!fieldMatch) return;

  const fieldName = fieldMatch[1];
  const fieldType = fieldMatch[2];
  const modifiers = fieldMatch[5] || '';

  const field: ORMField = {
    name: fieldName,
    type: fieldType,
    nullable: fieldType.includes('?'),
    primaryKey: modifiers.includes('@id'),
    unique: modifiers.includes('@unique'),
    autoGenerate:
      modifiers.includes('@default(autoincrement())') || modifiers.includes('@default(cuid())'),
    defaultValue: extractDefaultValue(modifiers),
  };

  entity.fields.push(field);

  // Check for relationships
  if (modifiers.includes('@relation')) {
    const relationship = parsePrismaRelation(fieldName, fieldType, modifiers);
    if (relationship) {
      entity.relationships.push(relationship);
    }
  }
}

export function parsePrismaRelation(
  fieldName: string,
  fieldType: string,
  modifiers: string
): ORMRelationship | null {
  const relationMatch = modifiers.match(/@relation\(([^)]+)\)/);
  if (!relationMatch) return null;

  const relationType = fieldType.includes('[]')
    ? RelationType.ONE_TO_MANY
    : RelationType.MANY_TO_ONE;

  return {
    name: fieldName,
    type: relationType,
    targetEntity: fieldType.replace('[]', '').replace('?', ''),
    foreignKey: extractRelationField(relationMatch[1], 'fields'),
    inverseProperty: extractRelationField(relationMatch[1], 'references'),
  };
}

export function parsePrismaModelDirective(line: string, entity: ORMEntity): void {
  if (line.includes('@@index')) {
    const indexMatch = line.match(/@@index\(\[([^\]]+)\]/);
    if (indexMatch) {
      const fields = indexMatch[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
      entity.indexes.push({
        fields,
        unique: false,
      });
    }
  } else if (line.includes('@@unique')) {
    const uniqueMatch = line.match(/@@unique\(\[([^\]]+)\]/);
    if (uniqueMatch) {
      const fields = uniqueMatch[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
      entity.indexes.push({
        fields,
        unique: true,
      });
    }
  }
}
