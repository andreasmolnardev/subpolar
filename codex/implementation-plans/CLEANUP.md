# Repository Cleanup Plan

## Goal

Simplify Subpolar without removing supported behavior. The target architecture is one native Pi SDK runtime, one set of Subpolar-owned API contracts, one tool-routing service, and clearly separated compatibility/import boundaries.

This audit is based on the current repository state. The worktree already contains unrelated user changes; implementation should preserve them and land cleanup in small, independently verifiable changes.

## Executive summary

The repository has completed the central migration to the Pi SDK for interactive sessions, but several surrounding layers still model the former OpenCode architecture. The largest simplification is to finish that migration:

1. Move automations and internal assistant operations onto the native runtime.
2. Remove the non-functional `PiNativeClient` compatibility shell and its OpenCode-shaped interfaces.
3. Replace the 6,802-line generated OpenCode frontend contract with small Subpolar-owned shared schemas/types.
4. Collapse tool discovery and invocation onto the existing service layer instead of making loopback HTTP calls.
5. Remove obsolete aliases, duplicate discovery, stale product language, and repository artifacts.

The first four items reinforce each other and should be implemented in that order. They reduce parallel runtime concepts rather than merely renaming them.

## Findings and recommendations

### P0: Finish the native Pi migration for automations

**Evidence**

- `backend/src/runtime/pi/client.ts` implements `PiInternalClient`, but all general forwarding methods return `410` or throw `"OpenCode runtime has been replaced by Pi"`.
- `backend/src/index.ts` still constructs that client and injects it into internal routes and services.
- `backend/src/services/automations.ts` still uses the client to resolve models, create sessions, send prompts, abort runs, load skills, and read messages.
- `backend/src/routes/internal/assistant.ts`, `backend/src/routes/mcp-oauth-proxy.ts`, and parts of `backend/src/services/repo.ts` also retain forwarding calls.
- User-facing automation copy still says prompts are sent to OpenCode, and the service throws `"Failed to create OpenCode session"`.

**Why simplify**

This is a second runtime abstraction with no working runtime behind it. Keeping it makes supported-looking automation paths depend on deliberate failure behavior and forces OpenCode request/response shapes to remain in the codebase.

**Implementation**

1. Define small native use cases around the existing `RuntimeRegistry`:
   - start an automation session/run;
   - cancel a run;
   - retrieve persisted session messages;
   - resolve a Pi model;
   - dispose or reload resources only where the Pi SDK actually requires it.
2. Inject those focused interfaces into `AutomationService` rather than a generic HTTP forwarding client.
3. Reuse the same session/run persistence and event mapping used by `backend/src/routes/sessions.ts`; extract orchestration from that route into a service before sharing it.
4. Read skill content through `SkillsService` or the Pi resource loader rather than through an internal HTTP endpoint.
5. Replace the internal assistant “dispose instance” operation with the correct native Pi resource/session action. If Pi sessions are intentionally per-run and already disposed, remove the no-op endpoint and update its caller rather than recreating server-instance semantics.
6. Move MCP OAuth operations directly to the existing MCP service. Do not route them through a runtime client.
7. After parity tests pass, delete:
   - `backend/src/runtime/pi/client.ts`;
   - obsolete members of `backend/src/runtime/pi/internal-client-types.ts`;
   - forwarding-only branches and OpenCode client test stubs.

**Acceptance criteria**

- Scheduled and manual automation runs create, stream, persist, cancel, and report results through `RuntimeRegistry`.
- Internal assistant and MCP OAuth operations no longer receive intentional `410` responses.
- No production code imports `PiInternalClient`, `PiNativeClient`, or an `OpenCodeClient` runtime abstraction.
- Existing automation behavior has integration tests using a fake `RuntimeAdapter`, not an HTTP-forwarding fake.

### P0: Extract session orchestration from the route layer

**Evidence**

- `backend/src/routes/sessions.ts` is 684 lines and owns validation, persistence, title generation, prompt construction, event consumption, tool event handling, message assembly, and run status transitions.
- Automations need much of the same lifecycle and currently implement it through the dead compatibility client.
- `backend/src/routes/runs.ts` reaches separately into `RuntimeRegistry` for cancellation.

**Why simplify**

Moving the reusable lifecycle into one service eliminates the pressure to maintain a second API-shaped runtime path and gives sessions, automations, and future callers one behavior.

**Implementation**

1. Introduce a focused `SessionRunService` with operations such as `start`, `cancel`, and `generateTitle`.
2. Move runtime-event-to-database handling from `sessions.ts` into the service without changing wire responses.
3. Keep Hono routes responsible only for parsing, authorization, status mapping, and serialization.
4. Inject the service into session, run, and automation entry points.
5. Split event mapping and persisted message assembly into private modules only if each has an independently testable responsibility; avoid a generic “manager” layer.

**Acceptance criteria**

- `sessions.ts` and `runs.ts` contain HTTP concerns only.
- Interactive and automated runs share the same lifecycle implementation.
- Existing session, cancellation, SSE, tool-call, and title-generation tests remain green.

### P1: Replace the OpenCode-generated frontend API contract

**Evidence**

- `frontend/src/api/opencode-types.ts` is 6,802 generated lines and is backed by `frontend/src/api/opencode-spec.json`, an OpenCode API specification.
- `frontend/src/api/types.ts`, `frontend/src/api/subpolar.ts`, `frontend/src/hooks/usePiHarness.tsx`, runtime error handling, message rendering, commands, todos, and stores import those types.
- The frontend accepts duplicate legacy SSE names such as `message.updated` and `messagev2.updated`.
- The repository already has shared Zod contracts for runtime, SSE, settings, skills, projects, and other native APIs in `shared/src/schemas`.
- `scripts/generate-openapi.ts` still fetches and generates files named `opencode-*`.

**Why simplify**

Most of a foreign API contract is retained to type a much smaller native surface. It obscures which events and fields Subpolar actually supports, preserves deprecated variants, and creates parallel types instead of using `@subpolar/shared`.

**Implementation**

1. Inventory the exact generated schema members still imported by production frontend code.
2. Add or complete Subpolar-owned schemas in `shared/src/schemas` for:
   - sessions and message parts;
   - questions and permissions;
   - todos;
   - runtime/provider errors;
   - SSE events actually emitted by the backend.
3. Infer frontend types from those shared schemas and update API clients incrementally.
4. Add contract tests that parse representative backend responses and SSE events with the shared schemas.
5. Remove legacy `messagev2.*` handling after confirming the backend never emits it. If external clients require it, normalize aliases once at the SSE boundary instead of throughout frontend stores/hooks.
6. Delete `opencode-types.ts`, `opencode-spec.json`, and the generation script when no imports remain. If OpenAPI generation is still desired, generate from Subpolar’s own Hono contract and name it accordingly.

**Acceptance criteria**

- Production frontend code has no import from `api/opencode-types`.
- Every frontend-consumed backend event has one canonical shared type.
- The generated OpenCode specification and its 6,802-line output are removed.
- Frontend typecheck and SSE/message tests pass.

### P1: Remove loopback HTTP from in-process tool discovery

**Evidence**

- `PiRuntimeAdapter.getGeneratedToolSkills()` calls its own server at `/api/subpolar-cli/tools/list` using an internal bearer token.
- The endpoint constructs `ToolGateway`, which only delegates to `listToolsForAgent`, `describeToolForAgent`, and `callTool`.
- `backend/src/pi/tool-policy.ts` already calls `callTool` directly.
- `backend/src/pi/extension.ts` uses the HTTP API because the extension executes with run context, while the runtime adapter already has the database dependency.

**Why simplify**

The loopback request adds serialization, auth, port configuration, failure swallowing, and endpoint coupling to an in-process operation. The `ToolGateway` class is a pass-through wrapper around three functions.

**Implementation**

1. In `PiRuntimeAdapter`, call `listToolsForAgent(this.options.db, agentId)` directly.
2. Extract the tool-to-generated-skill mapping into a pure function and test it once.
3. Remove `ToolGateway`; have HTTP routes call the tool-router functions directly or expose a focused injected service if test substitution is needed.
4. Keep `/api/subpolar-cli` only as the external CLI/extension boundary.
5. Longer term, pass a capability object into the Pi extension through supported SDK extension context if available. Until then, retain authenticated HTTP only for the separately loaded extension.
6. Remove `baseUrl` and `internalToken` from `PiRuntimeAdapterOptions` if no remaining adapter use requires them.

**Acceptance criteria**

- Starting a Pi run does not make an HTTP request to the same backend process.
- CLI behavior and extension tool calls are unchanged.
- Tool visibility and permission tests cover both the native runtime and external endpoint boundary.

### P1: Consolidate skill discovery and loading

**Evidence**

- `PiRuntimeAdapter.getProjectSkillPaths()` contains the identical `.subpolar/skills` candidate twice.
- The same adapter asks `DefaultResourceLoader` for skills, independently scans project skills, reads `.disabled` marker files, and merges generated tool skills.
- `backend/src/services/skills.ts` separately discovers global, project, and `.subpolar/skills` locations.
- The adapter calls `loader.reload()` twice without changing loader configuration between calls.

**Why simplify**

There are multiple partially overlapping definitions of where a skill lives and how precedence/disablement works. This risks displaying one set of skills in settings while exposing another set to the agent.

**Implementation**

1. Define one shared skill-location resolver in `backend/src/services/skills.ts`.
2. Decide and document precedence among bundled, global, project, and generated tool skills.
3. Make `.disabled` handling part of that resolver rather than a runtime-only convention.
4. Configure `DefaultResourceLoader` once from the resolved paths and call `reload()` once.
5. Merge and deduplicate skills once by canonical name, preserving the chosen precedence.
6. Remove the duplicate path literal and adapter-specific filesystem scanners.

**Acceptance criteria**

- Settings discovery and runtime loading return the same enabled project skills.
- Each directory is scanned once per run initialization.
- Tests cover duplicate names, disabled skills, missing directories, and precedence.

### P1: Make provider data have one source of truth

**Evidence**

- `/api/provider` is described as a Pi SDK compatibility endpoint.
- `frontend/src/api/providers.ts` defines overlapping `PiModel`, `Model`, `Provider`, and `ProviderWithModels` shapes.
- `getProvidersWithModels()` fetches registry providers, separately reads the default Pi config through settings, reconstructs configured providers in the browser, merges the two lists, and applies client-side precedence.
- Model selection uses `providerID/modelID`, while several UI and settings paths retain older provider terminology and query keys.

**Why simplify**

Provider merge rules are product behavior and should not be reimplemented in the browser. Multiple model shapes create optional-field propagation and conversion code.

**Implementation**

1. Make the backend provider service return the final normalized provider list, including source, connection status, configured overrides, and model keys.
2. Define that response in `@subpolar/shared`.
3. Collapse `PiModel`, `Model`, `Provider`, and `ProviderWithModels` into a minimal normalized pair unless a distinct editing DTO is genuinely required.
4. Remove `getConfiguredProviders()` and frontend merge/sort logic.
5. Keep `/api/provider` only if an external compatibility consumer exists; otherwise move the frontend to `/api/providers` and remove the singular endpoint.
6. Rename stale React Query keys as a cache migration in the same release.

**Acceptance criteria**

- The frontend performs no provider/config merge.
- A model is identified consistently by `providerID` and `modelID`.
- Provider selector, defaults, credentials, variants, custom endpoints, and automation model selection keep working.

### P2: Remove obsolete OpenCode aliases and product language

**Evidence**

- `shared/src/schemas/settings.ts` exports Pi schemas again under eight `OpenCode*` aliases.
- `shared/src/types/index.ts` exports five corresponding type aliases.
- Production use found for `OpenCodeConfigInput` is limited to `SkillsEditor`; frontend settings types also re-export the old name.
- General-chat prompt text tells agents to import from `@opencode-manager/shared`, which conflicts with the workspace package name `@subpolar/shared`.
- Documentation clone commands still target `opencode-manager`; several settings and automation labels still refer to OpenCode/OCM.
- Docker development volume names are still `opencode-workspace` and `opencode-data`.

**Why simplify**

Aliases hide migration completion and allow new code to keep using obsolete terms. Stale instructions can cause agents and users to perform incorrect actions.

**Implementation**

1. Change remaining internal imports to `PiConfig*` names.
2. Remove aliases after a repository-wide usage check.
3. Update user-facing copy, docs, query keys, volume names, and generated general-chat instructions to Subpolar/Pi terminology.
4. Preserve explicitly named OpenCode import functionality (`pi-internal-import.ts`) as a bounded migration adapter. Name it clearly as legacy import code and do not mix it with live runtime code.
5. Treat renaming persistent Docker volumes as a data migration: document the command or retain explicit external volume mapping for one release.

**Acceptance criteria**

- “OpenCode” remains only in legacy import/migration code and documentation explaining that import.
- Generated agent instructions reference `@subpolar/shared`.
- No runtime/config type is exported twice under Pi and OpenCode names.

### P2: Split oversized feature modules by responsibility

**Evidence**

- `backend/src/services/general-chat.ts` is 1,359 lines.
- `backend/src/services/automations.ts` is 1,295 lines.
- `backend/src/services/repo.ts` is 1,204 lines.
- Large frontend modules include `GlobalAutomations.tsx` (912), `usePiHarness.tsx` (897), `AgentDialog.tsx` (868), `ProviderSettings.tsx` (796), and `ProductivitySidebar.tsx` (774).
- These files mix orchestration, transformation, persistence/API calls, and presentation state.

**Why simplify**

File length alone is not a reason to split. These particular modules contain multiple independently changing responsibilities and make obsolete paths harder to identify.

**Implementation order**

1. Split only while implementing the higher-priority migrations above.
2. Extract pure transformations and focused services/hooks first.
3. Keep feature-local modules together; avoid catch-all `utils` files and one-function wrappers.
4. Suggested boundaries:
   - general chat: workspace files, generated instructions, bundled skills, initialization/status;
   - automations: schedule persistence, runtime execution, result rendering;
   - repo: discovery, credentials, workspace deletion/import compatibility;
   - `usePiHarness`: transport/event normalization, optimistic state, public hook;
   - dialogs/settings: data hook, form schema/state, presentational sections.

**Acceptance criteria**

- Extracted units have a single reason to change and direct tests.
- Public module APIs shrink; no duplicate “old” and “new” implementation remains.

### P2: Normalize caches and background cleanup

**Evidence**

- `backend/src/routes/tts.ts` contains a feature-specific filesystem cache implementation, including TTL, size calculation, eviction, and file IO.
- `backend/src/services/mcp-oauth-state.ts` owns two process-local maps and starts a module-level interval that is never `unref()`ed or explicitly disposed.
- TTS cache eviction calls `cleanupOldestFiles(audioData.length)` rather than the actual excess over the maximum, which can evict more than necessary.

**Why simplify**

Routes should not own cache policy, and module-level timers complicate tests and process lifecycle. A tiny shared bounded-cache utility can support deterministic cleanup without creating a framework.

**Implementation**

1. Move TTS caching into `TtsAudioCache` with `get` and `put`.
2. Evict only `currentSize + incomingSize - maxSize`.
3. Replace the OAuth module timer with lazy expiry on access, or an injected disposable store. If retaining a timer, call `unref()` and expose cleanup for tests/shutdown.
4. Do not combine in-memory OAuth state and filesystem audio into one generic cache implementation; share only small expiry/eviction helpers where useful.

**Acceptance criteria**

- TTS routes contain request handling, not filesystem eviction logic.
- OAuth-state tests do not leave active timers.
- Cache limits and expiry are covered with deterministic clocks.

### P3: Remove confirmed dead or repository-only artifacts

**Evidence**

- `frontend/src/lib/exportSession.ts` has no production importer.
- `backend/src/services/archive.ts:createRepoArchive` has no production or test caller; directory archive operations are the used path.
- `docs/database/pocketbase-migration.md` is an empty tracked file.
- `.pnpm-store/v11/.pnpm-needs-build-marker` is tracked.
- `shared/src/.DS_Store` exists in the source tree.
- Root `bun.lockb`, `backend/bun.lock`, and `shared/bun.lock` coexist with the declared pnpm workspace and `pnpm-lock.yaml`.
- Root runtime dependencies duplicate frontend dependencies (`@radix-ui/react-tooltip` and `class-variance-authority`) even though the root package is primarily the CLI/workspace runner.
- Maskable and regular PWA icons are byte-identical at both sizes; this may be intentional but should be verified against the manifest and safe-area requirements.

**Implementation**

1. Confirm the session export has no hidden route/menu consumer, then either wire it into the intended UI or delete it. Given YAGNI, deletion is preferred unless it is currently specified behavior.
2. Delete `createRepoArchive` after confirming no external package import is supported.
3. Delete the empty doc, tracked package-store marker, and `.DS_Store`; add appropriate ignore rules.
4. Standardize on `pnpm-lock.yaml`; remove Bun lockfiles after confirming Docker, local development, and release automation all install with pnpm.
5. Move dependencies to the workspace package that imports them and remove unused root dependencies.
6. Generate real maskable icons or reference the regular icons without claiming `maskable` purpose.

**Acceptance criteria**

- A fresh clone/install/build does not recreate tracked noise.
- Only one workspace lockfile is authoritative.
- No exported production function is retained without a caller or documented external API.

### P3: Align code-quality rules with enforceable behavior

**Evidence**

- Repository guidance says “no console logs,” but frontend components use `console.error`/`console.warn`; backend logger intentionally delegates to console.
- `backend/src/pi/extension.ts` recreates partial Pi SDK types locally with `unknown` and optional methods.
- The codebase contains comments despite a blanket “no comments” rule, including operational Docker comments and generated code.

**Why simplify**

Rules that cannot distinguish application logging from a logger backend, or explanatory operational comments from dead commented code, create noisy cleanup work and inconsistent enforcement.

**Implementation**

1. Define the real rule: production application modules use the logger/reporting abstraction; logger adapters and scripts may use console.
2. Add ESLint restrictions for frontend production files with explicit exceptions for tests and logger adapters.
3. Use exported Pi SDK extension types where available. If upstream does not export them, isolate the compatibility type in one adapter module and add a version-contract test.
4. Revise the comment rule to prohibit commented-out code and redundant narration, while allowing necessary API, security, and operational explanations.

**Acceptance criteria**

- Lint enforces the intended logging boundary.
- Direct console calls are removed from UI components or routed to an error-reporting service.
- Pi SDK upgrades fail in a focused adapter test rather than across loosely typed extension code.

## Recommended implementation sequence

### Phase 1: Establish safety nets

- Add integration coverage for automation execution/cancellation and native session lifecycle.
- Add shared-contract fixtures for current SSE, message, provider, permission, and question payloads.
- Record the supported external `/api/subpolar-cli` surface.
- Run the full baseline verification and document any pre-existing failures.

### Phase 2: Unify runtime orchestration

- Extract `SessionRunService`.
- Migrate automations and internal operations to it.
- Move MCP OAuth calls to the MCP service.
- Delete the dead Pi/OpenCode forwarding client and obsolete interfaces.

### Phase 3: Unify tools, skills, and providers

- Remove in-process loopback tool discovery.
- Consolidate skill path resolution and loading.
- Normalize providers on the backend and shrink frontend provider types.

### Phase 4: Own the API contract

- Add missing shared schemas.
- Migrate frontend imports away from `opencode-types`.
- Canonicalize SSE event names.
- Remove the foreign generated spec and generator.

### Phase 5: Remove migration residue and artifacts

- Remove OpenCode aliases and stale product copy, leaving only the explicit legacy importer.
- Delete confirmed unused modules/exports and tracked noise.
- Standardize lockfiles, dependencies, Docker volume naming, and PWA icons.
- Update documentation last so it describes the final architecture.

## Verification for every phase

Run:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Also verify the affected behavior manually:

- create a general-chat and project session;
- select a provider/model and reasoning level;
- stream text, reasoning, tool calls, permissions, questions, and todos;
- cancel and retry a run;
- execute and cancel an automation;
- discover and call an MCP and OpenAPI tool;
- complete MCP OAuth;
- edit skill enablement and confirm runtime visibility;
- build and start the production Docker image;
- upgrade an existing Docker installation without losing named-volume data.

## Scope boundaries

- Keep OpenCode import support if importing existing user data remains a product requirement; isolate it as migration-only code.
- Keep `/api/provider` or `/api/subpolar-cli` only where an identified external consumer requires compatibility. Compatibility should terminate at the HTTP boundary and should not shape internal services.
- Do not combine unrelated features into generic frameworks during cleanup.
- Do not retain old and new implementations in parallel after each migration is verified.
