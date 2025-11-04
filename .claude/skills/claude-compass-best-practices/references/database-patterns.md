# Database Patterns

## Migration Standards

All database schema changes must be done through migrations. Never modify the database schema directly.

### Naming Convention

**Format**: `NNN_description.ts`

Where:
- `NNN` = 3-digit sequential number (001, 002, 003, ...)
- `description` = kebab-case description of the change

Examples:
- `001_initial_schema.ts`
- `002_add_embeddings_column.ts`
- `023_create_framework_metadata_table.ts`

### Migration Structure

Every migration MUST include both `up` and `down` methods:

```typescript
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Forward migration
  await knex.schema.createTable('symbols', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('symbol_type').notNullable();
    table.integer('file_id').unsigned().notNullable();
    table.foreign('file_id').references('files.id').onDelete('CASCADE');
    table.timestamps(true, true);

    table.index(['name', 'symbol_type']);
    table.index('file_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Rollback migration
  await knex.schema.dropTableIfExists('symbols');
}
```

### Creating a Migration

```bash
npm run migrate:make add_entity_type_column
```

This creates a new migration file with the next sequential number.

## Schema Design Principles

### Use Appropriate Data Types

```typescript
// ✅ GOOD: Specific, appropriate types
table.string('name', 255);           // Limited string
table.text('description');            // Unlimited text
table.integer('count').unsigned();    // Non-negative numbers
table.decimal('price', 10, 2);        // Monetary values
table.timestamp('created_at');        // Timestamps
table.jsonb('metadata');              // Structured JSON data
table.specificType('embedding', 'vector(1536)'); // pgvector embeddings
```

```typescript
// ❌ BAD: Generic, imprecise types
table.string('name');                 // No length limit
table.string('metadata');             // JSON as string
table.integer('price');               // Loses precision
```

### Foreign Keys and Cascades

Always define foreign key relationships with appropriate cascade behavior:

```typescript
table.integer('file_id').unsigned().notNullable();
table.foreign('file_id')
  .references('id')
  .inTable('files')
  .onDelete('CASCADE')  // Delete symbols when file is deleted
  .onUpdate('CASCADE'); // Update if file ID changes (rare)
```

Common cascade patterns:
- `onDelete('CASCADE')` - Child records deleted with parent
- `onDelete('SET NULL')` - Child records nullified when parent deleted
- `onDelete('RESTRICT')` - Prevent parent deletion if children exist

### Indexes for Performance

Add indexes for columns used in:
- Foreign keys
- WHERE clauses
- JOIN conditions
- ORDER BY clauses

```typescript
// Single column indexes
table.index('name');
table.index('file_id');
table.index('created_at');

// Composite indexes (order matters!)
table.index(['file_id', 'symbol_type']); // Good for: WHERE file_id = ? AND symbol_type = ?
table.index(['name', 'entity_type']);    // Good for: WHERE name = ? AND entity_type = ?

// Unique constraints
table.unique(['file_id', 'name', 'start_line']); // Prevent duplicate symbols
```

### Default Values and Nullability

Be explicit about nullability and defaults:

```typescript
// ✅ GOOD: Explicit nullability
table.string('name').notNullable();
table.string('description').nullable();
table.boolean('is_exported').notNullable().defaultTo(false);
table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

// ❌ BAD: Implicit defaults
table.string('name');          // Nullable by default - is this intentional?
table.boolean('is_exported');  // Nullable boolean - use NOT NULL with default
```

## Query Patterns

### Parameterized Queries

Always use parameterized queries to prevent SQL injection:

```typescript
// ✅ GOOD: Parameterized query
async function findSymbolByName(name: string): Promise<Symbol | null> {
  const result = await db('symbols')
    .where('name', name)
    .first();

  return result || null;
}

// ❌ BAD: String interpolation (SQL injection risk!)
async function findSymbolByName(name: string): Promise<Symbol | null> {
  const result = await db.raw(`SELECT * FROM symbols WHERE name = '${name}'`);
  return result.rows[0] || null;
}
```

### Transaction Usage

Use transactions for multi-step operations that must be atomic:

```typescript
async function createSymbolWithDependencies(
  symbolData: SymbolData,
  dependencies: DependencyData[]
): Promise<number> {
  return db.transaction(async (trx) => {
    // Insert symbol
    const [symbolId] = await trx('symbols')
      .insert(symbolData)
      .returning('id');

    // Insert dependencies
    if (dependencies.length > 0) {
      await trx('dependencies').insert(
        dependencies.map(dep => ({
          ...dep,
          from_symbol_id: symbolId
        }))
      );
    }

    return symbolId;
  });
}
```

### Batch Insertions

For large datasets, use batch insertions:

```typescript
async function insertSymbolsInBatches(
  symbols: Symbol[],
  batchSize: number = 1000
): Promise<void> {
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);

    await db('symbols').insert(batch);

    if (process.env.CLAUDE_COMPASS_DEBUG) {
      console.log(`Inserted batch ${i / batchSize + 1}: ${batch.length} symbols`);
    }
  }
}
```

### Efficient Joins

Structure joins to use indexes effectively:

```typescript
// ✅ GOOD: Index-friendly join
async function getSymbolsWithFiles(): Promise<SymbolWithFile[]> {
  return db('symbols')
    .join('files', 'symbols.file_id', 'files.id') // Uses file_id index
    .select(
      'symbols.*',
      'files.path as file_path',
      'files.repository_id'
    );
}

// ✅ GOOD: Filtered join with indexed columns
async function getSymbolsInRepository(repoId: number): Promise<Symbol[]> {
  return db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repository_id', repoId) // Uses repository_id index
    .select('symbols.*');
}
```

## Service Layer Patterns

### Service Structure

Database services in `src/database/services/` follow consistent patterns:

```typescript
// src/database/services/symbol-service.ts
import { db } from '../connection';
import { Symbol, SymbolInsert } from '../types';

export class SymbolService {
  async create(data: SymbolInsert): Promise<number> {
    const [id] = await db('symbols')
      .insert(data)
      .returning('id');

    return id;
  }

  async findById(id: number): Promise<Symbol | null> {
    const symbol = await db('symbols')
      .where('id', id)
      .first();

    return symbol || null;
  }

  async update(id: number, data: Partial<Symbol>): Promise<void> {
    await db('symbols')
      .where('id', id)
      .update(data);
  }

  async delete(id: number): Promise<void> {
    await db('symbols')
      .where('id', id)
      .delete();
  }

  async findByFileId(fileId: number): Promise<Symbol[]> {
    return db('symbols')
      .where('file_id', fileId)
      .orderBy('start_line', 'asc');
  }
}

export const symbolService = new SymbolService();
```

### Service Composition

Use services for complex queries:

```typescript
export class DependencyService {
  async getDependenciesWithSymbolInfo(symbolId: number): Promise<DependencyWithSymbol[]> {
    return db('dependencies')
      .join('symbols', 'dependencies.to_symbol_id', 'symbols.id')
      .join('files', 'symbols.file_id', 'files.id')
      .where('dependencies.from_symbol_id', symbolId)
      .select(
        'dependencies.*',
        'symbols.name as to_symbol_name',
        'symbols.symbol_type as to_symbol_type',
        'files.path as to_file_path'
      );
  }

  async getTransitiveDependencies(
    symbolId: number,
    maxDepth: number = 5
  ): Promise<number[]> {
    const visited = new Set<number>();
    const queue = [{ id: symbolId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id) || depth >= maxDepth) {
        continue;
      }

      visited.add(id);

      const deps = await db('dependencies')
        .where('from_symbol_id', id)
        .select('to_symbol_id');

      for (const dep of deps) {
        queue.push({ id: dep.to_symbol_id, depth: depth + 1 });
      }
    }

    return Array.from(visited);
  }
}
```

## Database Testing

### Test Database Setup

Tests use a separate database configured in `tests/setup.ts`:

```typescript
// tests/setup.ts
import { db } from '../src/database/connection';

beforeAll(async () => {
  // Ensure test database is used
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Tests must run with NODE_ENV=test');
  }

  // Run migrations
  await db.migrate.latest();
});

afterAll(async () => {
  // Cleanup
  await db.destroy();
});

beforeEach(async () => {
  // Clear data between tests
  await db('dependencies').delete();
  await db('symbols').delete();
  await db('files').delete();
  await db('repositories').delete();
});
```

### Testing Queries

```typescript
describe('SymbolService', () => {
  it('creates and retrieves symbols', async () => {
    const symbolData = {
      name: 'testFunction',
      symbol_type: 'function',
      file_id: 1,
      start_line: 10,
      end_line: 20
    };

    const id = await symbolService.create(symbolData);
    const retrieved = await symbolService.findById(id);

    expect(retrieved).toMatchObject(symbolData);
  });

  it('handles foreign key constraints', async () => {
    const invalidSymbol = {
      name: 'test',
      symbol_type: 'function',
      file_id: 99999, // Non-existent file
      start_line: 1,
      end_line: 10
    };

    await expect(symbolService.create(invalidSymbol))
      .rejects
      .toThrow(); // Foreign key violation
  });
});
```

## Vector Search (pgvector)

### Embedding Storage

Store embeddings for similarity search:

```typescript
export async function up(knex: Knex): Promise<void> {
  // Enable pgvector extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

  await knex.schema.alterTable('symbols', (table) => {
    table.specificType('embedding', 'vector(1536)');
    table.index(
      knex.raw('embedding vector_cosine_ops'),
      'symbols_embedding_idx',
      'ivfflat' // Index type for vector similarity
    );
  });
}
```

### Similarity Search

```typescript
async function findSimilarSymbols(
  embedding: number[],
  limit: number = 10
): Promise<Symbol[]> {
  const vectorString = `[${embedding.join(',')}]`;

  return db('symbols')
    .select('*')
    .orderByRaw(`embedding <=> ?::vector`, [vectorString]) // Cosine distance
    .limit(limit);
}
```

## Migration Workflow

### Development Workflow

```bash
# 1. Create migration
npm run migrate:make add_new_feature

# 2. Edit migration file
# (implement up and down methods)

# 3. Apply migration
npm run migrate:latest

# 4. Verify migration
npm run migrate:status

# 5. Test rollback (optional)
npm run migrate:rollback

# 6. Re-apply (if rolled back)
npm run migrate:latest
```

### Production Deployment

```bash
# Check current migration status
npm run migrate:status

# Apply pending migrations
npm run migrate:latest

# Verify success
npm run migrate:status
```

### Rollback Strategy

```bash
# Rollback last batch
npm run migrate:rollback

# Rollback all
npm run migrate:rollback --all

# Rollback to specific version
npm run migrate:rollback --to=023_create_framework_metadata_table.ts
```
