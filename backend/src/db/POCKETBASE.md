# PocketBase Database Integration

This directory contains the PocketBase integration for subpolar.

## Quick Start

Start PocketBase with Docker:

```bash
# Production
docker-compose up -d pocketbase

# Development  
docker-compose -f docker-compose.dev.yml up -d pocketbase
```

Access the PocketBase Admin UI at `http://localhost:8090/_/`

Default credentials (configurable via environment variables):
- Email: `admin@example.com`
- Password: `adminpassword`

## Files

- **`pocketbase-client.ts`** - PocketBase client wrapper with CRUD operations
- **`pocketbase-schema.ts`** - Collection schema definitions for all tables
- **`schema.ts`** - Database initialization (currently uses SQLite, PocketBase integration in progress)

## Usage

### Import the client

```typescript
import { getPocketBaseClient } from './db/pocketbase-client'

// Get the singleton client instance
const client = await getPocketBaseClient()
```

### Collection operations

```typescript
// Get a collection
const repos = client.getCollection('repos')

// Get a record by ID
const repo = await repos.getOne('record-id')

// Get first matching record
const repo = await repos.getFirst('local_path = "/path/to/repo"')

// Get all records
const allRepos = await repos.getFullList()

// Create a record
const newRepo = await repos.create({
  local_path: '/path/to/repo',
  clone_status: 'pending',
  cloned_at: Date.now()
})

// Update a record
const updatedRepo = await repos.update('record-id', {
  clone_status: 'ready'
})

// Delete a record
await repos.delete('record-id')
```

### Direct client access

```typescript
import { getPocketBaseClient } from './db/pocketbase-client'

const client = await getPocketBaseClient()

// Access underlying PocketBase client for advanced operations
const pbClient = client.client

// Admin operations
if (client.isAdmin) {
  // Create collection, etc.
}

// Health check
const isHealthy = await client.healthCheck()
```

## Schema

All collection schemas are defined in `pocketbase-schema.ts`. Use these as reference when creating collections in the PocketBase Admin UI.

### Creating Collections via API

To programmatically create collections, use the PocketBase Admin API:

```typescript
import { getPocketBaseClient } from './db/pocketbase-client'
import { REPOS_COLLECTION } from './pocketbase-schema'

const client = await getPocketBaseClient()

// Note: Collection creation via API requires admin access
// and is typically done through the Admin UI
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POCKETBASE_URL` | Yes | `http://localhost:8090` | PocketBase server URL |
| `POCKETBASE_EMAIL` | Yes | `admin@example.com` | Admin/user email |
| `POCKETBASE_PASSWORD` | Yes | `adminpassword` | Admin/user password |

## Configuration

Add to `.env`:

```
POCKETBASE_URL=http://localhost:8090
POCKETBASE_EMAIL=admin@example.com
POCKETBASE_PASSWORD=adminpassword
```

Or use `config.json`:

```json
{
  "POCKETBASE_URL": "http://localhost:8090",
  "POCKETBASE_EMAIL": "admin@example.com",
  "POCKETBASE_PASSWORD": "adminpassword"
}
```

## Migration from SQLite

See `docs/database/pocketbase-migration.md` for detailed migration guide.

The main differences to handle:

1. **Synchronous -> Asynchronous**: SQLite uses sync queries, PocketBase uses async REST calls
2. **SQL -> Filter syntax**: WHERE clauses become PocketBase filter strings
3. **Joins -> Multiple queries**: SQL JOINs need to be replaced with multiple queries + application-side joins
4. **Transactions**: Limited support in PocketBase compared to SQLite

## Testing

Test the PocketBase client:

```typescript
import { getPocketBaseClient } from './db/pocketbase-client'

async function test() {
  const client = await getPocketBaseClient()
  
  // Health check
  const healthy = await client.healthCheck()
  console.log('Healthy:', healthy)
  
  // Test collection
  const repos = client.getCollection('repos')
  const list = await repos.getList(1, 10)
  console.log('Repos:', list.items.length)
}

test().catch(console.error)
```

## Troubleshooting

### Connection refused
- Verify PocketBase is running: `docker ps | grep pocketbase`
- Check container logs: `docker-compose logs pocketbase`
- Test health endpoint: `curl http://localhost:8090/api/health`

### Authentication failed
- Verify `POCKETBASE_EMAIL` and `POCKETBASE_PASSWORD` are correct
- Try logging in via Admin UI first to verify credentials
- Check if admin user exists: `docker-compose exec pocketbase ls /pb_data`

### Collection not found
- Verify collection name (case-sensitive)
- Check collections exist in Admin UI
- Ensure you're using the correct collection name (not table name from SQLite)

## Docker Commands

```bash
# Start PocketBase only
docker-compose up -d pocketbase

# Stop PocketBase
docker-compose stop pocketbase

# Restart PocketBase
docker-compose restart pocketbase

# View logs
docker-compose logs -f pocketbase

# Reset PocketBase data (WARNING: deletes all data)
docker-compose down -v
docker-compose up -d pocketbase
```

## Resources

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [JavaScript SDK](https://pocketbase.io/docs/client-js/)
- [REST API](https://pocketbase.io/docs/api/)
- [GitHub Repository](https://github.com/pocketbase/pocketbase)
