/**
 * Type mapping utilities
 * Converts ORM-specific type strings to RelationType enum values
 */

import { RelationType } from './types';

export function mapTypeORMRelationType(relationType: string): RelationType {
  switch (relationType) {
    case 'OneToOne':
      return RelationType.ONE_TO_ONE;
    case 'OneToMany':
      return RelationType.ONE_TO_MANY;
    case 'ManyToOne':
      return RelationType.MANY_TO_ONE;
    case 'ManyToMany':
      return RelationType.MANY_TO_MANY;
    default:
      return RelationType.REFERENCE;
  }
}

export function mapSequelizeRelationType(relationType: string): RelationType {
  switch (relationType) {
    case 'hasOne':
      return RelationType.HAS_ONE;
    case 'hasMany':
      return RelationType.HAS_MANY;
    case 'belongsTo':
      return RelationType.BELONGS_TO;
    case 'belongsToMany':
      return RelationType.MANY_TO_MANY;
    default:
      return RelationType.REFERENCE;
  }
}
