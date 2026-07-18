# OpenAPI tool servers implementation plan

## Outcome

Add first-class OpenAPI 3.x tool servers alongside MCP servers. A user supplies an OpenAPI JSON document, Subpolar discovers its operations, stores each operation in the existing tool registry, and exposes them to agents through one native gateway in the same search/load/run shape as `subpolar-mcp`.

Each discovered operation receives a stable tool ID:

```
openapi.<providerName>.<subtool>
```

`providerName` is the normalized, lowercase provider slug chosen when the integration is created. `subtool` is the unique OpenAPI `operationId`; if an operation lacks one, generate a deterministic method/path slug. Names must be URL-safe and validated so a provider cannot collide with built-in, MCP, or another OpenAPI tool. Once tools have policies, preserve the provider slug on rename (or explicitly migrate every associated tool and policy).

## Current foundation to reuse

- The in-progress MCP work already persists integrations, discovers per-server tool definitions into `tool_registry`, applies `agent_tool_policies`, dispatches through `subpolar-tool-router`, audits calls, and cleans up run-scoped connections.
- `backend/src/pi/extension.ts` provides the `subpolar-mcp` search/load/run gateway and its per-run context; `backend/src/routes/subpolar-cli.ts` owns its internal gateway endpoints.
- `IntegrationsSettings.tsx`, `IntegrationConfigSchema`, and the settings routes already support integration CRUD and write-only MCP secret fields. `AgentDialog.tsx` already groups discovered registry tools by adapter.

OpenAPI should use those same registry, policy, approval, audit, settings, and agent-discovery paths. It should not create one Pi tool for each OpenAPI operation or bypass the router.

## Design decisions

### Supported document and operation model

- Accept JSON only for this milestone; parse and validate OpenAPI 3.0.x and 3.1.x documents. Reject Swagger 2.0, YAML, external `$ref`s, malformed server URLs, duplicate derived subtool IDs, and documents above a defined size limit.
- Resolve only local JSON Pointer `$ref`s. Resolve path-level and operation-level parameters, request bodies, `servers` (document, path, operation precedence), and `security` (operation overrides document).
- Discover every HTTP operation with a supported method. Store the method, resolved path template, base URL/server selection, operation ID, display name, description, request input schema, response metadata, declared security alternatives, and source-document version/fingerprint in `tool_registry.metadata`.
- Convert OpenAPI parameters and request bodies into one object input schema. Use `path`, `query`, `header`, `cookie`, and `body` namespaces to avoid collisions; required properties remain required. Support JSON request bodies initially. Mark unsupported multipart/form-urlencoded/binary bodies as unavailable with an actionable discovery error rather than silently generating an invalid tool.
- Derive risk conservatively from HTTP method and operation wording: GET/HEAD/OPTIONS are read; POST/PUT/PATCH are external and require approval by default; DELETE is delete and requires approval. Unknown methods are external.

### Authentication and secret handling

- Infer the available auth options from `components.securitySchemes` and the operation's effective `security` requirement. Surface the inferred scheme name/type and whether the operation is public in the discovered-tools list.
- Settings must provide explicit overrides independent of the document: `auth type` (`none`, `apiKey`, `http bearer`, `http basic`, `custom headers`) plus the corresponding write-only `auth` values. For API keys, capture name and placement (header/query/cookie); for Basic, username and password; for Bearer, token; custom headers use the existing key/value control.
- Selecting “Use specification default” applies the operation's declared security scheme; selecting an auth type/values overrides it for the entire provider. A per-operation auth override is not part of this milestone; operations that declare different auth schemes use the configured matching credential or return a clear missing-credential error.
- Extract the encryption/read-redaction helpers from `services/mcp.ts` into a shared integration-secret service, then add an `openapi_secrets` collection (or a type-keyed replacement for `mcp_secrets`) with a unique integration ID/type index. Never return secret values after save; return field names and `hasAuth`/`hasHeaders` only. Delete secrets with their integration and redact them from errors, audit data, SSE events, and logs.

### Execution and agent exposure

- Add `services/openapi.ts` with pure document parsing/discovery plus an HTTP executor. It loads the enabled integration and secret configuration, expands only declared path parameters, serializes query/header/cookie values according to the supported OpenAPI styles, applies effective auth, uses the selected server URL, sends the JSON body, enforces the configured timeout, and returns bounded parsed JSON/text responses.
- Defend the executor against SSRF: validate configured/declared server URLs, reject credential-bearing URLs, private/loopback/link-local addresses unless an explicit trusted-local development policy exists, prohibit redirects to unapproved hosts, and cap response size/time.
- Register `subpolar-openapi` in the Pi extension with the same `search`, `load`, and `run` actions as MCP. Search only lists permitted `openapi.*` tools; load returns the exact stored schema; run requires a matching `serverId`/provider and tool ID and calls `ToolGateway.call` so policy, input validation, approval, and auditing remain authoritative.
- Add parallel internal endpoints under `/api/subpolar-cli/openapi/search`, `/load`, and `/run`, reusing generic request schemas where practical. Keep MCP behavior unchanged; shared helper functions are preferred only where they remove real duplication.
- Update `subpolar-tool-router.ts` to dispatch `adapter: 'openapi'` to the new executor. The existing router continues to create approvals and tool-call audit records before/after execution. Newly discovered OpenAPI tools are default-deny until an agent policy grants allow or approval.

## Implementation phases

### 1. Contracts, integration storage, and migrations

- Extend `IntegrationTypeSchema`, `Integration` helpers, settings schemas/types, and frontend type exports with `openapi`.
- Define a redacted OpenAPI integration config: provider slug, document JSON/fingerprint, optional selected server URL, timeout, inferred/overridden auth metadata, and non-secret custom-header names. Define separate secret payload types.
- Add the secret collection/migration and its cleanup behavior. Generalize the MCP encryption helper without changing existing MCP data or API responses.
- Update `db/integrations.ts`, `db/subpolar-schema.ts`, and PocketBase migrations to list/query OpenAPI integrations. Do not add static tool seeds.

### 2. Parser and discovery service

- Implement local-reference resolution, OpenAPI version/document validation, operation enumeration, deterministic subtool ID generation, schema conversion, effective security calculation, risk classification, and tool metadata creation in `backend/src/services/openapi.ts` (with smaller parser/executor modules if that keeps responsibilities clear).
- Persist discovered definitions with `namespace: 'openapi'`, `adapter: 'openapi'`, `target: integration.id`, and the stable `openapi.<providerSlug>.<subtool>` ID. Disable stale registry records when the document is replaced or an operation disappears, matching MCP rediscovery behavior.
- Record tool count, document fingerprint, discovery time, and sanitized discovery errors on integration metadata. Expose a refresh/discover operation that is idempotent.

### 3. Settings API and discovery preview

- Extend `backend/src/routes/settings.ts` validation and integration serializers for OpenAPI create/update/delete, ensuring the full document and secrets are never included in list responses.
- Add an authenticated draft-validation/discovery endpoint that accepts the current JSON/auth override fields, validates and enumerates operations without persisting secrets. On save, persist the integration/secrets, discover tools, and return redacted status/tool count; add refresh and a list-tools endpoint for an existing provider.
- Ensure updates replace cleared secret values deliberately (rather than retaining stale credentials) and delete all provider tools/secrets when an integration is deleted.

### 4. Native Pi gateway and tool routing

- Extend `backend/src/pi/extension.ts`, `pi/tool-policy.ts`, and `routes/subpolar-cli.ts` with the `subpolar-openapi` gateway and matching search/load/run endpoints. Give it the same per-run context and authorization treatment as `subpolar-mcp`; per-subtool authorization stays in `ToolGateway`.
- Dispatch OpenAPI tools from `subpolar-tool-router.ts`, preserve agent policy precedence and approval behavior, and include provider/subtool metadata in the existing audit result summary without logging auth values.
- Initialize/refresh enabled OpenAPI provider tools during app startup using the same missing-only discovery approach as MCP, but never make a remote HTTP request merely to invoke an operation during startup.

### 5. Settings and agent UI

- Add OpenAPI to the Integration type selector and cards in `frontend/src/components/settings/IntegrationsSettings.tsx`. The form includes provider name/slug, an OpenAPI JSON textarea/file-less paste input, optional server-URL override, timeout, auth-type/auth controls, custom headers, and a “Discover tools” action.
- After successful draft discovery or save, render a compact discovered-subtools list with the stable tool ID, HTTP method/path, description, inferred/overridden auth, risk/approval state, and parse errors. Editing an existing provider fetches its redacted discovered records; it never repopulates secret values.
- Update the integration card to show document validity, discovered-tool count, last discovery error, refresh, enable/disable, and delete actions.
- Update `AgentDialog.tsx` to group registry choices as “OpenAPI provider tools” beside MCP tools, label each entry with its provider display name, and continue saving normal per-tool `subpolar` policies. No separate agent exposure UI is needed.

### 6. Verification

- Unit-test parser/ref resolution, version validation, ID collisions/encoding, schema conversion, effective security selection, auth override serialization, stale-tool disabling, and risk defaults.
- Test the executor with mocked fetch for path/query/header/body serialization, API-key locations, bearer/basic auth, timeouts, bounded responses, HTTP failures, redirects, and SSRF rejection.
- Extend router/gateway tests to prove only policy-permitted `openapi.*` tools are searchable/loadable/runnable; deny/approval/wildcard/run overrides and audits must match MCP behavior.
- Add settings-route tests for redaction, draft discovery, save/refresh/delete, invalid JSON/unsupported body formats, cleared secrets, and tool-count/error status. Add focused frontend tests for auth override controls and the discovered-tools list.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Acceptance criteria

- A user can add an OpenAPI JSON document in Settings, choose or override auth type/auth values, discover its operations, and see the discovered subtools without secret disclosure.
- Every supported operation is registered with an ID exactly shaped as `openapi.providerName.subtool`, appears in the agent tool-policy picker, and is default-denied until permitted.
- An agent accesses a permitted OpenAPI operation only through `subpolar-openapi` search/load/run; execution passes the shared policy, approval, validation, audit, and run-context path used by MCP.
- Replacing a document updates schemas and disables removed operations; disabling/deleting the provider prevents calls and releases/removes its stored secret data.
- Auth inference and explicit overrides work for API keys, Bearer, Basic, and custom headers; missing or incompatible credentials fail clearly and never leak secret values.
- MCP support and existing integrations continue to behave unchanged.

## Explicitly out of scope for this milestone

- YAML and remote OpenAPI-document URLs.
- OAuth authorization-code/device flows, arbitrary external `$ref`s, callbacks/webhooks, multipart uploads, and per-operation credential overrides.
- Automatically permitting all operations from a provider or exposing one Pi-native tool per OpenAPI operation.
