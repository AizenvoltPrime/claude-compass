/**
 * ORM relationship parser for detecting and mapping Object-Relational Mapping patterns
 * Supports Prisma, TypeORM, Sequelize, Mongoose and other popular ORMs
 */

import * as path from 'path';
import { createComponentLogger } from '../utils/logger';
import { BaseFrameworkParser, FrameworkParseOptions, ParseFileResult, FrameworkPattern } from './base-framework';
import { FrameworkEntity, FrameworkParseResult, ParsedSymbol, ParsedDependency, ParsedImport, ParsedExport } from './base';
import { SymbolType, DependencyType } from '../database/models';
import Parser from 'tree-sitter';

const logger = createComponentLogger('orm-parser');

export enum ORMType {
  PRISMA = 'prisma',
  TYPEORM = 'typeorm',
  SEQUELIZE = 'sequelize',
  MONGOOSE = 'mongoose',
  OBJECTION = 'objection',
  BOOKSHELF = 'bookshelf',
  WATERLINE = 'waterline',
  MIKRO_ORM = 'mikro-orm'
}

export enum RelationType {
  ONE_TO_ONE = 'one_to_one',
  ONE_TO_MANY = 'one_to_many',
  MANY_TO_ONE = 'many_to_one',
  MANY_TO_MANY = 'many_to_many',
  BELONGS_TO = 'belongs_to',
  HAS_ONE = 'has_one',
  HAS_MANY = 'has_many',
  EMBED = 'embed',
  REFERENCE = 'reference'
}

export interface ORMEntity {
  name: string;
  tableName?: string;
  fileName: string;
  orm: ORMType;
  fields: ORMField[];
  relationships: ORMRelationship[];
  indexes: ORMIndex[];
  validations: ORMValidation[];
}

export interface ORMField {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoGenerate: boolean;
  defaultValue?: any;
  columnName?: string;
}

export interface ORMRelationship {
  name: string;
  type: RelationType;
  targetEntity: string;
  foreignKey?: string;
  inverseProperty?: string;
  cascadeActions?: string[];
  joinTable?: string;
  joinColumns?: string[];
  inverseJoinColumns?: string[];
}

export interface ORMIndex {
  name?: string;
  fields: string[];
  unique: boolean;
  type?: string;
}

export interface ORMValidation {
  field: string;
  rules: string[];
  customValidators?: string[];
}

export interface ORMRepository {
  entityName: string;
  repositoryClass?: string;
  customMethods: string[];
  baseRepository?: string;
}

export class ORMParser extends BaseFrameworkParser {
  private detectedORMs: Set<ORMType> = new Set();
  private entities: ORMEntity[] = [];
  private repositories: ORMRepository[] = [];

  protected frameworkName = 'ORM';

  constructor(parser: Parser) {
    super(parser, 'orm');
  }

  getSupportedExtensions(): string[] {
    return ['.prisma', '.ts', '.js', '.model.ts', '.model.js', '.entity.ts', '.entity.js', '.schema.ts', '.schema.js'];
  }

  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'prisma-schema',
        pattern: /model\s+\w+\s*{|enum\s+\w+\s*{|generator\s+\w+\s*{/,
        fileExtensions: ['.prisma'],
        description: 'Prisma schema definition with models and enums'
      },
      {
        name: 'typeorm-entity',
        pattern: /@Entity\s*\(|@Column\s*\(|@PrimaryGeneratedColumn\s*\(/,
        fileExtensions: ['.ts', '.js'],
        description: 'TypeORM entity with decorators'
      },
      {
        name: 'sequelize-model',
        pattern: /sequelize\.define\s*\(|Model\.init\s*\(|DataTypes\./,
        fileExtensions: ['.ts', '.js'],
        description: 'Sequelize model definition'
      },
      {
        name: 'mongoose-schema',
        pattern: /new\s+Schema\s*\(|mongoose\.model\s*\(|Schema\s*\(/,
        fileExtensions: ['.ts', '.js'],
        description: 'Mongoose schema definition'
      }
    ];
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    const lines = content.split('\n');
    const boundaries: number[] = [0];
    let currentSize = 0;
    let currentPos = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLength = line.length + 1; // +1 for newline

      if (currentSize + lineLength > maxChunkSize && currentSize > 0) {
        boundaries.push(currentPos);
        currentSize = 0;
      }

      currentSize += lineLength;
      currentPos += lineLength;
    }

    if (currentPos > 0 && !boundaries.includes(currentPos)) {
      boundaries.push(currentPos);
    }

    return boundaries;
  }

  protected mergeChunkResults(chunks: any[], chunkMetadata: any[]): any {
    const merged = {
      symbols: [],
      dependencies: [],
      imports: [],
      exports: [],
      errors: [],
      chunksProcessed: chunks.length
    };

    for (const chunk of chunks) {
      if (chunk.symbols) merged.symbols.push(...chunk.symbols);
      if (chunk.dependencies) merged.dependencies.push(...chunk.dependencies);
      if (chunk.imports) merged.imports.push(...chunk.imports);
      if (chunk.exports) merged.exports.push(...chunk.exports);
      if (chunk.errors) merged.errors.push(...chunk.errors);
    }

    return merged;
  }

  async parseFile(filePath: string, content: string, options: FrameworkParseOptions = {}): Promise<ParseFileResult> {

    // Handle empty content early to avoid parse errors
    if (!content || content.trim().length === 0) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: []
      };
    }

    // Call parent's parseFile method to handle framework entity detection
    const baseResult = await super.parseFile(filePath, content, options);

    // Add our custom ORM-specific parsing
    const symbols: any[] = [...baseResult.symbols];
    const dependencies: any[] = [...baseResult.dependencies];
    const imports: any[] = [...baseResult.imports];
    const exports: any[] = [...baseResult.exports];
    const errors: any[] = [...baseResult.errors];

    // Track ORM entity names to avoid conflicts with base parser symbols
    const ormEntityNames: Set<string> = new Set();

    try {
      // Detect ORM systems from imports and patterns
      const detectedORMs = this.detectORMSystems(content, path.basename(filePath));
      detectedORMs.forEach(orm => this.detectedORMs.add(orm));

      if (detectedORMs.length === 0) {
        return baseResult; // Return base result with framework entities included
      }

      // Parse based on detected ORM system
      for (const orm of detectedORMs) {
        switch (orm) {
          case ORMType.PRISMA:
            await this.parsePrismaSchema(filePath, content, symbols, dependencies, ormEntityNames);
            break;
          case ORMType.TYPEORM:
            await this.parseTypeORMEntity(filePath, content, symbols, dependencies, ormEntityNames);
            break;
          case ORMType.SEQUELIZE:
            await this.parseSequelizeModel(filePath, content, symbols, dependencies, ormEntityNames);
            break;
          case ORMType.MONGOOSE:
            await this.parseMongooseSchema(filePath, content, symbols, dependencies, ormEntityNames);
            break;
          case ORMType.OBJECTION:
            await this.parseObjectionModel(filePath, content, symbols, dependencies, ormEntityNames);
            break;
          case ORMType.MIKRO_ORM:
            await this.parseMikroORMEntity(filePath, content, symbols, dependencies, ormEntityNames);
            break;
        }
      }

      // Remove base parser symbols that conflict with ORM entities
      // This ensures ORM symbols take precedence over base parser symbols
      const filteredSymbols = symbols.filter(symbol => {
        if (ormEntityNames.has(symbol.name)) {
          // Keep only ORM_ENTITY symbols, remove base parser symbols with same name
          return symbol.symbol_type === SymbolType.ORM_ENTITY;
        }
        return true;
      });

      logger.debug('ORM parsing completed', {
        filePath,
        detectedORMs: Array.from(this.detectedORMs),
        symbolsFound: filteredSymbols.length,
        ormEntities: Array.from(ormEntityNames)
      });

      // Return merged result with framework entities from base class
      return {
        ...baseResult,
        symbols: filteredSymbols,
        dependencies,
        imports,
        exports,
        errors
      };

    } catch (error) {
      logger.error('Error parsing ORM file', { filePath, error: error.message });

      // Return merged result with framework entities from base class
      return {
        ...baseResult,
        symbols,
        dependencies,
        imports,
        exports,
        errors
      };
    }
  }

  private detectORMSystems(content: string, fileName: string): ORMType[] {
    const ormTypes: ORMType[] = [];

    // Prisma detection
    if (fileName === 'schema.prisma' || content.includes('@prisma/client') ||
        content.includes('PrismaClient') || /model\s+\w+\s*{/.test(content)) {
      ormTypes.push(ORMType.PRISMA);
    }

    // TypeORM detection
    if (content.includes('typeorm') || content.includes('@Entity') ||
        content.includes('@Column') || content.includes('EntityRepository')) {
      ormTypes.push(ORMType.TYPEORM);
    }

    // Sequelize detection
    if (content.includes('sequelize') || content.includes('DataTypes') ||
        content.includes('Model.init') || content.includes('sequelize.define')) {
      ormTypes.push(ORMType.SEQUELIZE);
    }

    // Mongoose detection
    if (content.includes('mongoose') || content.includes('Schema') ||
        content.includes('model(') || /new\s+Schema\s*\(/.test(content)) {
      ormTypes.push(ORMType.MONGOOSE);
    }

    // Objection.js detection
    if (content.includes('objection') || content.includes('Model.extend') ||
        content.includes('objection/Model') || content.includes('$relatedQuery')) {
      ormTypes.push(ORMType.OBJECTION);
    }

    // MikroORM detection
    if (content.includes('@mikro-orm') || content.includes('MikroORM') ||
        content.includes('@Entity') && content.includes('mikro-orm')) {
      ormTypes.push(ORMType.MIKRO_ORM);
    }

    return ormTypes;
  }

  private async parsePrismaSchema(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
        validations: []
      };

      // Parse fields and relationships
      const fieldLines = modelBody.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('//'));

      for (const line of fieldLines) {
        if (line.includes('@@')) {
          // Parse model-level directives (indexes, etc.)
          this.parsePrismaModelDirective(line, entity);
        } else {
          // Parse field definitions
          this.parsePrismaField(line, entity);
        }
      }

      this.entities.push(entity);

      // Track this entity name to avoid conflicts with base parser
      ormEntityNames.add(modelName);

      // Create symbol for the model
      symbols.push({
        name: modelName,
        symbol_type: SymbolType.ORM_ENTITY,
        start_line: this.getLineNumber(modelMatch.index!, content),
        end_line: this.getLineNumber(modelMatch.index! + modelMatch[0].length, content),
        is_exported: true
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
        start_line: this.getLineNumber(enumMatch.index!, content),
        end_line: this.getLineNumber(enumMatch.index! + enumMatch[0].length, content),
        is_exported: true
      });
    }
  }

  private parsePrismaField(line: string, entity: ORMEntity): void {
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
      autoGenerate: modifiers.includes('@default(autoincrement())') || modifiers.includes('@default(cuid())'),
      defaultValue: this.extractDefaultValue(modifiers)
    };

    entity.fields.push(field);

    // Check for relationships
    if (modifiers.includes('@relation')) {
      const relationship = this.parsePrismaRelation(fieldName, fieldType, modifiers);
      if (relationship) {
        entity.relationships.push(relationship);
      }
    }
  }

  private parsePrismaRelation(fieldName: string, fieldType: string, modifiers: string): ORMRelationship | null {
    const relationMatch = modifiers.match(/@relation\(([^)]+)\)/);
    if (!relationMatch) return null;

    const relationType = fieldType.includes('[]') ? RelationType.ONE_TO_MANY : RelationType.MANY_TO_ONE;

    return {
      name: fieldName,
      type: relationType,
      targetEntity: fieldType.replace('[]', '').replace('?', ''),
      foreignKey: this.extractRelationField(relationMatch[1], 'fields'),
      inverseProperty: this.extractRelationField(relationMatch[1], 'references')
    };
  }

  private parsePrismaModelDirective(line: string, entity: ORMEntity): void {
    if (line.includes('@@index')) {
      const indexMatch = line.match(/@@index\(\[([^\]]+)\]/);
      if (indexMatch) {
        const fields = indexMatch[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
        entity.indexes.push({
          fields,
          unique: false
        });
      }
    } else if (line.includes('@@unique')) {
      const uniqueMatch = line.match(/@@unique\(\[([^\]]+)\]/);
      if (uniqueMatch) {
        const fields = uniqueMatch[1].split(',').map(f => f.trim().replace(/['"]/g, ''));
        entity.indexes.push({
          fields,
          unique: true
        });
      }
    }
  }

  private async parseTypeORMEntity(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
      validations: []
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
        autoGenerate: false
      });
    }

    // Parse relationships
    this.parseTypeORMRelationships(content, entity);

    this.entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(entityName);

    symbols.push({
      name: entityName,
      symbol_type: SymbolType.ORM_ENTITY,
      start_line: this.getLineNumber(entityMatch.index!, content),
      is_exported: true
    });
  }

  private parseTypeORMRelationships(content: string, entity: ORMEntity): void {
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
          type: this.mapTypeORMRelationType(relationType),
          targetEntity,
          inverseProperty: this.extractTypeORMInverseProperty(relationParams)
        });
      }
    }
  }

  private async parseSequelizeModel(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
      validations: []
    };

    // Parse field definitions
    this.parseSequelizeFields(content, entity);
    this.parseSequelizeAssociations(content, entity);

    this.entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(modelName);

    symbols.push({
      name: modelName,
      symbol_type: SymbolType.ORM_ENTITY,
      is_exported: true
    });
  }

  private parseSequelizeFields(content: string, entity: ORMEntity): void {
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
          type: this.extractSequelizeFieldType(fieldConfig),
          nullable: !fieldConfig.includes('allowNull: false'),
          primaryKey: fieldConfig.includes('primaryKey: true'),
          unique: fieldConfig.includes('unique: true'),
          autoGenerate: fieldConfig.includes('autoIncrement: true')
        });
      }
    }
  }

  private parseSequelizeAssociations(content: string, entity: ORMEntity): void {
    const associationTypes = ['hasOne', 'hasMany', 'belongsTo', 'belongsToMany'];

    for (const assocType of associationTypes) {
      const assocRegex = new RegExp(`\\.(${assocType})\\s*\\(\\s*(\\w+)`, 'g');
      let assocMatch;

      while ((assocMatch = assocRegex.exec(content)) !== null) {
        const relationType = assocMatch[1];
        const targetEntity = assocMatch[2];

        entity.relationships.push({
          name: `${relationType}_${targetEntity}`,
          type: this.mapSequelizeRelationType(relationType),
          targetEntity
        });
      }
    }
  }

  private async parseMongooseSchema(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
      validations: []
    };

    // Parse schema fields
    this.parseMongooseSchemaFields(content, entity);

    this.entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(modelName);

    symbols.push({
      name: modelName,
      symbol_type: SymbolType.ORM_ENTITY,
      is_exported: true
    });
  }

  private parseMongooseSchemaFields(content: string, entity: ORMEntity): void {
    // Parse schema definition
    const schemaBodyMatch = content.match(/new\s+Schema\s*\(\s*{([^}]+)}/s);
    if (!schemaBodyMatch) return;

    const schemaBody = schemaBodyMatch[1];
    const fieldLines = this.splitMongooseFields(schemaBody);

    for (const line of fieldLines) {
      const fieldMatch = line.match(/(\w+)\s*:\s*{([^}]+)}/s) || line.match(/(\w+)\s*:\s*(\w+)/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldConfig = fieldMatch[2] || '';

        entity.fields.push({
          name: fieldName,
          type: this.extractMongooseFieldType(fieldConfig),
          nullable: !fieldConfig.includes('required: true'),
          primaryKey: fieldName === '_id',
          unique: fieldConfig.includes('unique: true'),
          autoGenerate: false
        });

        // Check for references (relationships)
        if (fieldConfig.includes('ref:')) {
          const refMatch = fieldConfig.match(/ref:\s*['"`](\w+)['"`]/);
          if (refMatch) {
            entity.relationships.push({
              name: fieldName,
              type: RelationType.REFERENCE,
              targetEntity: refMatch[1]
            });
          }
        }
      }
    }
  }

  private async parseObjectionModel(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
      validations: []
    };

    // Parse table name
    const tableNameMatch = content.match(/static\s+get\s+tableName\s*\(\s*\)\s*{\s*return\s*['"`](\w+)['"`]/);
    if (tableNameMatch) {
      entity.tableName = tableNameMatch[1];
    }

    // Parse JSON schema for fields
    this.parseObjectionJsonSchema(content, entity);

    // Parse relationships
    this.parseObjectionRelationships(content, entity);

    this.entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(modelName);

    symbols.push({
      name: modelName,
      symbol_type: SymbolType.ORM_ENTITY,
      is_exported: true
    });
  }

  private parseObjectionJsonSchema(content: string, entity: ORMEntity): void {
    const jsonSchemaMatch = content.match(/static\s+get\s+jsonSchema\s*\(\s*\)\s*{\s*return\s*({[^}]+})/s);
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
                type: this.extractJsonSchemaType(fieldConfig),
                nullable: !fieldConfig.includes('required'),
                primaryKey: fieldName === 'id',
                unique: false,
                autoGenerate: false
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to parse Objection.js JSON schema', { error: error.message });
    }
  }

  private parseObjectionRelationships(content: string, entity: ORMEntity): void {
    const relationMappingsMatch = content.match(/static\s+get\s+relationMappings\s*\(\s*\)\s*{\s*return\s*({[^}]+})/s);
    if (!relationMappingsMatch) return;

    const relationMappings = relationMappingsMatch[1];
    const relationMatches = relationMappings.match(/(\w+)\s*:\s*{([^}]+)}/g);

    if (relationMatches) {
      for (const relationMatch of relationMatches) {
        const relationParts = relationMatch.match(/(\w+)\s*:\s*{([^}]+)}/);
        if (relationParts) {
          const relationName = relationParts[1];
          const relationConfig = relationParts[2];

          const relationType = this.extractObjectionRelationType(relationConfig);
          const targetEntity = this.extractObjectionTargetModel(relationConfig);

          if (relationType && targetEntity) {
            entity.relationships.push({
              name: relationName,
              type: relationType,
              targetEntity
            });
          }
        }
      }
    }
  }

  private async parseMikroORMEntity(filePath: string, content: string, symbols: any[], dependencies: any[], ormEntityNames: Set<string>): Promise<void> {

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
      validations: []
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
        autoGenerate: false
      });
    }

    // Parse relationships
    this.parseMikroORMRelationships(content, entity);

    this.entities.push(entity);

    // Track this entity name to avoid conflicts with base parser
    ormEntityNames.add(entityName);

    symbols.push({
      name: entityName,
      symbol_type: SymbolType.ORM_ENTITY,
      is_exported: true
    });
  }

  private parseMikroORMRelationships(content: string, entity: ORMEntity): void {
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
          type: this.mapTypeORMRelationType(relationType), // MikroORM uses similar decorators
          targetEntity,
          inverseProperty: this.extractMikroORMInverseProperty(relationParams)
        });
      }
    }
  }

  // Helper methods for extracting values
  private extractDefaultValue(modifiers: string): any {
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

  private extractRelationField(relationParams: string, fieldType: string): string | undefined {
    const regex = new RegExp(`${fieldType}:\\s*\\[([^\\]]+)\\]`);
    const match = relationParams.match(regex);
    return match ? match[1].replace(/['"]/g, '') : undefined;
  }

  private extractTypeORMInverseProperty(relationParams: string): string | undefined {
    const inverseMatch = relationParams.match(/(\w+)\s*=>\s*\w+\.(\w+)/);
    return inverseMatch ? inverseMatch[2] : undefined;
  }

  private extractMikroORMInverseProperty(relationParams: string): string | undefined {
    const inverseMatch = relationParams.match(/inversedBy:\s*['"`](\w+)['"`]/);
    return inverseMatch ? inverseMatch[1] : undefined;
  }

  private extractSequelizeFieldType(fieldConfig: string): string {
    const typeMatch = fieldConfig.match(/type:\s*DataTypes\.(\w+)/);
    return typeMatch ? typeMatch[1] : 'unknown';
  }

  private extractMongooseFieldType(fieldConfig: string): string {
    const typeMatch = fieldConfig.match(/type:\s*(\w+)/) || fieldConfig.match(/^(\w+)$/);
    return typeMatch ? typeMatch[1] : 'unknown';
  }

  private extractJsonSchemaType(fieldConfig: string): string {
    const typeMatch = fieldConfig.match(/type:\s*['"`](\w+)['"`]/);
    return typeMatch ? typeMatch[1] : 'unknown';
  }

  private extractObjectionRelationType(relationConfig: string): RelationType | null {
    if (relationConfig.includes('BelongsToOneRelation')) return RelationType.BELONGS_TO;
    if (relationConfig.includes('HasManyRelation')) return RelationType.HAS_MANY;
    if (relationConfig.includes('HasOneRelation')) return RelationType.HAS_ONE;
    if (relationConfig.includes('ManyToManyRelation')) return RelationType.MANY_TO_MANY;
    return null;
  }

  private extractObjectionTargetModel(relationConfig: string): string | null {
    const modelMatch = relationConfig.match(/modelClass:\s*['"`]([^'"`]+)['"`]/);
    if (modelMatch) return modelMatch[1];

    const requireMatch = relationConfig.match(/modelClass:\s*require\(['"`]([^'"`]+)['"`]\)/);
    if (requireMatch) {
      const modulePath = requireMatch[1];
      return path.basename(modulePath, path.extname(modulePath));
    }

    return null;
  }

  private mapTypeORMRelationType(relationType: string): RelationType {
    switch (relationType) {
      case 'OneToOne': return RelationType.ONE_TO_ONE;
      case 'OneToMany': return RelationType.ONE_TO_MANY;
      case 'ManyToOne': return RelationType.MANY_TO_ONE;
      case 'ManyToMany': return RelationType.MANY_TO_MANY;
      default: return RelationType.REFERENCE;
    }
  }

  private mapSequelizeRelationType(relationType: string): RelationType {
    switch (relationType) {
      case 'hasOne': return RelationType.HAS_ONE;
      case 'hasMany': return RelationType.HAS_MANY;
      case 'belongsTo': return RelationType.BELONGS_TO;
      case 'belongsToMany': return RelationType.MANY_TO_MANY;
      default: return RelationType.REFERENCE;
    }
  }

  private splitMongooseFields(schemaBody: string): string[] {
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

  protected getLineNumber(position: number, content: string): number {
    return content.substring(0, position).split('\n').length;
  }

  async getDetectedFrameworks(): Promise<Record<string, any>> {
    return {
      orms: Array.from(this.detectedORMs),
      entities: this.entities.map(e => ({
        name: e.name,
        orm: e.orm,
        fieldCount: e.fields.length,
        relationshipCount: e.relationships.length
      })),
      repositories: this.repositories
    };
  }

  async detectFrameworkEntities(content: string, filePath: string, options: FrameworkParseOptions): Promise<FrameworkParseResult> {
    // This method is called by the base class
    const entities: FrameworkEntity[] = [];

    const detectedORMs = this.detectORMSystems(content, path.basename(filePath));
    logger.debug('ORM detectFrameworkEntities called', {
      filePath,
      detectedORMs,
      detectedCount: detectedORMs.length
    });

    for (const orm of detectedORMs) {
      entities.push({
        type: 'orm_system',
        name: orm,
        filePath,
        metadata: {
          orm,
          filePath
        }
      });
    }

    logger.debug('ORM detectFrameworkEntities returning', {
      filePath,
      entitiesCount: entities.length,
      entities
    });

    return {
      entities
    };
  }

  // Required abstract method implementations from BaseFrameworkParser
  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = [];

    // Extract class declarations (entities/models)
    const classNodes = this.findNodesOfType(rootNode, 'class_declaration');
    for (const node of classNodes) {
      const nameNode = node.namedChild(0);
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          symbol_type: SymbolType.ORM_ENTITY,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          is_exported: this.isExported(node)
        });
      }
    }

    // Extract function declarations
    const functionNodes = this.findNodesOfType(rootNode, 'function_declaration');
    for (const node of functionNodes) {
      const nameNode = node.namedChild(0);
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          symbol_type: SymbolType.FUNCTION,
          start_line: node.startPosition.row + 1,
          end_line: node.endPosition.row + 1,
          is_exported: this.isExported(node)
        });
      }
    }

    return symbols;
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    const dependencies: ParsedDependency[] = [];

    // Extract method calls
    const callNodes = this.findNodesOfType(rootNode, 'call_expression');
    for (const node of callNodes) {
      const memberNode = node.namedChild(0);
      if (memberNode) {
        dependencies.push({
          from_symbol: 'unknown',
          to_symbol: memberNode.text,
          dependency_type: DependencyType.CALLS,
          line_number: node.startPosition.row + 1
        });
      }
    }

    return dependencies;
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    const imports: ParsedImport[] = [];

    // Extract import statements
    const importNodes = this.findNodesOfType(rootNode, 'import_statement');
    for (const node of importNodes) {
      const sourceNode = node.namedChild(0);
      if (sourceNode) {
        imports.push({
          source: sourceNode.text.replace(/['"]/g, ''),
          imported_names: [],
          import_type: 'side_effect',
          line_number: node.startPosition.row + 1,
          is_dynamic: false
        });
      }
    }

    return imports;
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    const exports: ParsedExport[] = [];

    // Extract export statements
    const exportNodes = this.findNodesOfType(rootNode, 'export_statement');
    for (const node of exportNodes) {
      const nameNode = node.namedChild(0);
      if (nameNode) {
        exports.push({
          exported_names: [nameNode.text],
          export_type: node.text.includes('default') ? 'default' : 'named',
          line_number: node.startPosition.row + 1
        });
      }
    }

    return exports;
  }

  protected isExported(node: Parser.SyntaxNode): boolean {
    // Check if the node or its parent has export keyword
    return node.type.includes('export') ||
           (node.parent && node.parent.type.includes('export'));
  }

  protected findNodesOfType(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const nodes: Parser.SyntaxNode[] = [];

    function traverse(node: Parser.SyntaxNode) {
      if (node.type === type) {
        nodes.push(node);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        traverse(node.namedChild(i)!);
      }
    }

    traverse(rootNode);
    return nodes;
  }
}