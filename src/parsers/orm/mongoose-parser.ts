/**
 * Mongoose schema parser
 * Parses Mongoose schema definitions and model registrations
 */

import * as path from 'path';
import { ORMType, RelationType, ORMEntity } from './types';
import { extractMongooseFieldType } from './extraction-utils';
import { SymbolType } from '../../database/models';

export async function parseMongooseSchema(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[]
): Promise<void> {
  // Find schema definition
  const schemaMatch = content.match(/(\w+)Schema\s*=\s*new\s+Schema\s*\(/);
  const modelMatch = content.match(/model\s*\(\s*['"`](\w+)['"`]/);

  let modelName: string;
  if (modelMatch) {
    modelName = modelMatch[1];
  } else if (schemaMatch) {
    modelName = schemaMatch[1].replace('Schema', '');
  } else {
    return;
  }

  const entity: ORMEntity = {
    name: modelName,
    fileName: path.basename(filePath),
    orm: ORMType.MONGOOSE,
    fields: [],
    relationships: [],
    indexes: [],
    validations: [],
  };

  // Parse schema fields
  parseMongooseSchemaFields(content, entity);

  entities.push(entity);

  // Track this entity name to avoid conflicts with base parser
  ormEntityNames.add(modelName);

  symbols.push({
    name: modelName,
    symbol_type: SymbolType.ORM_ENTITY,
    is_exported: true,
  });
}

export function parseMongooseSchemaFields(content: string, entity: ORMEntity): void {
  // Parse schema definition
  const schemaBodyMatch = content.match(/new\s+Schema\s*\(\s*{([^}]+)}/s);
  if (!schemaBodyMatch) return;

  const schemaBody = schemaBodyMatch[1];
  const fieldLines = splitMongooseFields(schemaBody);

  for (const line of fieldLines) {
    const fieldMatch = line.match(/(\w+)\s*:\s*{([^}]+)}/s) || line.match(/(\w+)\s*:\s*(\w+)/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldConfig = fieldMatch[2] || '';

      entity.fields.push({
        name: fieldName,
        type: extractMongooseFieldType(fieldConfig),
        nullable: !fieldConfig.includes('required: true'),
        primaryKey: fieldName === '_id',
        unique: fieldConfig.includes('unique: true'),
        autoGenerate: false,
      });

      // Check for references (relationships)
      if (fieldConfig.includes('ref:')) {
        const refMatch = fieldConfig.match(/ref:\s*['"`](\w+)['"`]/);
        if (refMatch) {
          entity.relationships.push({
            name: fieldName,
            type: RelationType.REFERENCE,
            targetEntity: refMatch[1],
          });
        }
      }
    }
  }
}

export function splitMongooseFields(schemaBody: string): string[] {
  // Split schema fields, handling nested objects
  const fields: string[] = [];
  let current = '';
  let braceCount = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < schemaBody.length; i++) {
    const char = schemaBody[i];

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      inString = false;
    } else if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === ',' && braceCount === 0) {
        fields.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    fields.push(current.trim());
  }

  return fields;
}
