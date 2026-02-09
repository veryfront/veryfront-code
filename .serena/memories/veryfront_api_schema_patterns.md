# Veryfront API: Database Schema & Repository Patterns

## Latest Migration Number
**Current**: 0024 (0024_add_username.sql)
**Location**: `/Users/kentarowakayama/vf2/veryfront-api/drizzle/`

## Schema Structure

### File Locations
- **Schema Definition**: `/Users/kentarowakayama/vf2/veryfront-api/src/infrastructure/database/drizzle/schema/schema.ts`
- **Relations**: `/Users/kentarowakayama/vf2/veryfront-api/src/infrastructure/database/drizzle/schema/relations.ts`
- **Config**: `/Users/kentarowakayama/vf2/veryfront-api/drizzle.config.ts`

### ID Generation Pattern
- **Primary Key Type**: `uuid()`
- **Default Random ID**: `uuid().primaryKey().defaultRandom().notNull()`
- **Explicit UUID**: `uuid().primaryKey().notNull()` (when UUID is generated separately)
- **Special Cases**: Some legacy tables use text or other types, but UUIDs are standard

### UUID Generation in Code
```typescript
import { v4 as uuidv4 } from 'uuid'
const id = uuidv4()
```

### pgTable Pattern
```typescript
export const tableNameTable = pgTable(
  'table_name',  // SQL table name (snake_case)
  {
    // Column definitions
    id: uuid().primaryKey().notNull(),
    name: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  table => [
    // Indexes
    index('idx_table_name_lookup').using('btree', table.id.asc().nullsLast().op('uuid_ops')),
    // Foreign keys
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projectTable.id],
      name: 'table_name_project_id_fk',
    }).onDelete('cascade'),
    // Unique constraints
    unique('table_name_unique').on(table.id),
  ]
)
```

### pgEnum Pattern
```typescript
export const branchStatusEnum = pgEnum('branch_status', ['active', 'merged', 'closed'])

// Usage in table:
status: branchStatusEnum().default('active').notNull(),
```

### Timestamp Fields Pattern
Always use:
```typescript
timestamp('field_name', { withTimezone: true, mode: 'string' })
  .default(sql`CURRENT_TIMESTAMP`)
```
The `mode: 'string'` is critical - all timestamps are ISO strings, not Date objects.

## Environment Table Structure

### Schema Definition
```typescript
export const environmentTable = pgTable(
  'environment',
  {
    id: uuid().primaryKey().notNull(),
    name: text().notNull(),
    projectId: uuid('project_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    protected: boolean().default(false).notNull(),
  },
  table => [
    index('environment_project_idx').using('btree', table.projectId.asc().nullsLast().op('uuid_ops')),
    index('environment_project_index').using('btree', table.projectId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projectTable.id],
      name: 'environment_project_id_fk',
    }).onDelete('cascade'),
  ]
)
```

### Related Tables
- **environmentVariableTable**: One-to-many (CASCADE delete)
- **domainTable**: One-to-many (CASCADE delete)
- **deploymentTable**: One-to-many (CASCADE delete)

### Relations Definition
```typescript
export const environmentRelations = relations(environmentTable, ({ one, many }) => ({
  domains: many(domainTable),
  project: one(projectTable, {
    fields: [environmentTable.projectId],
    references: [projectTable.id],
  }),
  deployments: many(deploymentTable),
  environmentVariables: many(environmentVariableTable),
}))
```

## Repository Pattern

### Base Class Extension
```typescript
export class EnvironmentRepository extends BaseRepositoryImpl<
  Environment,
  string,  // ID type
  CreateEnvironmentInput,
  UpdateEnvironmentInput
> {
  constructor() {
    super(TABLES.MAIN.ENVIRONMENT, 'Environment')
    this.drizzleDb = db
  }
}
```

### Constructor Pattern
```typescript
constructor() {
  super(TABLES.MAIN.ENVIRONMENT, 'Environment')
  this.drizzleDb = db
}
```

### Database Access Pattern
```typescript
// Get database instance (transaction or main)
private getDb(context?: Context): DrizzleDb | DrizzleTransaction {
  return (context?.transaction as DrizzleTransaction) || this.drizzleDb
}

// Use in methods:
const database = this.getDb(context)
await database.select().from(environmentTable).where(...)
```

### Tracer Usage Pattern
```typescript
async methodName(id: string, context?: Context): Promise<ReturnType> {
  return tracer.trace('repo.entity.methodName', async () => {
    const logger = this.getLogger('methodName', context, { entityId: id })
    
    try {
      // Implementation
    } catch (error) {
      return this.handleDatabaseError(error, 'method name', id, context)
    }
  })
}
```

### Standard CRUD Methods

#### GetById
```typescript
async getById(id: string, context?: Context): Promise<Environment | null> {
  return tracer.trace('repo.environment.getById', async () => {
    const logger = this.getLogger('getById', context, { environmentId: id })
    
    try {
      const normalizedId = normalizeId(id)
      if (!normalizedId) {
        logger.warn('Invalid environment ID format', { environmentId: id })
        return null
      }
      
      const database = this.getDb(context)
      const [env] = await database
        .select()
        .from(environmentTable)
        .where(eq(environmentTable.id, normalizedId))
        .limit(1)
      
      if (!env) {
        logger.debug('Environment not found', { environmentId: id })
        return null
      }
      
      return env
    } catch (error) {
      return this.handleDatabaseError(error, 'get', id, context)
    }
  })
}
```

#### GetAll with Pagination
```typescript
async getAll(params: QueryParams, context?: Context): Promise<Environment[]> {
  return tracer.trace('repo.environment.getAll', async () => {
    const logger = this.getLogger('getAll', context)
    
    try {
      const { where, sortBy, orderBy, first, skip } = params
      const database = this.getDb(context)
      
      let query = database.select().from(environmentTable)
      
      // Build WHERE conditions
      const conditions = []
      if (where?.name) {
        conditions.push(eq(environmentTable.name, where.name))
      }
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any
      }
      
      // Pagination
      if (skip) query = query.offset(skip) as any
      if (first) query = query.limit(first) as any
      
      const results = await query
      return results
    } catch (error) {
      return this.handleDatabaseError(error, 'get all', undefined, context)
    }
  })
}
```

#### Create
```typescript
async create(data: CreateEnvironmentInput, context?: Context): Promise<Environment> {
  return tracer.trace('repo.environment.create', async () => {
    const logger = this.getLogger('create', context)
    
    try {
      if (!data.name) {
        throw new InvalidInputError('Environment name is required', 'name')
      }
      
      const database = this.getDb(context)
      const environmentId = uuidv4()
      const now = new Date().toISOString()
      
      await database.insert(environmentTable).values({
        id: environmentId,
        name: data.name,
        projectId: data.projectId,
        createdAt: now,
        updatedAt: now,
      })
      
      return { id: environmentId, ...data, createdAt: now, updatedAt: now }
    } catch (error) {
      return this.handleDatabaseError(error, 'create', undefined, context)
    }
  })
}
```

#### Update
```typescript
async update(id: string, data: UpdateEnvironmentInput, context?: Context): Promise<Environment> {
  return tracer.trace('repo.environment.update', async () => {
    const logger = this.getLogger('update', context, { environmentId: id })
    
    try {
      const normalizedId = normalizeId(id)
      if (!normalizedId) {
        throw new ValidationError('Invalid environment ID format', {
          environmentId: id,
          operation: 'update',
        })
      }
      
      const database = this.getDb(context)
      
      // Verify exists
      const [existing] = await database
        .select()
        .from(environmentTable)
        .where(eq(environmentTable.id, normalizedId))
        .limit(1)
      
      if (!existing) {
        throw new ResourceNotFoundError('Environment', id)
      }
      
      // Update
      await database
        .update(environmentTable)
        .set({
          ...data,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(environmentTable.id, normalizedId))
      
      // Fetch and return updated
      const updated = await this.getById(id, context)
      if (!updated) {
        throw new ResourceNotFoundError('Environment', id)
      }
      
      logger.info('Environment updated successfully', { environmentId: id })
      return updated
    } catch (error) {
      return this.handleDatabaseError(error, 'update', id, context)
    }
  })
}
```

#### Delete
```typescript
async delete(id: string, context?: Context): Promise<{ id: string }> {
  return tracer.trace('repo.environment.delete', async () => {
    const logger = this.getLogger('delete', context, { environmentId: id })
    
    try {
      const normalizedId = normalizeId(id)
      if (!normalizedId) {
        throw new ValidationError('Invalid environment ID format', {
          environmentId: id,
          operation: 'delete',
        })
      }
      
      const database = this.getDb(context)
      
      const [env] = await database
        .select()
        .from(environmentTable)
        .where(eq(environmentTable.id, normalizedId))
        .limit(1)
      
      if (!env) {
        throw new ResourceNotFoundError('Environment', id)
      }
      
      await database.delete(environmentTable).where(eq(environmentTable.id, normalizedId))
      
      logger.info('Environment deleted successfully', { environmentId: id })
      return { id: normalizedId }
    } catch (error) {
      return this.handleDatabaseError(error, 'delete', id, context)
    }
  })
}
```

## Drizzle Config

Location: `/Users/kentarowakayama/vf2/veryfront-api/drizzle.config.ts`

```typescript
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/infrastructure/database/drizzle/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
})
```

### Running Migrations

Migrations are stored in `./drizzle/` directory.

Example migration (0024_add_username.sql):
```sql
-- Add username column to user table
ALTER TABLE "user" ADD COLUMN "username" varchar(39);

-- Unique constraint (partial, case-insensitive - only for non-null usernames)
CREATE UNIQUE INDEX "user_username_unique" ON "user" (LOWER("username")) WHERE "username" IS NOT NULL;

-- Index for lookups (case-insensitive)
CREATE INDEX "idx_user_username" ON "user" (LOWER("username")) WHERE "username" IS NOT NULL;
```

## Key Imports

```typescript
// ORM
import { type DrizzleDb, type DrizzleTransaction, db } from '@infrastructure/database/drizzle'
import { environmentTable, environmentVariableTable, domainTable } from '@infrastructure/database/drizzle/schema'

// Base classes
import { BaseRepositoryImpl, type QueryParams } from '@lib/base-repository'

// Error handling
import { 
  InvalidInputError, 
  ResourceAlreadyExistsError, 
  ResourceNotFoundError, 
  ValidationError 
} from '@lib/errors'

// Utilities
import { normalizeId } from '@lib/shared'
import { tracer } from '@lib/tracer'

// Drizzle query builders
import { and, asc, eq, inArray, like, not, sql } from 'drizzle-orm'

// UUID
import { v4 as uuidv4 } from 'uuid'

// Context
import type { Context } from '@api/graphql/utils/context'
```

## Interface/Type Patterns

```typescript
// Entity type
export interface Environment {
  id: string
  name: string
  projectId: string
  protected?: boolean
  createdAt?: string
  updatedAt?: string
  domains?: string[]
  environmentVariables?: Array<{ id: string; name: string; value: string }>
}

// Create input
export interface CreateEnvironmentInput {
  name: string
  projectId: string
  domains?: string[]
}

// Update input
export interface UpdateEnvironmentInput {
  name?: string
}

// Query params
export interface QueryParams {
  where?: Record<string, unknown>
  search?: string
  sortBy?: Array<{ field: string; direction: 'asc' | 'desc' }>
  orderBy?: string
  first?: number
  skip?: number
}
```

## Error Handling Pattern

```typescript
private handleDatabaseError(error: unknown, operation: string, id?: string, context?: Context): never {
  const logger = this.getLogger(`${operation}Error`, context, { entityId: id })
  
  logger.error(`Database error during ${operation}`, {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    entityId: id,
    operationName: context?.operationName,
  })
  
  if (
    error instanceof ValidationError ||
    error instanceof ResourceNotFoundError ||
    error instanceof InvalidInputError
  ) {
    throw error
  }
  
  throw new DatabaseError(`Failed to ${operation} Entity`, {
    entityId: id,
    operationName: context?.operationName,
    originalError: error instanceof Error ? error.message : String(error),
  })
}

// In catch blocks:
catch (error) {
  return this.handleDatabaseError(error, 'method name', id, context)
}
```

## Transaction Pattern

```typescript
// Check if transaction exists
const hasExistingTransaction = !!context?.transaction

if (hasExistingTransaction) {
  // Use existing transaction
  return await executeOperation(database)
} else {
  // Create new transaction
  return await database.transaction(async trx => executeOperation(trx))
}

// Or use .transaction() directly:
const result = await database.transaction(async trx => {
  // Operations in trx
  return result
})
```

## Foreign Key Constraints

Pattern:
```typescript
foreignKey({
  columns: [table.foreignKeyColumn],
  foreignColumns: [referencedTable.id],
  name: 'table_name_foreign_key_fk',
}).onDelete('cascade'), // or 'set null', 'restrict', 'no action'
```

Common patterns:
- `onDelete('cascade')` - Delete child when parent deleted
- `onDelete('set null')` - Set to null when parent deleted
- `onDelete('restrict')` - Prevent deletion if children exist

## Index Naming Convention

- Simple index: `idx_{table}_{field}`
- Composite index: `idx_{table}_{field1}_{field2}`
- Unique index: `{table}_{field}_unique`
- Partial index: Include `.where()` clause

## Unique Constraint Pattern

```typescript
unique('constraint_name').on(table.field)
// Or composite:
unique('constraint_name').on(table.field1, table.field2)

// Partial (conditional):
uniqueIndex('constraint_name')
  .on(table.field)
  .where(sql`field IS NOT NULL`)
```
