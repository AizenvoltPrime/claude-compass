/**
 * MikroORM entity parser
 * Parses MikroORM entities with decorators similar to TypeORM
 */

import * as path from 'path';
import { ORMType, ORMEntity } from './types';
import { extractMikroORMInverseProperty } from './extraction-utils';
import { mapTypeORMRelationType } from './mapping-utils';
import { SymbolType } from '../../database/models';

export async function parseMikroORMEntity(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[]
): Promise<void> {
  const entityMatch = content.match(/@Entity\s*(?:\([^)]*\))?\s*(?:export\s+)?class\s+(\w+)/);
  if (!entityMatch) return;

  const entityName = entityMatch[1];

  const entity: ORMEntity = {
    name: entityName,
    fileName: path.basename(filePath),
    orm: ORMType.MIKRO_ORM,
    fields: [],
    relationships: [],
    indexes: [],
    validations: [],
  };

  // Parse properties
  const propertyRegex = /@Property\s*(?:\([^)]*\))?\s*(\w+)(?:\s*:\s*([^;=\n]+))?/g;
  let propertyMatch;

  while ((propertyMatch = propertyRegex.exec(content)) !== null) {
    const fieldName = propertyMatch[1];
    const fieldType = propertyMatch[2] || 'unknown';

    entity.fields.push({
      name: fieldName,
      type: fieldType.trim(),
      nullable: fieldType.includes('null'),
      primaryKey: false,
      unique: false,
      autoGenerate: false,
    });
  }

  // Parse relationships
  parseMikroORMRelationships(content, entity);

  entities.push(entity);

  // Track this entity name to avoid conflicts with base parser
  ormEntityNames.add(entityName);

  symbols.push({
    name: entityName,
    symbol_type: SymbolType.ORM_ENTITY,
    is_exported: true,
  });
}

export function parseMikroORMRelationships(content: string, entity: ORMEntity): void {
  const relationTypes = ['OneToMany', 'ManyToOne', 'OneToOne', 'ManyToMany'];

  for (const relationType of relationTypes) {
    const relationRegex = new RegExp(`@${relationType}\\s*\\(([^)]+)\\)\\s*(\\w+)`, 'g');
    let relationMatch;

    while ((relationMatch = relationRegex.exec(content)) !== null) {
      const relationParams = relationMatch[1];
      const fieldName = relationMatch[2];

      const targetEntityMatch = relationParams.match(/=>\s*(\w+)/);
      const targetEntity = targetEntityMatch ? targetEntityMatch[1] : 'unknown';

      entity.relationships.push({
        name: fieldName,
        type: mapTypeORMRelationType(relationType), // MikroORM uses similar decorators
        targetEntity,
        inverseProperty: extractMikroORMInverseProperty(relationParams),
      });
    }
  }
}
