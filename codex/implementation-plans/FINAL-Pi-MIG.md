# Final Pi Migration Plan

## Goal

Remove OpenCode as a runtime concept. Keep temporary compatibility API shapes only where the frontend or persisted settings still require them, and name working internal compatibility pieces `PiInternal` until the public API can be changed safely.

## Already Pi-backed: Rename to PiInternal

- `backend/src/runtime/pi/*`: already uses the Pi SDK/runtime path. Keep as Pi.
- `/api/provider`: compatibility route backed by Pi `ModelRegistry`; rename internal service names from OpenCode provider/model to `PiInternalProvider` and `PiInternalModel` while preserving response shape until the frontend selector is migrated.
- `PiNativeClient`: already returns Pi replacement responses for old compatibility calls. Rename aliases and imports to `PiInternalClient`.
- Session and run execution routes: native Subpolar session/run APIs execute through Pi. Rename any OpenCode-shaped helper names to `PiInternal` if they only adapt old payloads.
- Supervisor/status UI paths that only monitor internal compatibility health should be renamed from OpenCode lifecycle wording to `PiInternal` lifecycle wording.

## Migrate to Pi

- Config management currently stores OpenCode-shaped config names, file paths, and validation language. Replace with Pi model/provider/tool settings and remove OpenCode config reload/recovery flows.
- Skills currently fetch through OpenCode compatibility client paths. Migrate to Pi skill discovery/loading primitives or Subpolar-owned skill storage.
- Automations still build OpenCode-style session/tool requests in several places. Convert automation execution to native session/run APIs with Pi model IDs and Subpolar tool policies.
- MCP OAuth proxy still forwards OpenCode-style requests. Replace with Pi MCP support or Subpolar-owned MCP auth endpoints.
- Plugin install/cache code in `opencode-single-server.ts` is legacy OpenCode process management. Delete once all config/plugin settings move to Pi/Subpolar equivalents.
- Frontend hooks and query keys named `useOpenCode`, `opencode-configs`, and OpenCode settings should be renamed to Pi/Subpolar terms after backend compatibility routes are replaced.

## Delete After Migration

- OpenCode server spawning and version checks.
- OpenCode config recovery and reload concepts.
- OpenCode binary/plugin cache initialization.
- Tests targeting removed OpenCode client/config-recovery modules.
- Documentation and scripts that instruct users to install or run OpenCode.

## Order Of Work

1. Rename Pi-backed internal types and services to `PiInternal` without changing external API responses.
2. Replace config/settings storage with Pi-native provider, model, skill, MCP, and tool-policy settings.
3. Move automations and skill fetching to native Subpolar session/run APIs.
4. Remove OpenCode process manager and all spawn/version/plugin code.
5. Rename frontend hooks/routes/query keys once backend compatibility responses are no longer required.
6. Delete stale OpenCode tests and documentation references or rewrite them against Pi behavior.
