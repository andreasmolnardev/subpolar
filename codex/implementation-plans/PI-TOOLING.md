# Pi Tooling Integration Plan

## Recommendation

Use Pi RPC as the execution boundary and load a Subpolar-owned Pi extension for tool authorization.

Start Pi with:

```bash
pi --mode rpc --no-session --no-approve -e backend/src/pi/extension.ts
```

`--no-session` keeps durable session state in PocketBase. `--no-approve` prevents Pi from trusting project-local `.pi` resources. The explicit `-e` extension is the only trusted Pi customization layer for Subpolar-run processes.

## Goals

- Keep PocketBase authoritative for sessions, messages, runs, runtime events, approvals, policies, and audit records.
- Use Pi only as an ephemeral LLM and coding-tool runtime for a single Subpolar run.
- Ensure every Pi tool call is sent to Subpolar before execution.
- Allow Subpolar to allow, deny, or require approval for each tool call.
- Avoid OpenCode-compatible HTTP assumptions; Pi exposes SDK/RPC/CLI integration, not OpenCode HTTP routes.

## Non-Goals

- Do not persist Pi sessions.
- Do not use Pi project-local trust or project-local extensions.
- Do not initially replace Pi's built-in tool execution with Subpolar implementations.
- Do not model Subpolar agents as Pi-native agents; Pi does not provide native subagents.

## Architecture

### Runtime Boundary

`PiRuntimeAdapter` owns one Pi RPC subprocess per Subpolar run.

Flow:

1. Subpolar receives a user message and creates a run in PocketBase.
2. `PiRuntimeAdapter.run()` spawns `pi --mode rpc --no-session --no-approve -e backend/src/pi/extension.ts`.
3. The adapter passes run metadata through environment variables.
4. The adapter sends the prompt/context over Pi RPC.
5. Pi streams JSONL events over stdout.
6. The adapter maps Pi events to Subpolar runtime events and persists final messages to PocketBase.
7. On completion, Subpolar marks the run completed or failed.

### Trust Boundary

Pi is not allowed to decide project trust.

The Subpolar extension should register a `project_trust` handler that always returns an explicit no decision:

```ts
return { trusted: 'no' }
```

This is defense-in-depth in addition to `--no-approve`.

### Tool Authorization Boundary

Pi's extension API exposes `tool_call`, which fires after `tool_execution_start` and before the tool executes. The handler can block execution by returning `{ block: true, reason }`.

The Subpolar extension must register one `tool_call` handler and call a Subpolar internal endpoint for every Pi tool call.

Allowed decision:

```ts
return undefined
```

Denied or approval-required decision:

```ts
return { block: true, reason: message }
```

## Files To Add

### `backend/src/pi/extension.ts`

Pi extension loaded with `-e`.

Responsibilities:

- Read environment configuration:
  - `SUBPOLAR_BASE_URL`
  - `SUBPOLAR_INTERNAL_TOKEN`
  - `SUBPOLAR_AGENT_ID`
  - `SUBPOLAR_SESSION_ID`
  - `SUBPOLAR_RUN_ID`
- Register `project_trust` and deny project trust.
- Register `tool_call` and call Subpolar before execution.
- Convert network/validation failures into blocked tool calls.
- Keep the implementation dependency-light so Pi can load it directly with `jiti`.

### `backend/src/pi/routes.ts`

Internal Pi integration routes.

Initial route:

```http
POST /api/pi/tools/authorize
```

Protected by `createInternalTokenMiddleware(db)`.

Input:

```json
{
  "agentId": "...",
  "sessionId": "...",
  "runId": "...",
  "toolCallId": "...",
  "toolName": "bash",
  "input": {},
  "cwd": "..."
}
```

Allow response:

```json
{ "ok": true, "decision": "allow" }
```

Deny response:

```json
{ "ok": false, "decision": "deny", "message": "..." }
```

Approval response:

```json
{ "ok": false, "decision": "approval", "approvalId": "...", "message": "..." }
```

### `backend/src/pi/tool-policy.ts`

Small policy adapter for Pi built-in tools.

Responsibilities:

- Map Pi tool names to Subpolar tool ids.
- Reuse existing policy/audit behavior where possible.
- Avoid executing the tool; this route authorizes Pi's own execution path.

Suggested tool id mapping:

| Pi Tool | Subpolar Tool ID |
| --- | --- |
| `read` | `pi.read` |
| `write` | `pi.write` |
| `edit` | `pi.edit` |
| `bash` | `pi.bash` |
| `grep` | `pi.grep` |
| `find` | `pi.find` |
| `ls` | `pi.ls` |

## Files To Change

### `backend/src/runtime/pi-runtime.ts`

Replace the current stub with a real RPC subprocess adapter.

Responsibilities:

- Spawn Pi in RPC mode.
- Pass Subpolar metadata via env.
- Send prompts over RPC.
- Parse strict LF-delimited JSONL from stdout.
- Map Pi events to Subpolar `RuntimeEvent`s.
- Track child processes by `runId` for cancellation.
- Send RPC `abort` on cancel, then terminate if needed.

### `backend/src/index.ts`

Register the Pi routes:

```ts
protectedApi.route('/pi', createPiRoutes(db!))
```

### Tool Seeding

Seed Pi built-in tool records in `tool_registry` so normal Subpolar agent policies can control them.

Each tool should have:

- `adapter: 'internal'`
- `target: 'pi'`
- `operation`: matching Pi tool name
- `risk`: appropriate risk level
- `requires_approval`: default based on risk

Suggested defaults:

| Tool ID | Risk | Requires Approval |
| --- | --- | --- |
| `pi.read` | `read` | `false` |
| `pi.grep` | `read` | `false` |
| `pi.find` | `read` | `false` |
| `pi.ls` | `read` | `false` |
| `pi.write` | `write` | `true` |
| `pi.edit` | `write` | `true` |
| `pi.bash` | `external` | `true` |

## Authorization Semantics

The first implementation should authorize but not execute Pi built-in tools.

Behavior:

- Subpolar allow: Pi executes its built-in tool locally.
- Subpolar deny: Pi receives a blocked tool result.
- Subpolar approval required: Pi receives a blocked tool result explaining that approval is required.
- Subpolar unavailable: fail closed and block the tool call.

This satisfies the trust policy that every tool call goes through Subpolar and is granted or denied by Subpolar.

## Future Strict Proxy Mode

If Subpolar must execute every tool itself, change the Pi launch mode to disable built-ins:

```bash
pi --mode rpc --no-session --no-approve --no-builtin-tools -e backend/src/pi/extension.ts
```

Then the extension should register replacement tools for `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. Each replacement tool would call Subpolar, and Subpolar would perform the actual execution.

This is stricter but requires Subpolar to implement local filesystem/process tools and result formatting equivalent to Pi's built-ins.

## Event Mapping

Suggested Pi RPC to Subpolar runtime event mapping:

| Pi Event | Subpolar Event |
| --- | --- |
| `message_update` text delta | `message.delta` |
| `message_end` assistant | `message.completed` plus persisted assistant message |
| `tool_execution_start` | `tool.requested` |
| `tool_execution_end` success | `tool.completed` |
| `tool_execution_end` error | `tool.failed` |
| `agent_end` | `run.completed` |
| RPC/process error | `run.failed` |

## Cancellation

`PiRuntimeAdapter.cancel(runId)` should:

1. Send RPC command:

```json
{ "type": "abort" }
```

2. Wait briefly for Pi to become idle or exit.
3. Terminate the process if it does not exit.
4. Remove the process from the adapter's run map.

## Security Notes

- Fail closed on missing environment variables.
- Fail closed on failed authorization requests.
- Do not print internal tokens.
- Use the existing internal-token middleware for backend authorization routes.
- Prefer `--no-approve` for all Subpolar-spawned Pi processes.
- Load only the Subpolar extension via `-e`; do not enable project-local Pi resources initially.

## Verification

Manual checks:

- A denied `pi.bash` policy blocks a Pi bash tool call.
- An allowed `pi.read` policy lets Pi read a file.
- Approval-required `pi.edit` creates a pending approval and blocks execution.
- Missing `SUBPOLAR_INTERNAL_TOKEN` blocks every tool call.
- Cancelling a run aborts the Pi RPC process.
- No Pi session files are written when using `--no-session`.

Automated checks:

- Unit test Pi tool-name mapping.
- Unit test authorization response handling in the extension helper logic where practical.
- Route test `POST /api/pi/tools/authorize` for allow, deny, approval, unknown tool, and unknown agent cases.
- Runtime adapter test with a fake Pi RPC process if feasible.
