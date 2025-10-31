/**
 * Objection.js model parser
 * Parses Objection.js models with JSON schema and relation mappings
 */

import * as path from 'path';
import { ORMType, ORMEntity } from './types';
import { extractJsonSchemaType, extractObjectionRelationType, extractObjectionTargetModel } from './extraction-utils';
import { createComponentLogger } from '../../utils/logger';
import { SymbolType } from '../../database/models';

const logger = createComponentLogger('orm-parser:objection');

export async function parseObjectionModel(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[]
): Promise<void> {
  const modelMatch = content.match(/class\s+(\w+)\s+extends\s+Model/);
  if (!modelMatch) return;

  const modelName = modelMatch[1];

  const entity: ORMEntity = {
    name: modelName,
    fileName: path.basename(filePath),
    orm: ORMType.OBJECTION,
    fields: [],
    relationships: [],
    indexes: [],
    validations: [],
  };

  // Parse table name
  const tableNameMatch = content.match(
    /static\s+get\s+tableName\s*\(\s*\)\s*{\s*return\s*['"`](\w+)['"`]/
  );
  if (tableNameMatch) {
    entity.tableName = tableNameMatch[1];
  }

  // Parse JSON schema for fields
  parseObjectionJsonSchema(content, entity);

  // Parse relationships
  parseObjectionRelationships(content, entity);

  entities.push(entity);

  // Track this entity name to avoid conflicts with base parser
  ormEntityNames.add(modelName);

  symbols.push({
    name: modelName,
    symbol_type: SymbolType.ORM_ENTITY,
    is_exported: true,
  });
}

export function parseObjectionJsonSchema(content: string, entity: ORMEntity): void {
  const jsonSchemaMatch = content.match(
    /static\s+get\s+jsonSchema\s*\(\s*\)\s*{\s*return\s*({[^}]+})/s
  );
  if (!jsonSchemaMatch) return;

  try {
    // Parse properties from JSON schema
    const propertiesMatch = jsonSchemaMatch[1].match(/properties\s*:\s*{([^}]+)}/s);
    if (propertiesMatch) {
      const propertiesContent = propertiesMatch[1];
      const fieldMatches = propertiesContent.match(/(\w+)\s*:\s*{([^}]+)}/g);

      if (fieldMatches) {
        for (const fieldMatch of fieldMatches) {
          const fieldParts = fieldMatch.match(/(\w+)\s*:\s*{([^}]+)}/);
          if (fieldParts) {
            const fieldName = fieldParts[1];
            const fieldConfig = fieldParts[2];

            entity.fields.push({
              name: fieldName,
              type: extractJsonSchemaType(fieldConfig),
              nullable: !fieldConfig.includes('required'),
              primaryKey: fieldName === 'id',
              unique: false,
              autoGenerate: false,
            });
          }
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to parse Objection.js JSON schema', { error: error.message });
  }
}

export function parseObjectionRelationships(content: string, entity: ORMEntity): void {
  const relationMappingsMatch = content.match(
    /static\s+get\s+relationMappings\s*\(\s*\)\s*{\s*return\s*({[^}]+})/s
  );
  if (!relationMappingsMatch) return;

  const relationMappings = relationMappingsMatch[1];
  const relationMatches = relationMappings.match(/(\w+)\s*:\s*{([^}]+)}/g);

  if (relationMatches) {
    for (const relationMatch of relationMatches) {
      const relationParts = relationMatch.match(/(\w+)\s*:\s*{([^}]+)}/);
      if (relationParts) {
        const relationName = relationParts[1];
        const relationConfig = relationParts[2];

        const relationType = extractObjectionRelationType(relationConfig);
        const targetEntity = extractObjectionTargetModel(relationConfig);

        if (relationType && targetEntity) {
          entity.relationships.push({
            name: relationName,
            type: relationType,
            targetEntity,
          });
        }
      }
    }
  }
}
