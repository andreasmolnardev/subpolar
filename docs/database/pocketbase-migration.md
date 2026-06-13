# PocketBase Migration Guide

This guide documents the migration from SQLite to PocketBase as the database backend for subpolar.

## Status

**Current State**: Docker configuration is complete. PocketBase runs as a service alongside the application.

**Next Steps**: The application still uses SQLite. A PocketBase client wrapper has been created but full integration requires migrating all database queries from synchronous SQLite to asynchronous PocketBase SDK calls.

## What's Been Done

### 1. Docker Configuration

PocketBase service has been added to both `docker-compose.yml` and `docker-compose.dev.yml`:

```yaml
services:
  pocketbase:
    image: ghcr.io/pocketbase/pocketbase:latest
    container_name: subpolar-pocketbase
    ports:
      - "8090:8090"
    environment:
      - POCKETBASE_EMAIL=${POCKETBASE_EMAIL:-admin@example.com}
      - POCKETBASE_PASSWORD=${POCKETBASE_PASSWORD:-adminpassword}
    volumes:
      - pocketbase-data:/pb_data
```

### 2. Environment Configuration

Added to `.env`, `.env.example`, and `config.json`:

```
POCKETBASE_URL=http://localhost:8090
POCKETBASE_EMAIL=admin@example.com
POCKETBASE_PASSWORD=adminpassword
```

Added to `shared/src/config/defaults.ts` and `shared/src/config/env.ts`:

```typescript
POCKETBASE: {
  URL: 'http://localhost:8090',
  EMAIL: 'admin@example.com',
  PASSWORD: 'adminpassword',
}
```

### 3. PocketBase Client

Created `backend/src/db/pocketbase-client.ts` with:
- `PbClient` interface for database operations
- `PbCollectionClient` interface for collection operations
- Singleton pattern for client management
- Collection CRUD methods (getOne, getFirst, getList, getFullList, create, update, delete)

### 4. PocketBase Schema

Created `backend/src/db/pocketbase-schema.ts` with collection definitions for all existing SQLite tables:
- repos
- user_preferences
- opencode_configs
- user, session, account, verification, passkey (auth tables)
- trusted_ssh_hosts
- repo_settings
- opencode_model_state
- app_secrets
- schema_migrations
- automation_jobs
- automation_runs
- prompt_templates

## Quick Start

1. **Start PocketBase**:
   ```bash
   docker-compose up -d pocketbase
   ```

2. **Access PocketBase Admin UI**:
   - Navigate to `http://localhost:8090/_/`
   - Login with email: `admin@example.com` / password: `adminpassword` (or your configured credentials)

3. **Create Collections**:
   - Use the PocketBase Admin UI to create collections matching the schema in `backend/src/db/pocketbase-schema.ts`
   - Or use the PocketBase REST API to programmatically create collections

4. **Test Connection**:
   ```typescript
   import { getPocketBaseClient } from './db/pocketbase-client'
   
   const client = await getPocketBaseClient()
   const health = await client.healthCheck()
   console.log('PocketBase is healthy:', health)
   ```

## Migration Steps

### Phase 1: Collections Setup

1. Create all collections in PocketBase matching the schema definitions
2. Configure proper indexes and relationships
3. Import existing data from SQLite to PocketBase

### Phase 2: Update Database Layer

The application uses SQLite with synchronous queries. PocketBase uses asynchronous REST API calls.

**Key differences**:
- SQLite: `db.prepare('SELECT * FROM repos WHERE id = ?').get(id)` - synchronous
- PocketBase: `await client.getCollection('repos').getOne(id)` - asynchronous

**Migration approach**:

1. Update all query functions in `backend/src/db/` to be async
2. Replace `db.prepare()` calls with PocketBase collection methods
3. Update all callers to use `await`

### Phase 3: Service Layer Updates

Update services that use Database directly:
- `backend/src/services/` - many services import and use Database
- `backend/src/auth/index.ts` - authentication uses Database for sessions/users
- `backend/src/routes/` - route handlers use Database for queries

### Phase 4: Testing

1. Run existing tests against PocketBase
2. Fix any query incompatibilities
3. Performance testing

## Important Notes

### SQLite vs PocketBase Differences

| Feature | SQLite | PocketBase |
|---------|--------|------------|
| Query Language | SQL | REST API / Filter syntax |
| Synchronous/Async | Synchronous | Asynchronous |
| Transactions | Full ACID | Limited |
| Joins | Native SQL JOIN | Multiple queries + application join |
| Migrations | SQL DDL | Collection schema updates via API |

### PocketBase Filter Syntax

PocketBase uses a custom filter syntax instead of SQL WHERE clauses:

```typescript
// SQLite
SELECT * FROM repos WHERE clone_status = 'ready'

// PocketBase
const repos = await client.getCollection('repos').getFullList({
  filter: 'clone_status = "ready"'
})
```

Common operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `CONTAINS`, `LIKE`, `IN`

### Relationships

PocketBase uses relation fields for foreign keys:

```typescript
// In collection schema
{
  name: 'repo_id',
  type: 'relation',
  options: { collection: 'repos' }
}

// Query with expand
const runs = await client.getCollection('automation_runs').getList(1, 100, {
  expand: 'repo_id'
})
```

## Files to Migrate

### High Priority (Core Database)
- [ ] `backend/src/db/schema.ts` - Database initialization
- [ ] `backend/src/db/queries.ts` - Repository queries
- [ ] `backend/src/db/model-state.ts` - Model state management
- [ ] `backend/src/db/automations.ts` - Automation queries
- [ ] `backend/src/db/prompt-templates.ts` - Prompt template queries
- [ ] `backend/src/db/migration-runner.ts` - Migration runner

### Medium Priority (Services)
- [ ] `backend/src/services/settings.ts`
- [ ] `backend/src/services/repo.ts`
- [ ] `backend/src/services/notification.ts`
- [ ] `backend/src/services/automations.ts`
- [ ] `backend/src/services/prompt-templates.ts`
- [ ] `backend/src/services/git-auth.ts`
- [ ] `backend/src/services/opencode-single-server.ts`
- [ ] `backend/src/services/internal-token.ts`

### Medium Priority (Auth)
- [ ] `backend/src/auth/index.ts`
- [ ] `backend/src/auth/internal-token-middleware.ts`

### Medium Priority (Routes)
- All route files in `backend/src/routes/` that use Database

## Example Migration

### Before (SQLite)
```typescript
import type { Database } from 'bun:sqlite'

export function getRepoById(db: Database, id: number): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE id = ?')
  const row = stmt.get(id) as RepoRow | undefined
  return row ? rowToRepo(row) : null
}

// Usage
export function getRepoByLocalPath(db: Database, localPath: string): Repo | null {
  const stmt = db.prepare('SELECT * FROM repos WHERE local_path = ?')
  const row = stmt.get(localPath) as RepoRow | undefined
  return row ? rowToRepo(row) : null
}
```

### After (PocketBase)
```typescript
import { getPocketBaseClient, type PbCollectionClient } from './db/pocketbase-client'
import type { PbRepo } from './db/pocketbase-schema'

const reposCollection = (await getPocketBaseClient()).getCollection('repos')

export async function getRepoById(id: string): Promise<PbRepo | null> {
  return await reposCollection.getOne(id)
}

// Usage
export async function getRepoByLocalPath(localPath: string): Promise<PbRepo | null> {
  return await reposCollection.getFirst(`local_path = "${localPath}"`)
}
```

## Running with PocketBase

### Start all services:
```bash
docker-compose up -d
```

### Check PocketBase logs:
```bash
docker-compose logs -f pocketbase
```

### Access Admin UI:
- Production: `http://<your-server>:8090/_/`
- Development: `http://localhost:8090/_/`

## Troubleshooting

### Connection Issues
- Verify PocketBase container is running: `docker ps`
- Check PocketBase health: `curl http://localhost:8090/api/health`
- Verify credentials in environment variables

### Authentication Issues
- Ensure `POCKETBASE_EMAIL` and `POCKETBASE_PASSWORD` are set correctly
- Try admin auth first, then user auth
- Check PocketBase logs for authentication errors

### Collection Not Found
- Verify collection name spelling (case-sensitive)
- Check that collection exists in PocketBase Admin UI
- Verify proper permissions are set

## Resources

- PocketBase Documentation: https://pocketbase.io/docs/
- PocketBase JavaScript SDK: https://pocketbase.io/docs/client-js/
- PocketBase REST API: https://pocketbase.io/docs/api/

## Help Needed

This migration is substantial and requires:
1. Converting all synchronous SQLite code to asynchronous PocketBase code
2. Updating all function signatures that use Database
3. Testing all queries against PocketBase
4. Handling differences in query capabilities (joins, complex queries)

Consider breaking this into smaller PRs, starting with:
1. One collection at a time (e.g., start with `repos`)
2. Update all code that touches that collection
3. Test thoroughly
4. Move to next collection
