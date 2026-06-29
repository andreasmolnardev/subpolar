# Pi Providers Settings Plan

## Summary

Fix the Providers settings tab by making Subpolar’s provider system Pi-native end to end. Provider/model discovery must come from the Pi SDK `ModelRegistry`, include every provider Pi supports, include unconfigured providers so users can add credentials, and support user-added custom providers through Pi-compatible `models.json`.

## Key Changes

- Replace OpenCode provider assumptions with a shared Pi provider helper:
  - Use `AuthStorage.create(getAuthPath())`.
  - Use `ModelRegistry.create(authStorage, getPiModelsPath())`.
  - Use `modelRegistry.getAll()` for all Pi-compatible built-in and custom providers/models.
  - Use `modelRegistry.getProviderAuthStatus(providerId)` and model auth checks for connected state.
- Add `getPiModelsPath()` in shared config, pointing to a Subpolar-managed Pi `models.json` path under the workspace, and use it everywhere `ModelRegistry.create(...)` is called.
- Update `PiRuntimeAdapter` to use the same `AuthStorage` and `ModelRegistry` paths as provider discovery so saved API keys and custom providers work during runs.
- Make `GET /api/provider` return an OpenCode-compatible response backed by Pi SDK data:
  - `all`: every provider/model returned by `ModelRegistry.getAll()`.
  - `connected`: providers with configured Pi auth.
  - `default`: `{}` unless a Pi default source is later wired in.
- Make `GET /api/oauth/auth-methods` Pi-native:
  - Do not forward to OpenCode.
  - Return API-key auth methods for every discovered Pi provider.
  - Return `200` even when no providers are configured.
- Keep OAuth authorize/callback compatibility routes, but return clear `501` responses unless Pi OAuth is explicitly added later.
- Update credential storage to Pi’s schema:
  - Write API keys as `{ "type": "api_key", "key": "..." }`.
  - Migrate legacy `{ type: "apiKey", apiKey }` and `{ type: "api", key }` entries.
- Add custom provider management:
  - Backend endpoints to read, add/update, and delete provider entries in Pi `models.json`.
  - Support Pi’s durable provider shape: `baseUrl`, `api`, optional `apiKey`, `headers`, `authHeader`, `models`, and `modelOverrides`.
  - Minimum custom provider form fields: provider ID, display name, API type, base URL, auth header toggle, and at least one model ID.
  - Frontend Providers settings gets an “Add Custom Provider” action and edit/delete controls for custom providers.
  - Saved custom providers appear through the normal `/api/provider` SDK discovery path after `ModelRegistry.refresh()` or fresh registry creation.

## Public Interfaces

- `GET /api/provider` remains the frontend’s source for provider/model options.
- `GET /api/oauth/auth-methods` returns `{ providers: Record<string, [{ type: "api", label: "API Key" }]> }`.
- Add custom provider endpoints under `/api/providers/custom`:
  - `GET /custom` lists Subpolar-managed custom provider configs from Pi `models.json`.
  - `POST /custom` creates or updates one provider config.
  - `DELETE /custom/:id` removes one custom provider config.
- `auth.json` uses Pi-compatible API key entries.
- `models.json` uses Pi-compatible provider entries so Pi SDK sessions and discovery see the same custom providers.

## Test Plan

- Backend:
  - Unit test Pi provider mapping from `ModelRegistry.getAll()` includes unconfigured built-ins and custom providers.
  - Unit test connected state uses Pi auth status, not provider existence.
  - Unit test `/api/oauth/auth-methods` returns API-key methods without OpenCode forwarding.
  - Unit test credential migration and writes use `api_key`.
  - Unit test custom provider CRUD reads/writes valid Pi `models.json` and rejects invalid provider/model shapes.
- Frontend:
  - Test Provider Settings renders Pi providers without OAuth errors.
  - Test adding a custom provider calls the new endpoint and refreshes provider caches.
  - Test connected state updates after saving an API key.
- Verification:
  - `pnpm --filter backend exec tsc --noEmit`
  - `pnpm --filter frontend exec tsc --noEmit`
  - `pnpm lint`

## Assumptions

- Custom providers should be stored in Pi `models.json`, not generated as Pi extensions.
- Pi OAuth is out of scope for this pass; API-key and provider-config compatibility are required.
- The existing frontend provider response shape should remain stable to avoid broad UI churn.
