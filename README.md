# Subpolar

Subpolar is a workspace for running AI agents with clear project boundaries, configurable capabilities, and persistent chat sessions. It combines a chat interface with pi-coding-agent by extending its capabilites.

## What It Does

- Organizes work into projects backed by local workspace folders.
- Provides a `General chat` project for work not tied to a folder.
- Lets users select an agent, model, project, and permissions before starting a session.
- Persists conversations, tool activity, and session state.
- Supports custom agents, reusable skills, prompt commands, provider configuration, and optional integrations.
- Streams agent responses and tool execution to the web UI in real time.

## Behind The Scenes

1. Subpolar resolves the selected project, agent, model, skills, and tool policies for each prompt.
2. It creates a session run and starts a Pi SDK `AgentSession` in the project's workspace.
3. Pi receives the assembled prompt and model configuration, then emits messages and tool requests during execution.
4. Skills begin as compact descriptions and load their full instructions only when the agent needs them. Each protected tool request is checked against Subpolar's policy engine.
5. Subpolar converts Pi runtime events into its session stream, delivers them to the UI, and persists messages, tool activity, questions, completion, and failures.

## Concepts
- Projects:
- Skills:
- Tools:

## Permissions And Skills

Agents are configured independently from projects. Their configuration can include:

- System prompt and description
- Allowed built-in tools such as file editing, web fetches, and shell commands
- Subpolar, MCP, OpenAPI, and command-line tools
- `allow`, `ask`, or `deny` policy for each capability
- Skills: reusable instruction files that agents discover and load on demand

Tool authorization remains in Subpolar. Pi asks Subpolar's authorization endpoint before executing a protected tool, allowing configured policy to approve, deny, or request user confirmation.

## Architecture

User
  ↓
Frontend chat UI
  ↓ HTTP/SSE
Subpolar API
  ├─ authenticates request
  ├─ resolves session/project/working directory
  ├─ loads agent configuration
  ├─ resolves model/provider
  ├─ loads skills
  ├─ creates run
  └─ streams events and persists results
  ↓
RuntimeAdapter
  ↓
PiRuntimeAdapter
  ├─ creates Pi AgentSession
  ├─ injects system prompt and history
  ├─ loads project and generated skills
  ├─ installs Subpolar Pi extension
  └─ maps Pi events to runtime events
  ↓
Pi Coding Agent SDK
  ├─ reasons about task
  ├─ selects skills/tools
  ├─ calls model provider
  └─ emits messages/tool events
  ↓
Tool authorization boundary
  ├─ checks agent policy
  ├─ allows or denies tool call
  ├─ requests user approval
  └─ executes Subpolar/MCP/native tools
  ↓
Filesystem, shell, Git, MCP, external APIs

Results/events
  ↑
Pi SDK → runtime adapter → DB + SSE aggregator → frontend → User

## Quick Start

Requirements: Bun, pnpm, Git, and Docker for the bundled PocketBase service.

```bash
git clone <repository-url> subpolar
cd subpolar
cp .env.example .env
pnpm install
docker compose up -d pocketbase
pnpm dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:5003`; PocketBase runs on `http://localhost:8090`.

Set a secure `AUTH_SECRET` in `.env` before production use:

```bash
openssl rand -base64 32
```

For a containerized deployment, configure `.env` then run:

```bash
docker compose up -d --build
```

## Development

```bash
pnpm dev              # Start backend and frontend
pnpm dev:backend      # Start backend only
pnpm dev:frontend     # Start frontend only
pnpm build            # Build all packages
pnpm typecheck        # Type-check all packages
pnpm test             # Run test suites
pnpm lint             # Lint all packages
```

`pnpm dev` runs `scripts/setup-dev.sh`, which checks prerequisites, creates the runtime workspace if needed, installs dependencies, and creates `.env` from `.env.example` when missing.

## Configuration

Configuration may come from environment variables, `.env`, or `config.json`, in that precedence order. Key settings include:

- `WORKSPACE_PATH`: root folder for agent project workspaces
- `POCKETBASE_URL`, `POCKETBASE_EMAIL`, `POCKETBASE_PASSWORD`: persistence service connection
- `AUTH_SECRET`, `AUTH_TRUSTED_ORIGINS`, `AUTH_SECURE_COOKIES`: authentication and deployment settings
- `PORT`, `HOST`, `CORS_ORIGIN`: server networking
- `SUBPOLAR_MCP_SECRET_KEY`: required when configuring MCP environment variables or HTTP headers

See `.env.example` for full configuration reference.

## License

MIT
