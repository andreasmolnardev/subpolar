# Run MCP Servers in Docker

Issue: #28

## Goal

Add Docker-backed MCP server configuration. Docker MCP servers use MCP stdio transport and run through host Docker daemon access. Users can configure Docker image, command arguments, and encrypted environment variables.

## Current Architecture

- MCP integrations persist as `type: 'mcp'` with `transport: 'stdio' | 'streamable-http'`.
- Local stdio servers use `Bun.spawn` in `backend/src/services/mcp.ts`.
- MCP environment variables and HTTP headers are stored encrypted in `mcp_secrets`; API responses expose only key names.
- `IntegrationsSettings.tsx` currently presents MCP type followed by transport selector.
- Application Docker containers do not include Docker CLI or host Docker socket access.

## Design

Docker remains an MCP stdio transport. Add execution mode rather than a new integration or PocketBase type:

```ts
type McpExecution = 'local' | 'docker'
```

Docker MCP configuration persists in existing integration `config` JSON:

```ts
{
  transport: 'stdio',
  execution: 'docker',
  image: 'docker.gitea.com/gitea-mcp-server',
  args: [],
  timeout: 15000,
}
```

Existing stdio records without `execution` remain local, preserving compatibility. No PocketBase migration required.

## Implementation

### 1. Shared MCP schema

Update `shared/src/schemas/settings.ts`:

- Add optional `execution: z.enum(['local', 'docker'])` to MCP configuration.
- Add optional Docker-specific `image` and `args` fields.
- Keep `transport` as `stdio | streamable-http`.
- Model Docker as `transport: 'stdio', execution: 'docker'`.
- Default omitted `execution` to local at runtime, retaining current persisted configurations.

### 2. Backend request validation and persistence

Update `backend/src/routes/settings.ts`:

- Extend MCP integration request schema for `execution`, `image`, and `args`.
- Validate by configuration:
  - Remote Streamable HTTP: valid `serverUrl`.
  - Local stdio: non-empty `command`.
  - Docker stdio: non-empty `image`; reject remote Docker combinations.
- Persist Docker fields in integration `config` alongside existing timeout and stdio configuration.
- Continue encrypting `environment` through `saveMcpSecrets` and returning only `environmentKeys`.
- Preserve existing encrypted environment variables on edit when UI sends key names without replacement values; remove stored keys deleted by user.
- Close cached discovery connections before rediscovering after MCP integration updates so changed config starts a new process/container.
- Extend legacy `/settings/mcp` request handling consistently, or route it through same MCP config conversion.

### 3. Docker stdio execution

Update `backend/src/services/mcp.ts`:

- Extend `McpServerConfig` with Docker execution fields.
- Resolve Docker configuration into direct argv:

  ```text
  docker run -i --rm -e KEY_1 -e KEY_2 IMAGE ARG_1 ARG_2
  ```

- Pass decrypted configured values only through spawned Docker CLI environment. Each `-e KEY` forwards matching value into MCP container.
- Use direct argv with `Bun.spawn`; never invoke a shell or interpolate user values into command strings.
- Maintain current connection lifecycle: one Docker container per MCP connection/session and `docker run --rm` cleanup when `StdioConnection.close()` kills Docker CLI.
- Capture bounded stderr and attach it to initialization errors so absent socket, image pull, and server startup failures are diagnosable.
- Keep request timeout and minimum initialization timeout behavior unchanged.

### 4. Integration modal

Update `frontend/src/components/settings/IntegrationsSettings.tsx`:

- Replace generic MCP option plus transport selector with explicit form choices:
  - `MCP: stdio via Docker`
  - `MCP: Remote Streamable HTTP`
  - `MCP: local stdio`
  - Existing OpenAPI, CalDAV, and IMAP/SMTP options
- Map UI choice to underlying integration type and MCP `transport`/`execution` fields.
- Remove MCP transport selector.
- Docker form fields:
  - Integration name
  - Docker image
  - Docker arguments, one exact argv item per line
  - Environment variables
  - Request timeout
- Local form retains command, working directory, environment variables, and timeout.
- Remote form retains server URL, HTTP headers, and timeout.
- Apply mode-specific validation before save.
- Show MCP subtype on list cards to distinguish Docker, local stdio, and remote HTTP integrations.
- Retain write-only secret behavior: pre-existing variable names remain visible, values remain blank/masked, replacement only occurs for supplied values.

### 5. Docker CLI image support

Update `Dockerfile` and `Dockerfile.dev`:

- Install Docker CLI client only. Do not run Docker daemon inside Subpolar container.
- Ensure installation supports supported amd64 and arm64 builds.

### 6. Opt-in host socket access

Create Compose override files, for example:

- `docker-compose.docker.yml` for production `app` service.
- `docker-compose.dev.docker.yml` for development `backend` service.

Each mounts:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Keep `docker-compose.yml` and `docker-compose.dev.yml` socket-free by default.

Update `scripts/docker-entrypoint.sh`:

- When `/var/run/docker.sock` exists, inspect socket group ID.
- Add or reuse matching group inside container and run backend as `node` with that supplementary group.
- Do not change host socket ownership or permissions.
- Keep behavior unchanged when socket is absent.

### 7. Documentation and environment configuration

Update `.env.example` and `docs/configuration/docker.md`:

- Document required `SUBPOLAR_MCP_SECRET_KEY` for MCP environment variable encryption.
- Document production startup:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.docker.yml up -d
  ```

- Document matching development command.
- Explain Docker socket exposure grants root-equivalent control of Docker host and must be deliberately enabled.
- Add Gitea example:

  ```text
  Image: docker.gitea.com/gitea-mcp-server
  Environment: GITEA_ACCESS_TOKEN=<personal access token>
  ```

  This resolves to:

  ```text
  docker run -i --rm -e GITEA_ACCESS_TOKEN docker.gitea.com/gitea-mcp-server
  ```

## Tests

1. Add shared schema coverage for local stdio, remote HTTP, Docker stdio, invalid Docker configs, and compatibility with omitted execution mode.
2. Add backend MCP service tests for exact generated Docker argv, environment forwarding, no shell expansion, stderr error propagation, and connection cleanup.
3. Add settings route tests for Docker configuration validation, persistence, redacted secret responses, secret replacement/preservation/removal, and rediscovery behavior.
4. Add frontend component tests for explicit MCP mode options and mode-specific form fields and validation.
5. Validate Compose files:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.docker.yml config
   docker compose -f docker-compose.dev.yml -f docker-compose.dev.docker.yml config
   ```

6. Run:

   ```bash
   pnpm test
   pnpm typecheck
   pnpm lint
   pnpm build
   ```

## Acceptance Criteria

- User can configure Gitea and equivalent MCP images using image, exact args, and environment variables.
- Environment secret values are encrypted at rest and never returned by integration APIs.
- Docker command uses `docker run -i --rm` with direct argv and no shell interpolation.
- Local stdio and remote HTTP MCP configurations continue to work.
- Docker socket access remains opt-in and documented as privileged host access.
- Missing Docker CLI or socket yields actionable MCP connection/discovery errors.
