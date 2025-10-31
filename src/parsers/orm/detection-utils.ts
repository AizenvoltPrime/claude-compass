/**
 * ORM system detection utilities
 * Detects which ORM systems are being used based on file content and patterns
 */

import { ORMType } from './types';

export function detectORMSystems(content: string, fileName: string): ORMType[] {
  const ormTypes: ORMType[] = [];

  // Prisma detection
  if (
    fileName === 'schema.prisma' ||
    content.includes('@prisma/client') ||
    content.includes('PrismaClient') ||
    /model\s+\w+\s*{/.test(content)
  ) {
    ormTypes.push(ORMType.PRISMA);
  }

  // TypeORM detection
  if (
    content.includes('typeorm') ||
    content.includes('@Entity') ||
    content.includes('@Column') ||
    content.includes('EntityRepository')
  ) {
    ormTypes.push(ORMType.TYPEORM);
  }

  // Sequelize detection
  if (
    content.includes('sequelize') ||
    content.includes('DataTypes') ||
    content.includes('Model.init') ||
    content.includes('sequelize.define')
  ) {
    ormTypes.push(ORMType.SEQUELIZE);
  }

  // Mongoose detection
  if (
    content.includes('mongoose') ||
    content.includes('Schema') ||
    content.includes('model(') ||
    /new\s+Schema\s*\(/.test(content)
  ) {
    ormTypes.push(ORMType.MONGOOSE);
  }

  // Objection.js detection
  if (
    content.includes('objection') ||
    content.includes('Model.extend') ||
    content.includes('objection/Model') ||
    content.includes('$relatedQuery')
  ) {
    ormTypes.push(ORMType.OBJECTION);
  }

  // MikroORM detection
  if (
    content.includes('@mikro-orm') ||
    content.includes('MikroORM') ||
    (content.includes('@Entity') && content.includes('mikro-orm'))
  ) {
    ormTypes.push(ORMType.MIKRO_ORM);
  }

  return ormTypes;
}
