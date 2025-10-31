/**
 * Type definitions for ORM parser
 * Core enums, interfaces, and type definitions with zero internal dependencies
 */

export enum ORMType {
  PRISMA = 'prisma',
  TYPEORM = 'typeorm',
  SEQUELIZE = 'sequelize',
  MONGOOSE = 'mongoose',
  OBJECTION = 'objection',
  BOOKSHELF = 'bookshelf',
  WATERLINE = 'waterline',
  MIKRO_ORM = 'mikro-orm',
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
  REFERENCE = 'reference',
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
