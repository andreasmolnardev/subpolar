# End-to-End Pi Migration Final Plan

## Status

Planned. This document is the implementation contract for removing OpenCode as an active product and runtime concept from Subpolar.

## Executive summary

Subpolar must expose and own its HTTP API. Pi is an embedded SDK/runtime used by the backend; it is not a public HTTP API and must not become one.

The target architecture is:

```text
Frontend
  -> Subpolar HTTP API
    -> Subpolar session, run, event, agent, project, settings, and tool services
      -> Pi SDK/runtime adapter
        -> providers, models, skills, MCP, and tool execution
```

The migration therefore has two distinct outcomes:

1. Replace OpenCode-specific public and internal terminology with native Subpolar concepts.
2. Keep Pi-specific terminology only at the SDK/runtime integration boundary.

Do not rename OpenCode routes to Pi routes. Replace them with resource-oriented Subpolar routes or remove them when there is no remaining product capability behind them.

## Goals

- Remove OpenCode from active runtime code, HTTP routes, frontend imports, UI copy, configuration paths, environment variables, tests, documentation, and generated artifacts.
- Make the frontend depend on native Subpolar API modules and shared Subpolar schemas.
- Keep Pi SDK usage isolated under `backend/src/runtime/pi` and Pi-specific model/config integration code.
- Preserve user data and existing workspace content through an explicit one-time migration.
- Preserve only the minimum legacy importer needed to migrate existing installations, with a clear removal deadline.
- Make all session and run execution flow through the native Subpolar session/run API.
- Remove OpenCode server lifecycle, process management, reload, upgrade, and compatibility behavior.

## Non-goals

- Do not create a Pi HTTP server or pretend Pi has a public API.
- Do not expose Pi SDK internals directly to the frontend.
- Do not rewrite Pi SDK behavior that already works.
- Do not silently delete existing user configuration, sessions, skills, or workspace state.
- Do not rename historical migration files in a way that breaks PocketBase migration ordering.
- Do not preserve OpenCode compatibility routes indefinitely.

## Naming policy

### Use Subpolar for product and HTTP concepts

Use these names for public and application-level concepts:

- `Subpolar API`
- `SubpolarClient`
- `SUBPOLAR_API_BASE_URL`
- `Session`, `Run`, `Message`, `Agent`, `Project`, `Tool`, `Skill`, `Provider`, and `Model`
- `RuntimeEvent` for normalized backend-to-frontend events
- `SubpolarConfig` for Subpolar-owned persisted settings

Use resource-oriented paths such as:

- `/api/health`
- `/api/projects`
- `/api/sessions`
- `/api/runs`
- `/api/events`
- `/api/agents`
- `/api/providers`
- `/api/models`
- `/api/settings`
- `/api/tools`
- `/api/skills`
- `/api/integrations`

The exact path should follow the existing route ownership and avoid introducing a second API namespace merely to replace a word.

### Use Pi only for SDK/runtime concepts

Pi is appropriate in names such as:

- `PiRuntimeAdapter`
- `PiRunContext`
- `PiModelRegistry`
- `PiConfig` when the value is specifically a Pi SDK configuration or provider/model profile
- `PiInternal` for a temporary backend-only adapter that directly wraps the Pi SDK

Pi is not appropriate in frontend route constants, HTTP URLs, public client names, or user-facing copy.

### Remove rather than rename obsolete concepts

Delete code whose only purpose is to manage the old runtime:

- OpenCode server spawning
- OpenCode process health and version checks
- OpenCode install, upgrade, reload, and restart flows
- OpenCode plugin/cache initialization
- OpenCode-specific config recovery
- OpenCode-only API specifications and generated clients
- OpenCode-only model-state compatibility helpers

## Current inventory

The current tree contains approximately 1,245 OpenCode matches across 168 tracked files. They fall into these groups:

- Runtime and backend clients: `OpenCodeClient`, `openCodeClient`, `opencode-single-server`, server manager, import, recovery, and model-state names.
- HTTP paths: `/api/opencode`, `/api/internal/opencode-workspaces`, `/opencode-configs`, `/opencode-import`, `/opencode-reload`, `/opencode-upgrade`, and `/opencode-install-version`.
- Config paths: `.config/opencode`, `.opencode`, `opencode.json`, `opencode.db`, and OpenCode state directories.
- Shared contracts: `OpenCodeConfig*`, `shared/src/schemas/opencode.ts`, generated `opencode-types.ts`, and `opencode-spec.json`.
- Frontend modules: OpenCode API endpoint constants, event stream modules, error modules, hooks, model editors, and OpenCode UI text.
- General Chat and skills: `.opencode/agents`, `.opencode/skills`, `opencode-context`, and OpenCode-specific generated instructions.
- Environment and deployment: `OPENCODE_*` variables, Docker volume names, binary paths, and database paths.
- Persistence: `opencode_configs`, `opencode_model_state`, and `opencode_config_name`.
- Tests and fixtures: OpenCode route paths, mocks, fixture paths, test names, and old server lifecycle tests.
- Documentation and metadata: upstream repository URLs, OpenCode installation instructions, screenshots, logos, and historical plans.

The inventory must be regenerated at the start and end of every implementation phase with:

```sh
rg -n -i --hidden --glob '!.git/**' --glob '!.pnpm-store/**' 'opencode|open code' .
```

Generated build output and dependency directories must be excluded from source audits and removed from source control if tracked.

## Target architecture

### Backend request flow

1. Frontend calls a native Subpolar route.
2. Route validates a Subpolar request schema.
3. Route persists session/run state through Subpolar services.
4. Runtime registry selects the Pi runtime adapter.
5. `PiRuntimeAdapter` creates an `AgentSession` through the Pi SDK.
6. Pi SDK events are normalized into `RuntimeEvent` values.
7. Subpolar persists and streams normalized events.
8. Frontend renders Subpolar session/run/message/tool state.

No request should be forwarded to an external OpenCode server, and no route should require an OpenCode process to be running.

### Runtime boundary

The only layer allowed to import Pi SDK implementation details is the backend runtime integration and the small set of services that explicitly manage Pi models, auth, or profiles.

The runtime boundary owns:

- `AuthStorage`
- `ModelRegistry`
- `DefaultResourceLoader`
- `SessionManager`
- `AgentSession`
- Pi event mapping
- Pi cancellation and disposal
- Pi MCP/session context integration

The runtime boundary must not own HTTP route naming, frontend types, or user-facing provider terminology.

### Skills

Skills should be Subpolar-managed or project-managed resources:

- `.subpolar/skills/<name>/SKILL.md` for project-local skills
- workspace/global Subpolar skill directories for managed skills
- Pi `DefaultResourceLoader` for loading those skills into an `AgentSession`

Existing `.opencode/skills` directories must be read during migration, copied or moved to the new location, and reported to the user. Do not destroy the old directory until migration succeeds and backup retention requirements are met.

### General Chat

General Chat must generate Subpolar-owned files and instructions:

- `.subpolar/agents/<name>.md`
- `.subpolar/skills/<name>/SKILL.md`
- `subpolar.json` or a clearly named Subpolar profile file only if a file is still needed
- `.subpolar/internal-token`

If the Pi SDK can consume the required settings without a workspace config file, remove generated config files entirely and keep settings in the Subpolar database/filesystem service. Do not generate an OpenCode-shaped config merely because a legacy helper expects one.

## Phase 0: Freeze and baseline

### Work

- Freeze new OpenCode-specific features.
- Record current branch and working-tree state.
- Capture the current API route list, frontend API callers, persisted PocketBase collections, and workspace file conventions.
- Record current test, lint, and typecheck failures separately from migration failures.
- Add a migration tracking section to the implementation issue or release notes.

### Required outputs

- Baseline `rg` inventory.
- Baseline `pnpm lint` result.
- Baseline backend and frontend typecheck results.
- Baseline test result.
- List of persisted data fields requiring migration.

## Phase 1: Establish native Subpolar contracts

### Backend

- Define native request/response schemas for sessions, runs, messages, events, agents, projects, providers, models, settings, tools, and skills.
- Ensure `/api/sessions` and `/api/runs` are the canonical execution API.
- Ensure SSE or streaming endpoints expose normalized `RuntimeEvent` values.
- Define stable error codes under Subpolar ownership.
- Remove any route dependency on an OpenCode client or server manager.

### Shared package

- Rename `shared/src/schemas/opencode.ts` to a native schema module, likely `runtime.ts`, `sessions.ts`, or `messages.ts` depending on its actual contents.
- Replace `OpenCodeConfig*` aliases with native types.
- Remove aliases instead of keeping both names once all consumers are migrated.
- Move Pi-specific config schemas to a Pi/runtime module only when they represent actual Pi SDK settings; otherwise use `SubpolarConfig`.
- Update `shared/src/schemas/index.ts` and all package exports.

### Frontend

- Replace imports from `@/api/opencode-types` with native shared/client types.
- Introduce a typed `SubpolarClient` only if a shared client abstraction is useful.
- Keep API modules resource-specific: `sessions.ts`, `runs.ts`, `agents.ts`, `projects.ts`, and so on.
- Remove the generated OpenCode client dependency from application code.

## Phase 2: Migrate session, run, and event execution

### Work

- Audit every caller of `OpenCodeClient`, `createOpenCodeClient`, and `openCodeClient`.
- Route each caller to native Subpolar APIs or direct backend services where appropriate.
- Replace OpenCode-shaped session creation with the existing native session/run flow.
- Ensure automation execution uses native run creation and Pi model IDs.
- Ensure project chat, General Chat, history, retry, command, tool, permission, and question flows use native Subpolar endpoints.
- Rename event stream modules and types to runtime/Subpolar terminology.
- Keep event payload compatibility only at the boundary where existing persisted messages require it.

### Acceptance checks

- A new chat creates a Subpolar session and run without an OpenCode URL or process.
- Streaming text, reasoning, tool, permission, question, completion, cancellation, and error events work.
- Reloading the backend does not require an OpenCode server.
- The frontend contains no `OPENCODE_API_ENDPOINT` or `/api/opencode` usage.

## Phase 3: Migrate agents, prompts, skills, and tools

### Agents and prompts

- Keep `prompt` as the durable agent behavior field only if it remains semantically distinct.
- Use `systemPrompt` as the resolved prompt passed to the Pi runtime.
- Move prompt assembly to a backend service so API-created and UI-created agents behave identically.
- Include project instructions, selected skills, generated tool schemas, and agent-specific behavior in the same resolution path.
- Do not rely on the frontend prompt preview as the authoritative system prompt.
- Add tests for API-created agents, legacy agents with empty `systemPrompt`, full skill discovery, generated tool schemas, project instructions, and explicit overrides.

### Skills

- Replace `.opencode/skills` discovery with `.subpolar/skills` and supported project `skills/` discovery.
- Rename `opencode-context` to `subpolar-context` or `runtime-context`.
- Remove OpenCode-specific skill instructions and URLs.
- Ensure auto-generated Subpolar tool skills include their input schema and are loaded through the Pi resource loader.
- Preserve skill access policy semantics: name, description, full, and search discovery modes.

### Tools and MCP

- Keep Subpolar CLI tools behind Subpolar tool routes and authorization policies.
- Keep MCP integration behind Subpolar services and Pi MCP session support.
- Remove descriptions that tell agents to use an OpenCode server or OpenCode config.
- Verify approval, denial, audit, and agent identity injection behavior.

## Phase 4: Replace configuration and settings

### Configuration model

Separate these concepts:

- `SubpolarSettings`: application preferences, integrations, agent definitions, tool policies, and workspace settings.
- `PiProfile`: provider/model/auth/resource-loader settings that are genuinely consumed by the Pi SDK.

Do not call either concept `OpenCodeConfig`.

### Filesystem migration

- Replace `.config/opencode` with a Subpolar-owned directory.
- Replace `opencode.json` with a Subpolar/Pi profile filename only if the Pi SDK requires a file.
- Replace `.opencode` managed workspace files with `.subpolar` equivalents.
- Replace OpenCode auth/state paths with Pi/Subpolar paths.
- Provide a one-time migration command/service that detects old paths, validates input, copies data, and records completion.
- Make migration idempotent and safe to retry.

### Profile behavior

- Validate profile names with a safe slug schema.
- Never map invalid names to the default profile.
- Make `isDefault` behavior explicit and test it.
- Prevent deleting the active profile without selecting or creating a replacement.
- Avoid silently accepting `userId` parameters if configuration is no longer user-scoped; remove them from the API once clients are migrated.

### Remove old settings behavior

Delete after migration:

- OpenCode config reload endpoints
- OpenCode config recovery
- last-known-good OpenCode config persistence
- OpenCode server restart settings
- OpenCode import status endpoints, unless retained as a time-limited migration endpoint

## Phase 5: Migrate persistence

### PocketBase

- Add forward migrations for renamed collections and fields.
- Preserve old migrations unchanged; PocketBase migration filenames and ordering are historical records.
- Migrate `opencode_configs` data into the new Pi/Subpolar profile storage.
- Migrate `opencode_model_state` into the native model-state collection.
- Migrate `opencode_config_name` project fields into the new profile-name field.
- Update indexes, rules, and API permissions.
- Add an idempotent data migration test with old records and expected new records.

### Filesystem data

- Detect `.config/opencode`, `.opencode`, and OpenCode state paths.
- Copy rather than delete on first migration.
- Write a migration marker containing version, timestamp, source paths, and result.
- Keep a backup until the user-approved retention window expires.
- Report conflicts instead of overwriting user files silently.

### Database compatibility

- Keep read-only legacy support only during the migration window.
- Do not add new writes to legacy collections or fields.
- Remove legacy reads after all supported versions have migrated.

## Phase 6: Remove the OpenCode process and compatibility layer

Remove:

- `opencode-single-server.ts`
- OpenCode process spawning
- OpenCode binary discovery
- OpenCode install and upgrade code
- OpenCode server health/version state
- OpenCode reload/restart code
- OpenCode plugin/cache initialization
- OpenCode config recovery
- OpenCode-compatible client forwarding
- OpenCode-only import code after the migration window

Before deletion, prove that all callers have moved to:

- native Subpolar routes,
- `PiRuntimeAdapter`,
- `ModelRegistry`,
- `DefaultResourceLoader`,
- Subpolar tool/MCP services, or
- the explicit one-time migration service.

## Phase 7: Frontend cleanup

- Rename or delete `opencode-types.ts`, `opencode-spec.json`, `opencode-errors.ts`, and `opencode-event-stream`.
- Replace `OPENCODE_API_ENDPOINT` with a Subpolar API base URL.
- Replace OpenCode query keys with resource-oriented Subpolar keys.
- Rename hooks and API modules.
- Remove OpenCode labels from login, setup, project, settings, automation, MCP, and server-health UI.
- Replace OpenCode logo assets with Subpolar branding or remove unused assets.
- Update frontend tests and fixtures to use native Subpolar routes and types.
- Remove OpenCode-specific generated files from source control if they are no longer generated.

## Phase 8: Documentation, deployment, and repository cleanup

- Rewrite README and setup documentation around Subpolar and Pi SDK usage.
- Remove OpenCode installation and server-running instructions.
- Update Dockerfiles, compose files, volume names, health checks, and binary paths.
- Rename `OPENCODE_*` environment variables or remove them when obsolete.
- Update `AGENTS.md` and project instructions.
- Rewrite implementation plans that describe OpenCode as a current runtime.
- Keep historical migration notes only when clearly marked as historical.
- Replace old repository URLs only if the canonical repository has changed; do not rewrite third-party URLs that are intentionally cited as migration sources.

## Phase 9: Tests and verification

### Unit tests

- Pi runtime session creation and disposal
- model lookup and thinking-level handling
- prompt resolution
- project instruction loading
- skill discovery and disabled skills
- generated tool skill schema exposure
- profile validation and default selection
- filesystem migration idempotency
- database migration behavior
- normalized runtime event mapping

### Route tests

- native session and run routes
- streaming and event routes
- agent and project routes
- provider/model routes
- settings and profile routes
- tool and MCP authorization routes
- migration status/import routes, if retained

### Frontend tests

- native API client calls
- chat/session/run lifecycle
- SSE/event stream handling
- agent selection and prompt editing
- settings/profile UI
- tools, permissions, questions, and approvals
- project skill and MCP configuration

### Integration tests

- clean installation with no legacy files
- installation with legacy OpenCode files
- installation with legacy PocketBase records
- migration conflict handling
- multiple projects and General Chat
- cancellation and backend restart
- no OpenCode process or network dependency

### Static audits

The final audit must pass all of the following, excluding historical migration records and explicitly documented migration fixtures:

```sh
rg -n -i --hidden --glob '!.git/**' --glob '!.pnpm-store/**' --glob '!docs/history/**' 'opencode|open code' backend frontend shared scripts skills config.json Dockerfile* docker-compose* .env* README.md AGENTS.md
```

There must be no active references to:

- `OpenCodeClient`
- `OPENCODE_API_ENDPOINT`
- `/api/opencode`
- `.opencode`
- `opencode.json`
- OpenCode server manager/process code
- OpenCode UI labels or logos

## Compatibility and deprecation policy

If existing users require migration support:

1. Introduce a versioned migration service.
2. Make it one-way, idempotent, observable, and removable.
3. Do not expose OpenCode terminology in normal UI flows.
4. Do not add new features to legacy routes or models.
5. Mark legacy endpoints deprecated and emit structured warnings.
6. Set a removal release and test that the removal does not affect migrated installations.

Historical PocketBase migrations may retain old field names because changing them would corrupt migration history. Those are not active runtime references and should be documented as immutable history.

## Ordering and dependency graph

The implementation must proceed in this order:

1. Baseline and inventory.
2. Define native Subpolar shared contracts.
3. Establish native session/run/event routes.
4. Migrate frontend execution callers.
5. Move prompt, skill, tool, and MCP behavior behind native services.
6. Migrate config, profiles, and filesystem state.
7. Migrate PocketBase data.
8. Remove OpenCode process and compatibility code.
9. Remove generated OpenCode API files and frontend imports.
10. Rewrite deployment, docs, assets, and tests.
11. Run full static and behavioral verification.

Do not delete the old runtime before native session/run execution and migration tests pass.

## Risks and mitigations

### Breaking existing clients

Mitigation: migrate the in-repository frontend first, provide a short-lived route alias only if required, and remove it on a scheduled release.

### Losing user configuration

Mitigation: copy legacy files, validate before activation, retain backups, and make migration idempotent.

### Prompt behavior changing

Mitigation: centralize backend prompt resolution and add golden tests for representative agents and skills.

### Pi SDK assumptions leaking into the API

Mitigation: keep `RuntimeAdapter` and normalized `RuntimeEvent` as the boundary; never expose SDK objects through HTTP responses.

### Stale generated files masking references

Mitigation: remove build artifacts from audits, regenerate only from native sources, and fail CI when forbidden active references are found.

### Existing unrelated type/lint failures

Mitigation: record the baseline, require changed-surface checks for each phase, and finish with a clean full-project validation pass.

## Definition of done

The migration is complete when:

- The frontend communicates only with native Subpolar HTTP routes.
- The backend runs without spawning, connecting to, or depending on an OpenCode server.
- Pi SDK usage is isolated behind the runtime boundary.
- No active source, UI, config, environment, deployment, test, or documentation references use OpenCode terminology.
- Legacy workspace and PocketBase data migrate successfully and safely.
- OpenCode compatibility routes and process code are deleted or are explicitly limited to the documented migration window.
- General Chat, agents, skills, tools, MCP, automations, sessions, runs, streaming, cancellation, and settings work through native Subpolar services.
- `pnpm lint`, typechecks, targeted tests, integration tests, and the final forbidden-reference audit pass.
- Build artifacts and dependency output are not committed.

## Suggested implementation checklist

- [ ] Capture baseline inventory and validation results.
- [ ] Define native shared schemas and route contracts.
- [ ] Add native session/run/event API coverage.
- [ ] Migrate frontend API modules and hooks.
- [ ] Centralize backend prompt resolution.
- [ ] Move skills to Subpolar-owned paths.
- [ ] Verify Subpolar tool and MCP authorization.
- [ ] Define and implement profile/filesystem migration.
- [ ] Add PocketBase forward migrations and data migration tests.
- [ ] Remove OpenCode server lifecycle and compatibility code.
- [ ] Remove generated OpenCode API files and assets.
- [ ] Rewrite environment, Docker, README, and docs.
- [ ] Update tests and fixtures.
- [ ] Run lint, typecheck, unit, route, integration, build, and static audits.
- [ ] Publish migration notes and the compatibility removal date.
