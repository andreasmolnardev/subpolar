<p align="center">
    <img src="frontend/public/subpolar-logo-text-dark.png" alt="Subpolar" width="600" style="border: none" />
</p>

<p align="center">
    A UI for agents focused on improving your personal life
</p>


> [!IMPORTANT]  
> This is vibecoded. Proceed with caution.

## Quick Start

```bash
git clone https://github.com/chriswritescode-dev/opencode-manager.git
cd opencode-manager
cp .env.example .env
echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env
docker-compose up -d
# Open http://localhost:5003
```

On first launch, you'll be prompted to create an admin account. That's it!

For local development setup, see the [Development Guide](https://chriswritescode-dev.github.io/opencode-manager/development/setup/).


## Features

- **Repositories & Git** — Multi-repo management, local discovery, SSH auth, worktrees, unified diffs, branch and commit management
- **Chat & Sessions** — Real-time SSE streaming, slash commands, `@file` mentions, Plan/Build modes, Mermaid diagram rendering
- **Files** — Directory browser with tree view, syntax highlighting, create/rename/delete, ZIP download
- **Agents** — Create and manage AI agents with custom icons, descriptions, skill access, and allowed commands directly from the sidebar
- **Automations** — Recurring repo jobs with reusable prompts, run history, linked sessions, markdown-rendered output
-- **General Chat** using global agents
- **Projects** - Sessions tailored to workspaces on the server
- **MCP Servers** — Add, configure, authenticate, and manage local or remote MCP servers with OAuth support
- **AI Configuration** — Model/provider setup, API keys, OAuth for Anthropic and GitHub Copilot, custom agent definitions
- **Skills** — Extend agent capabilities with shareable, scoped skill definitions
- **Notifications** — Push notifications for session events, questions, errors, and completions
- **Audio** — Text-to-speech and speech-to-text (browser native and OpenAI-compatible APIs)
- **Mobile & PWA** — Responsive mobile-first UI, installable on any device, iOS-optimized

## Architecture

Subpolar is a pnpm workspace with three TypeScript packages:

- `backend/` — Bun + Hono API server with Better Auth, SQLite migrations, OpenCode process management, SSE, automations, and push notifications.
- `frontend/` — React + Vite SPA using React Router, TanStack Query, Radix UI/Tailwind, service worker support, and mobile-first navigation.
- `shared/` — shared Zod schemas, config helpers, types, and utilities consumed by both backend and frontend.

A MkDocs Material site (`docs/`) provides guides, feature docs, configuration, and troubleshooting.

## Development

This repo uses pnpm workspaces for `shared`, `backend`, and `frontend`.

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
```

See the [Development Guide](https://chriswritescode-dev.github.io/opencode-manager/development/setup/) for local setup, scripts, database notes, and testing.

## Configuration

```bash
# Required for production
AUTH_SECRET=your-secure-random-secret  # Generate with: openssl rand -base64 32

# Pre-configured admin (optional)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password

# For LAN/remote access
AUTH_TRUSTED_ORIGINS=http://localhost:5003,https://yourl33tdomain.com
AUTH_SECURE_COOKIES=false  # Set to true when using HTTPS
```

For OAuth, Passkeys, Push Notifications (VAPID), and advanced configuration, see the [Configuration Guide](https://chriswritescode-dev.github.io/opencode-manager/configuration/environment/).

## Documentation

- [Getting Started](https://chriswritescode-dev.github.io/opencode-manager/getting-started/installation/) — Installation and first-run setup
- [Features](https://chriswritescode-dev.github.io/opencode-manager/features/overview/) — Deep dive on all features
- [Configuration](https://chriswritescode-dev.github.io/opencode-manager/configuration/environment/) — Environment variables and advanced setup
- [Troubleshooting](https://chriswritescode-dev.github.io/opencode-manager/troubleshooting/) — Common issues and solutions
- [Development](https://chriswritescode-dev.github.io/opencode-manager/development/setup/) — Contributing and local development

## License

MIT
