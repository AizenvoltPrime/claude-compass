/**
 * ORM relationship parser for detecting and mapping Object-Relational Mapping patterns
 * Supports Prisma, TypeORM, Sequelize, Mongoose and other popular ORMs
 */

import * as path from 'path';
import Parser from 'tree-sitter';
import { createComponentLogger } from '../../utils/logger';
import {
  BaseFrameworkParser,
  FrameworkParseOptions,
  ParseFileResult,
  FrameworkPattern,
} from '../base-framework';
import {
  FrameworkEntity,
  FrameworkParseResult,
  ParsedSymbol,
  ParsedDependency,
  ParsedImport,
  ParsedExport,
} from '../base';
import { SymbolType, DependencyType } from '../../database/models';

const logger = createComponentLogger('orm-parser');

// Re-export types
export * from './types';
export * from './detection-utils';
export * from './extraction-utils';
export * from './mapping-utils';

// Import all dependencies
import { ORMType, ORMEntity, ORMRepository } from './types';
import { detectORMSystems } from './detection-utils';
import { getChunkBoundaries as getChunkBoundariesUtil, mergeChunkResults as mergeChunkResultsUtil, getLineNumber as getLineNumberUtil } from './chunking-utils';
import { parsePrismaSchema } from './prisma-parser';
import { parseTypeORMEntity } from './typeorm-parser';
import { parseSequelizeModel } from './sequelize-parser';
import { parseMongooseSchema } from './mongoose-parser';
import { parseObjectionModel } from './objection-parser';
import { parseMikroORMEntity } from './mikro-orm-parser';
import {
  extractBaseSymbols,
  extractBaseDependencies,
  extractBaseImports,
  extractBaseExports,
  isNodeExported,
  findNodesOfType,
} from './base-implementations';

export class ORMParser extends BaseFrameworkParser {
  private detectedORMs: Set<ORMType> = new Set();
  private entities: ORMEntity[] = [];
  private repositories: ORMRepository[] = [];

  protected frameworkName = 'ORM';

  constructor(parser: Parser) {
    super(parser, 'orm');
  }

  getSupportedExtensions(): string[] {
    return [
      '.prisma',
      '.ts',
      '.js',
      '.model.ts',
      '.model.js',
      '.entity.ts',
      '.entity.js',
      '.schema.ts',
      '.schema.js',
    ];
  }

  getFrameworkPatterns(): FrameworkPattern[] {
    return [
      {
        name: 'prisma-schema',
        pattern: /model\s+\w+\s*{|enum\s+\w+\s*{|generator\s+\w+\s*{/,
        fileExtensions: ['.prisma'],
        description: 'Prisma schema definition with models and enums',
      },
      {
        name: 'typeorm-entity',
        pattern: /@Entity\s*\(|@Column\s*\(|@PrimaryGeneratedColumn\s*\(/,
        fileExtensions: ['.ts', '.js'],
        description: 'TypeORM entity with decorators',
      },
      {
        name: 'sequelize-model',
        pattern: /sequelize\.define\s*\(|Model\.init\s*\(|DataTypes\./,
        fileExtensions: ['.ts', '.js'],
        description: 'Sequelize model definition',
      },
      {
        name: 'mongoose-schema',
        pattern: /new\s+Schema\s*\(|mongoose\.model\s*\(|Schema\s*\(/,
        fileExtensions: ['.ts', '.js'],
        description: 'Mongoose schema definition',
      },
    ];
  }

  protected getChunkBoundaries(content: string, maxChunkSize: number): number[] {
    return getChunkBoundariesUtil(content, maxChunkSize);
  }

  protected mergeChunkResults(chunks: any[], chunkMetadata: any[]): any {
    return mergeChunkResultsUtil(chunks, chunkMetadata);
  }

  async parseFile(
    filePath: string,
    content: string,
    options: FrameworkParseOptions = {}
  ): Promise<ParseFileResult> {
    // Handle empty content early to avoid parse errors
    if (!content || content.trim().length === 0) {
      return {
        filePath,
        symbols: [],
        dependencies: [],
        imports: [],
        exports: [],
        errors: [],
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
      const detectedORMs = detectORMSystems(content, path.basename(filePath));
      detectedORMs.forEach(orm => this.detectedORMs.add(orm));

      if (detectedORMs.length === 0) {
        return baseResult; // Return base result with framework entities included
      }

      // Parse based on detected ORM system
      for (const orm of detectedORMs) {
        switch (orm) {
          case ORMType.PRISMA:
            await parsePrismaSchema(filePath, content, symbols, dependencies, ormEntityNames, this.entities, getLineNumberUtil);
            break;
          case ORMType.TYPEORM:
            await parseTypeORMEntity(filePath, content, symbols, dependencies, ormEntityNames, this.entities, getLineNumberUtil);
            break;
          case ORMType.SEQUELIZE:
            await parseSequelizeModel(
              filePath,
              content,
              symbols,
              dependencies,
              ormEntityNames,
              this.entities
            );
            break;
          case ORMType.MONGOOSE:
            await parseMongooseSchema(
              filePath,
              content,
              symbols,
              dependencies,
              ormEntityNames,
              this.entities
            );
            break;
          case ORMType.OBJECTION:
            await parseObjectionModel(
              filePath,
              content,
              symbols,
              dependencies,
              ormEntityNames,
              this.entities
            );
            break;
          case ORMType.MIKRO_ORM:
            await parseMikroORMEntity(
              filePath,
              content,
              symbols,
              dependencies,
              ormEntityNames,
              this.entities
            );
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

      // Return merged result with framework entities from base class
      return {
        ...baseResult,
        symbols: filteredSymbols,
        dependencies,
        imports,
        exports,
        errors,
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
        errors,
      };
    }
  }

  async getDetectedFrameworks(): Promise<Record<string, any>> {
    return {
      orms: Array.from(this.detectedORMs),
      entities: this.entities.map(e => ({
        name: e.name,
        orm: e.orm,
        fieldCount: e.fields.length,
        relationshipCount: e.relationships.length,
      })),
      repositories: this.repositories,
    };
  }

  async detectFrameworkEntities(
    content: string,
    filePath: string,
    options: FrameworkParseOptions
  ): Promise<FrameworkParseResult> {
    // This method is called by the base class
    const entities: FrameworkEntity[] = [];

    const detectedORMs = detectORMSystems(content, path.basename(filePath));

    for (const orm of detectedORMs) {
      entities.push({
        type: 'orm_system',
        name: orm,
        filePath,
        metadata: {
          orm,
          filePath,
        },
      });
    }

    return {
      entities,
    };
  }

  // Required abstract method implementations from BaseFrameworkParser
  protected extractSymbols(rootNode: Parser.SyntaxNode, content: string): ParsedSymbol[] {
    return extractBaseSymbols(rootNode, content);
  }

  protected extractDependencies(rootNode: Parser.SyntaxNode, content: string): ParsedDependency[] {
    return extractBaseDependencies(rootNode, content);
  }

  protected extractImports(rootNode: Parser.SyntaxNode, content: string): ParsedImport[] {
    return extractBaseImports(rootNode, content);
  }

  protected extractExports(rootNode: Parser.SyntaxNode, content: string): ParsedExport[] {
    return extractBaseExports(rootNode, content);
  }

  protected isExported(node: Parser.SyntaxNode): boolean {
    return isNodeExported(node);
  }

  protected findNodesOfType(rootNode: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    return findNodesOfType(rootNode, type);
  }
}
