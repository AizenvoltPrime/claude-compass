/**
 * Sequelize model parser
 * Parses Sequelize model definitions (sequelize.define, Model.init)
 */

import * as path from 'path';
import { ORMType, ORMEntity } from './types';
import { extractSequelizeFieldType } from './extraction-utils';
import { mapSequelizeRelationType } from './mapping-utils';
import { SymbolType } from '../../database/models';

export async function parseSequelizeModel(
  filePath: string,
  content: string,
  symbols: any[],
  dependencies: any[],
  ormEntityNames: Set<string>,
  entities: ORMEntity[]
): Promise<void> {
  // Find model definition
  const modelDefineMatch = content.match(/(\w+)\s*=\s*sequelize\.define\s*\(\s*['"`](\w+)['"`]/);
  const modelInitMatch = content.match(/class\s+(\w+)\s+extends\s+Model/);

  let modelName: string;
  if (modelDefineMatch) {
    modelName = modelDefineMatch[2];
  } else if (modelInitMatch) {
    modelName = modelInitMatch[1];
  } else {
    return;
  }

  const entity: ORMEntity = {
    name: modelName,
    fileName: path.basename(filePath),
    orm: ORMType.SEQUELIZE,
    fields: [],
    relationships: [],
    indexes: [],
    validations: [],
  };

  // Parse field definitions
  parseSequelizeFields(content, entity);
  parseSequelizeAssociations(content, entity);

  entities.push(entity);

  // Track this entity name to avoid conflicts with base parser
  ormEntityNames.add(modelName);

  symbols.push({
    name: modelName,
    symbol_type: SymbolType.ORM_ENTITY,
    is_exported: true,
  });
}

export function parseSequelizeFields(content: string, entity: ORMEntity): void {
  // Parse field definitions in sequelize.define or Model.init
  const fieldsMatch = content.match(/{\s*([^}]+)\s*}/s);
  if (!fieldsMatch) return;

  const fieldsContent = fieldsMatch[1];
  const fieldLines = fieldsContent.split(',').map(line => line.trim());

  for (const line of fieldLines) {
    const fieldMatch = line.match(/(\w+)\s*:\s*{([^}]+)}/);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldConfig = fieldMatch[2];

      entity.fields.push({
        name: fieldName,
        type: extractSequelizeFieldType(fieldConfig),
        nullable: !fieldConfig.includes('allowNull: false'),
        primaryKey: fieldConfig.includes('primaryKey: true'),
        unique: fieldConfig.includes('unique: true'),
        autoGenerate: fieldConfig.includes('autoIncrement: true'),
      });
    }
  }
}

export function parseSequelizeAssociations(content: string, entity: ORMEntity): void {
  const associationTypes = ['hasOne', 'hasMany', 'belongsTo', 'belongsToMany'];

  for (const assocType of associationTypes) {
    const assocRegex = new RegExp(`\\.(${assocType})\\s*\\(\\s*(\\w+)`, 'g');
    let assocMatch;

    while ((assocMatch = assocRegex.exec(content)) !== null) {
      const relationType = assocMatch[1];
      const targetEntity = assocMatch[2];

      entity.relationships.push({
        name: `${relationType}_${targetEntity}`,
        type: mapSequelizeRelationType(relationType),
        targetEntity,
      });
    }
  }
}
