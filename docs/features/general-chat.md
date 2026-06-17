# General Chat

General Chat gives Subpolar a dedicated AI workspace — an isolated directory (`general-chat/`) where a built-in general chat agent can manage automationd jobs, send push notifications, and read or update settings via a secure internal API.

## What Is General Chat?

The general chat workspace is a special repository-like directory managed and maintained by Subpolar. When initialized it contains:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Workspace description the agent reads on every session start |
| `opencode.json` | OpenCode configuration scoped to the general chat agent |
| `.opencode/internal-token` | Bearer token used to authenticate against the internal API |
| `.opencode/agents/auto.md` | Agent definition with system prompt and permissions |
| `.opencode/skills/` | Auto-generated skills teaching the agent to use the internal API |

## Skills Provided

Four skills are provisioned automatically when general chat is initialized:

| Skill | What it teaches |
|-------|----------------|
| `automation-management` | Create, list, update, delete, and run automationd jobs |
| `notifications` | Send push notifications to registered user devices |
| `manager-settings` | Read and patch user preferences, and reload the general chat workspace |
| `repo-management` | List all managed repositories |

See [Assistant Internal API](assistant-internal-api.md) for the full API reference these skills expose.

## General Chat Persona

The general chat agent's system prompt, behavior, and durable preferences live solely in `.opencode/agents/auto.md`. This file is the single source of truth for the general chat agent's personality and self-editing rules. The `opencode.json` configuration no longer duplicates the agent persona — it only stores agent mode and workspace-level settings.

When the general chat agent self-edits its agent definition (e.g., to refine behavior or add durable preferences), it uses the `manager-settings` skill to call the `POST /assistant/reload` endpoint. This disposes the current OpenCode workspace instance so the changes take effect on the next message. The reload endpoint is rate-limited to 5 requests per minute; the general chat agent always asks the user before reloading.

## Getting Started

1. Click **General Chat** in the sidebar or mobile tab bar
2. On first visit, Subpolar initializes the workspace and creates a new session
3. A welcome prompt is automatically sent to orient the agent
4. Subsequent visits resume the most recent session

No manual setup is required. The workspace directory and all managed files are created automatically.

## Session Views

The general chat agent page works in two modes:

| Mode | URL | What you see |
|------|-----|-------------|
| Redirect | `/assistant` | Instantly redirects to the last session or creates one |
| Session list | `/assistant?view=sessions` | Full session history with sidebar panels |

The session list exposes the same management panels as regular repos — file browser, MCP servers, skills, source control, and permissions reset.

## Workspace Initialization

The workspace is initialized idempotently. Managed files are only rewritten when Subpolar has updated their content. User customizations to managed files are preserved.

### Warnings

If a managed file was modified after initialization, the next session will receive an inline prompt explaining which files were preserved and what the expected content is. This surfaces configuration drift without silently overwriting your changes.

### Re-initializing

To re-apply all managed files to their latest defaults:

1. Navigate to the session list (`?view=sessions`)
2. Open the **Permissions** panel
3. Use the reset action to re-initialize the workspace
