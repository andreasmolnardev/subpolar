# Subpolar stack MCP server

The project-local `subpolar-stack` MCP server manages only this repository's Docker Compose stacks. It exposes five tools:

- `stack_status` — inspect containers and health.
- `stack_up` — start the full stack or one service, optionally recreating it.
- `stack_restart` — restart the full stack or one service.
- `stack_logs` — retrieve bounded recent logs.
- `build_production_images` — build the production app, PocketBase, or both.

It intentionally does not expose arbitrary shell execution, `docker compose down`, or volume deletion.

Add this project configuration to `.codex/config.toml`:

```toml
[mcp_servers.subpolar-stack]
command = "bun"
args = ["backend/src/mcp/subpolar-stack.ts"]
```

Restart Codex after adding the configuration. The default environment is development; production tools use `docker-compose.yml`.
