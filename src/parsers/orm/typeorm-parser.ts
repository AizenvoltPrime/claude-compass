/**
 * TypeORM entity parser
 * Parses TypeORM entities with decorators (@Entity, @Column, etc.)
 */

import * as path from 'path';
import { ORMType, RelationType, ORMEntity } from './types';
import { extractTypeORMInverseProperty } from './extraction-utils';
import { mapTypeORMRelationType } from './mapping-utils';
import { SymbolType } from '../../database/models';

export async function parseTypeORMEntity(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[],
  getLineNumber: (position: number, content: string) => number
): Promise<void> {
  // Find entity class
  const entityMatch = content.match(/@Entity\s*(?:\([^)]*\))?\s*(?:export\s+)?class\s+(\w+)/);
  if (!entityMatch) return;

  const entityName = entityMatch[1];

  const entity: ORMEntity = {
    name: entityName,
    fileName: path.basename(filePath),
    orm: ORMType.TYPEORM,
    fields: [],
    relationships: [],
    indexes: [],
    validations: [],
  };

  // Parse columns
  const columnRegex = /@Column\s*(?:\([^)]*\))?\s*(\w+)(?:\s*:\s*([^;=\n]+))?/g;
  let columnMatch;

  while ((columnMatch = columnRegex.exec(content)) !== null) {
    const fieldName = columnMatch[1];
    const fieldType = columnMatch[2] || 'unknown';

    entity.fields.push({
      name: fieldName,
      type: fieldType.trim(),
      nullable: fieldType.includes('null'),
      primaryKey: false, // Will be detected separately
      unique: false,
      autoGenerate: false,
    });
  }

  // Parse relationships
  parseTypeORMRelationships(content, entity);

  entities.push(entity);

  // Track this entity name to avoid conflicts with base parser
  ormEntityNames.add(entityName);

  symbols.push({
    name: entityName,
    symbol_type: SymbolType.ORM_ENTITY,
    start_line: getLineNumber(entityMatch.index!, content),
    is_exported: true,
  });
}

export function parseTypeORMRelationships(content: string, entity: ORMEntity): void {
  // Parse OneToMany, ManyToOne, OneToOne, ManyToMany relationships
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
        type: mapTypeORMRelationType(relationType),
        targetEntity,
        inverseProperty: extractTypeORMInverseProperty(relationParams),
      });
    }
  }
}
