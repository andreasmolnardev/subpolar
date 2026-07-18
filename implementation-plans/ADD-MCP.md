# MCP support implementation plan

## Outcome

Add first-class Model Context Protocol support to Subpolar. MCP servers are exposed to Pi through one Subpolar-managed MCP gateway tool, while every tool exposed by an MCP server is represented individually inside Subpolar’s tool registry and passes through Subpolar’s existing authorization, approval, audit, persistence, and session-event paths. The gateway provides search, load/describe, and run capabilities so MCP tools remain centrally permissioned without expanding Pi’s tool surface.

The implementation covers:

- Local MCP servers launched as child processes, including `npx`, Bun, Python, and arbitrary executable binaries.
- Remote MCP servers using Streamable HTTP.
- Per-server environment variables for local processes.
- Per-server custom HTTP headers, including API keys and Bearer tokens.
- Self-hosted and cloud-hosted endpoints.
- Server discovery, connect/disconnect status, tool refresh, failures, cancellation, and cleanup.

## Current implementation evaluation

### Existing pieces to reuse

- `backend/src/runtime/pi-runtime.ts` creates one Pi `AgentSession` per run and already loads `backend/src/pi/extension.ts`.
- `backend/src/pi/extension.ts` registers native tools and has a `tool_call` hook that calls Subpolar authorization before Pi executes a tool.
- `backend/src/pi/tool-policy.ts` maps Pi tool names to Subpolar tool IDs and waits for approval records while publishing permission events through `sseAggregator`.
- `backend/src/services/subpolar-tool-router.ts` centralizes input validation, policy checks, approvals, execution, and audit records.
- `backend/src/db/subpolar-tools.ts` and the `tool_registry` / `agent_tool_policies` collections already model per-tool schemas and policy effects.
- `frontend/src/api/mcp.ts`, `McpManager`, `AddMcpServerDialog`, and project MCP components already describe local/remote configuration, headers, environment, status, and OAuth flows.
- `backend/src/routes/mcp-oauth-proxy.ts` contains useful OAuth discovery/callback logic, but currently writes OpenCode-compatible state and is not the MCP execution layer.

### Gaps and incorrect assumptions to resolve

- The installed Pi SDK explicitly has no built-in MCP support, so MCP must be implemented as an extension/client integration using `pi.registerTool()`.
- `backend/src/services/subpolar-tool-router.ts` recognizes `adapter: 'mcp'` but only returns a configured-status object; it does not connect to or call MCP. Its existing list/describe/call shape is the right Subpolar-layer boundary to extend.
- The seeded `mcp.github.*` tools are static placeholders and should not be the source of truth once server discovery is available.
- `backend/src/pi/tool-policy.ts` only maps built-in Pi names. Discovered MCP tool names need the same authorization path and stable mapping.
- The frontend calls `/api/settings/mcp`, `/connect`, `/disconnect`, directory variants, and `/api/config`, but the current backend settings/runtime routes shown in this repository do not implement the MCP server lifecycle endpoints.
- `PiNativeClient` is a 410 compatibility stub, so the old OpenCode MCP client path cannot be extended for native execution.
- MCP OAuth state is process-memory only and stores tokens in an OpenCode state file. Credentials need a Subpolar-owned secret store/reference model, with redaction and restart-safe behavior.
- The current `mcp` integration schema only supports `serverUrl` and `apiKey`; it cannot represent local commands, environment variables, headers, protocol metadata, or project/session scope.
- `RuntimeRunInput.tools` exists but is not used to register tools in `createAgentSession`; MCP tool definitions must be resolved before session creation or registered during the extension lifecycle.

## Design decisions

### Configuration and ownership

Introduce a persisted MCP server registry separate from the generic integration placeholder. A server record should contain:

- Stable server ID and display name.
- `transport: 'stdio' | 'streamable-http'`.
- Local command as an argv array, with no shell interpolation; optional working directory.
- Local environment entries represented as secret references or non-secret values, never plaintext in logs.
- Remote URL, custom headers as secret references/non-secret values, request timeout, and optional OAuth metadata.
- Enabled state, scope (`global` or project-specific), metadata, timestamps, and last status/error.

Use project identity/directory when resolving configuration for a run. A project override can disable or enable a global server without duplicating credentials. Define precedence and document it: project setting, then global setting, then disabled by default.

Keep secrets out of normal API responses. Return `hasEnvironment`, `environmentKeys`, `hasHeaders`, `headerNames`, and auth status instead of secret values. Use the existing encryption/secret utilities or add a dedicated encrypted secret reference store; do not put tokens in `tool_registry`, session metadata, audit input, SSE payloads, or Pi prompts.

### MCP client abstraction

Add a backend MCP client layer with narrow transport interfaces:

- `McpTransport`: initialize/close, list tools, call tool, and health/error state.
- `StdioMcpTransport`: spawn argv directly with `Bun.spawn`, pass an explicitly merged environment, speak MCP JSON-RPC over stdin/stdout, preserve stderr for redacted diagnostics, enforce startup/request timeouts, and kill the process tree on close.
- `StreamableHttpMcpTransport`: use fetch against the configured URL, negotiate MCP protocol/version, retain the MCP session ID, send custom headers on every request, support the server’s streamable response format, and close/terminate the session where supported.
- `McpConnectionManager`: keyed by run/session plus server ID, lazy-connects on demand, caches a connection during a run, serializes initialization, refreshes discovery, and closes all transports on completion, cancellation, failure, or process shutdown.

Use an MCP protocol implementation from a maintained dependency if compatible with Bun and the required Streamable HTTP/stdio transports. Verify the package API and protocol version before coding; otherwise implement only the small JSON-RPC transport boundary needed by the current MCP specification. Do not couple the client to Pi or PocketBase.

### Subpolar gateway exposure

Expose one Pi extension tool for MCP, preferably `subpolar-mcp` or an equivalent clearly named Subpolar tool. This is only the transport boundary into Subpolar; it is not one Pi tool per MCP subtool. The gateway should provide three operations:

- `search`: search available permitted MCP servers/tools by server name, tool name, and description.
- `load` or `describe`: return the exact schema, description, risk, server, and permission state for one permitted MCP subtool before execution.
- `run`: invoke one exact MCP subtool with a JSON object input after Subpolar policy and approval checks.

The gateway parameters should be strict enough to prevent accidental execution: `action` is required, `serverId` and `toolId` are required for `load`/`run`, and `input` is required for `run`. Search and load results must only include tools the current agent/project is allowed to discover. The model should be instructed to search/load before running unfamiliar tools, but the backend must enforce all permissions independently.

Register the single gateway before the model receives its first prompt. The extension must receive run context (`agentId`, `sessionId`, `runId`, `cwd`, project ID) without using process-global mutable state that can leak between concurrent runs. Prefer a per-session factory/context passed from `PiRuntimeAdapter`; if the SDK extension API cannot accept that directly, use an isolated extension instance/resource loader per run and pass a short-lived context object to the gateway closure.

Store every discovered definition in the Subpolar registry/cache with a stable ID such as `mcp.<serverId>.<encodedToolName>`. This stable ID is used by search, load, policy evaluation, approvals, execution, and audit records. It is never exposed as an independently registered Pi tool, and a remote server must not be able to overwrite a built-in or another server’s definition.

### Policy and approvals

Treat every discovered MCP subtool as an ordinary Subpolar tool, even though Pi reaches it through the one gateway:

- Register/update its name, namespace, description, input schema, output schema, adapter, target server ID, operation/tool name, risk, and enabled state.
- Preserve explicit deny precedence, wildcard policies, run permission overrides, required approval, and input validation.
- Default newly discovered tools to deny until an agent policy explicitly allows them; optionally support an explicit “approve all tools from this server” policy as a controlled convenience that still expands to server-scoped IDs.
- Classify read-only versus write/external/delete risk conservatively. Unknown MCP tools require approval by default.
- Route the gateway’s `run` operation through the same service-level policy/execution path so authorization cannot be bypassed by calling the extension directly. The Pi authorization hook should authorize the single gateway invocation, while the Subpolar router performs the authoritative per-subtool policy check for the requested stable MCP tool ID.
- Audit server ID, MCP tool name, stable Subpolar tool ID, run/session/agent IDs, status, duration, and bounded result/error summaries. Redact secrets and sensitive input fields according to server configuration.

Approvals must resume the original call safely. Do not reconnect with a different server configuration between approval creation and execution; bind the approval to a configuration/version fingerprint and reject stale approvals.

## Implementation phases

### 1. Shared contracts and persistence

- Add shared Zod/types for MCP server configuration, transport, scope, redacted status, discovered tool metadata, gateway search/load/run requests, and lifecycle responses.
- Add PocketBase collections/migrations for MCP servers, secret references, server-tool discovery records, and project enablement/overrides. Add unique indexes for server scope/name and server/tool identity.
- Add repository/service functions for CRUD, scope resolution, enabled-server lookup, tool replacement on rediscovery, stale-tool disabling, and secret redaction.
- Remove or migrate the static `mcp.github.*` seeds so discovered MCP tools, rather than fake integrations, are authoritative. Preserve an explicit migration path for existing users.

### 2. Transport and lifecycle service

- Add the transport interfaces and stdio/Streamable HTTP implementations.
- Validate local commands, URL schemes, header names, environment keys, timeouts, and maximum output sizes.
- Implement lazy start/connect, initialize handshake, `tools/list`, `tools/call`, health status, reconnect policy, and close semantics.
- Ensure local child processes inherit only an allowlisted base environment plus configured variables; never inherit secrets accidentally from the backend process.
- Add cancellation propagation from Pi’s `AbortSignal` to JSON-RPC requests and child processes.
- Add concurrency limits, request timeouts, bounded output, and per-server failure isolation so one unavailable server does not prevent other tools from loading.

### 3. Pi native registration and execution

- Refactor `backend/src/pi/extension.ts` from fixed global registration to a per-run MCP-aware extension factory while retaining skill, bash, Subpolar tools, and one MCP gateway tool.
- Resolve enabled MCP servers before `createAgentSession` or lazily on the first gateway search/load call, discover their tools, and make the permitted definitions available to the gateway. Do not register one Pi tool per discovered subtool. Surface discovery failures as server status and gateway results, not hidden tool calls.
- Extend `PiRuntimeAdapter.createSession` and `RuntimeRunInput` with resolved project context and a per-run MCP context/manager. Ensure all paths dispose the manager in `finally` and `cancel()`.
- Extend `mapPiToolName` / authorization for the single MCP gateway and call the shared router with the stable MCP subtool ID supplied to the gateway’s `run` action.
- Replace the MCP placeholder branch in `callIntegrationTool` with real dispatch through `McpConnectionManager`, while keeping non-MCP adapters unchanged.
- Map gateway and MCP progress/results/errors into existing `tool.requested`, `tool.updated`, `tool.completed`, and `tool.failed` events. Include the resolved server/tool IDs in metadata while keeping the visible Pi tool name as the Subpolar MCP gateway, so existing session persistence and UI render one native Subpolar tool call with useful subtool details.

### 4. API and UI lifecycle

- Implement the backend routes already expected by `frontend/src/api/mcp.ts`: list status/config, create/update/delete, connect/disconnect, directory/project overrides, auth start/callback/remove, refresh tools, and server diagnostics.
- Make connect/disconnect update persisted desired state and the lifecycle manager; a run may still lazy-start an enabled server if no long-lived connection exists.
- Update settings/project forms to support the canonical transport fields, secret inputs, environment entries, headers, timeouts, scope, and per-server enablement. Keep secret fields write-only and show redacted metadata.
- Show discovered tool counts and per-server tool discovery errors. Do not expose raw stderr, authorization headers, environment values, or access tokens.
- Update agent tool policy UI to include discovered MCP tools/server groups and make default-deny behavior clear.
- Replace OpenCode-specific MCP wording/state paths where it is part of the new native flow; retain OAuth proxy only behind the new secret persistence and transport lifecycle.

### 5. OAuth and remote authentication

- Rework `mcp-oauth-proxy` to persist provider/client/token state through the MCP secret service, keyed by user/server/scope, with TTLs and rotation handling.
- Support custom API-key and Bearer header configuration independently of OAuth.
- Validate redirect/state ownership, prevent SSRF in metadata discovery and callbacks, and redact tokens/errors.
- Add remote server authentication status and re-authentication behavior to the same lifecycle state machine.

### 6. Tests, migration, and documentation

- Add unit tests for config validation/redaction, tool-name encoding/collision handling, policy/risk mapping, JSON-RPC framing, Streamable HTTP responses, timeouts, cancellation, and result conversion.
- Add integration tests with a fixture stdio MCP server launched through Bun and a fixture Streamable HTTP MCP server. Verify `npx`, Python, and arbitrary binaries through command/argv fixtures without requiring network services.
- Test concurrent runs with different server environments/headers to prove no process-global leakage.
- Test server restart, disabled server, stale discovery, malformed schemas, duplicate tool names, approval pause/resume, cancellation, and cleanup after failed runs.
- Add API/UI tests for CRUD, project overrides, secret redaction, connect/disconnect, OAuth states, status polling, and policy editing.
- Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build`; add a documented fixture/manual smoke test covering one local and one remote server.
- Document configuration examples for local `npx`, Bun, Python, and Go commands plus Streamable HTTP with API key and Bearer headers, including security and default-deny guidance.

## Acceptance criteria

- A configured local server is started only when an enabled agent run needs it, receives its configured environment, makes all discovered MCP tools available through the single native Subpolar MCP gateway, and is terminated after the run/session lifecycle ends.
- A configured remote Streamable HTTP server is initialized on demand, receives custom headers on MCP requests, exposes all discovered tools individually, and reports connection/discovery/call failures without affecting unrelated servers.
- The model sees one native Subpolar MCP gateway tool with search/load/run schemas; MCP calls use that gateway rather than one Pi tool per server subtool.
- Every MCP subtool is visible to Subpolar policy evaluation behind the gateway, supports allow/deny/approval and run overrides, and produces the same persisted tool-call/audit/session events as built-in tools.
- Secrets never appear in API responses, prompts, tool input/output persistence, logs, audit summaries, or SSE metadata.
- Two simultaneous runs cannot share MCP processes, credentials, headers, mutable client state, or authorization context accidentally.
- Disconnect, cancellation, timeout, server crash, backend shutdown, and approval rejection all release resources and leave accurate status.
- Existing built-in Pi tools, Subpolar tools, session persistence, and non-MCP integrations continue to pass their current tests.

## Open decisions to confirm during implementation

a1. Whether “start when an agent needs them” means process lifetime per run (recommended for isolation) or a reusable per-project daemon. The plan assumes per-run/per-session ownership with lazy startup.
2. Whether global server configuration is user-scoped only or also workspace-scoped. The plan assumes global user configuration plus project overrides.
3. Whether to support MCP resources/prompts in this milestone. The requested scope is tools; resources/prompts should remain out of scope unless required by a target server’s tool behavior.
4. Which secret backend is the supported production source. The implementation must use an encrypted, restart-safe Subpolar-owned store rather than plaintext config files.
