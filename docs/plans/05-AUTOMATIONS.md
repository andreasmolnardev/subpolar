# Rebuild Project Automations

## Goal

Replace the current job-centric Automations experience with a project-scoped automation builder. Selecting **Automations** changes the selected project's sidebar content from sessions to automations; selecting an automation opens a block editor in the main content area.

The requested workspace presents a selected project's automations in the left navigation and an editor with a metadata header, triggers, and ordered steps. Reuse Subpolar's existing navigation, typography, controls, responsive behavior, and dark/light themes rather than adopting a separate visual language.

## Current State

- `frontend/src/pages/Automations.tsx` is a standalone page with Jobs, Detail, and Runs views; creation and editing happen in `AutomationJobDialog`.
- One `automation_jobs` record represents one interval or cron trigger and one agent prompt. `AutomationRunner` registers one timer per job and `AutomationService.runJob` starts one Pi session and submits that prompt.
- `automation_runs` keeps a useful run history, linked to its Pi session.
- `DesktopSidebar` currently treats Automations as a global destination (`/automations`), while project navigation currently shows session entries.

This model cannot express the requested multiple triggers, trigger conditions, webhooks, or ordered action blocks. It should be replaced rather than extended with parallel legacy fields.

## Product Behavior

### Navigation and selection

- Keep the project picker as the source of the selected project.
- On desktop, the Automations primary nav item is a project-scoped mode. It displays a project automation list in the sidebar in place of that project's sessions. The adjacent `+` starts a new automation for the selected project.
- Automation rows show the configured icon, name, description, enabled state, and concise next-trigger status. Clicking a row navigates to its editor; the selected row remains visibly active.
- Use stable URLs: `/projects/:id/automations` for the list/empty state and `/projects/:id/automations/:automationId` for an editor. Preserve `returnTo` only for entry points that need it.
- Keep a compact mobile experience: the list is its own route/sheet and the editor is a full page. Do not retain the current Jobs/Detail/Runs mobile tab bar.
- Retire the global all-project Automations workspace from the primary navigation. If cross-project operations remain useful, expose them later as a filterable management view, not as part of this rebuild.

### Editor

The editor has three regions, arranged as a single readable column on narrow screens and a roomy, centered workspace on desktop:

1. **Header**: automation icon, name, description, enabled toggle/status, and an overflow menu containing Rename, Edit description, Past runs, Duplicate (optional), and Delete. Rename/description use small focused dialogs or inline editing, not the old four-tab job dialog.
2. **Triggers**: a list of independently enabled trigger blocks. An Add trigger menu offers Schedule, Cron, and Webhook. Each trigger can have zero or more condition blocks that must all pass before a run starts.
3. **Automation**: an ordered block list with an Add step menu. Blocks are clearly connected by spacing and order labels. Each block has edit, duplicate, move, and delete actions.

Initial supported action blocks are:

- **Agent**: agent, model, prompt, selected skills/notes, and optional output name.
- **Notification**: destination/channel and a message template that can reference prior block outputs.
- **Wait for user input**: prompt, typed input (`text`, `boolean`, or `choice`), and an output name.

The block discriminator and renderer registry must be extensible, so later action types do not require new automation-wide columns or a new editor layout. The existing prompt templates can remain an Agent-block convenience; they are no longer a top-level editor tab.

### Triggers and conditions

- **Schedule**: preset cadence (hourly/daily/weekdays/weekly/monthly) with timezone, implemented as validated cron under the hood.
- **Cron**: advanced five-field cron expression plus timezone, displayed with a human-readable next-run preview.
- **Webhook**: generated opaque endpoint token, optional enabled state, and a request payload input.
- Conditions are explicit typed predicates, initially `payload field`, `equals`, `not equals`, `exists`, and `matches regex`. Schedule/Cron conditions evaluate against an empty system context; webhook conditions receive the parsed JSON payload plus request metadata.
- Reject invalid cron, invalid IANA timezones, malformed condition definitions, duplicate output names, invalid template references, and webhook payloads that are not JSON when JSON conditions are used.
- Manual Run uses the same execution path, with no trigger conditions. The editor shows a confirmation/state rather than silently starting a duplicate run.

## Data and API Design

Create new normalized PocketBase collections through a migration; do not overload `automation_jobs`:

| Collection | Required fields | Notes |
| --- | --- | --- |
| `automations` | `project_id`, `name`, `description`, `icon`, `enabled`, `created_at`, `updated_at` | The project-owned root entity. |
| `automation_triggers` | `automation_id`, `type`, `enabled`, `position`, `config`, `created_at`, `updated_at` | `config` is a discriminated JSON object for schedule, cron, or webhook. Store webhook token hashed; never return its hash. |
| `automation_conditions` | `trigger_id`, `position`, `type`, `config` | Conditions use typed JSON configuration. |
| `automation_steps` | `automation_id`, `position`, `type`, `config` | Action blocks use discriminated JSON configuration. |
| `automation_runs` | `automation_id`, `project_id`, `trigger_id`, `trigger_type`, `trigger_payload`, `status`, timestamps, `session_id`, `response_text`, `error_text` | New run history; preserve only redacted payload metadata where applicable. |
| `automation_run_steps` | `run_id`, `step_id`, `position`, `status`, timestamps, `input`, `output`, `error_text` | Enables past-run detail and output references. |
| `automation_waits` | `run_id`, `step_id`, `token_hash`, `status`, `input_schema`, `answer`, timestamps | Persists paused runs safely across backend restarts. |

Add indexes for project/list ordering, enabled schedules, webhook lookup, run history, and run-step lookup. Use `project_id` terminology in all new types and endpoints; compatibility adapters may translate the existing `repoId` route parameter only while the old feature is being removed.

Define the shared Zod discriminated unions in `shared/src/schemas/automation.ts` and export their inferred types. Key unions are `AutomationTrigger`, `AutomationCondition`, `AutomationStep`, `AutomationRunStatus`, and `AutomationStepRunStatus`. Validate all nested configs at the route boundary and again before runtime execution.

Use resource-oriented project APIs:

```text
GET/POST    /api/projects/:id/automations
GET/PATCH/DELETE /api/projects/:id/automations/:automationId
POST        /api/projects/:id/automations/:automationId/run
GET         /api/projects/:id/automations/:automationId/runs
GET         /api/projects/:id/automations/:automationId/runs/:runId
POST        /api/automation-webhooks/:token
POST        /api/automation-waits/:token/answer
```

The create/update request writes the root, triggers, conditions, and steps as one validated definition. Use an explicit `definitionVersion` or optimistic `updatedAt` precondition to reject concurrent editor saves; never partially save an invalid definition. The read response returns the complete ordered definition in one request.

## Runtime Design

1. Split orchestration from persistence: introduce an `AutomationDefinitionService`, `AutomationScheduler`, `WebhookAutomationService`, and `AutomationExecutionService`; keep PocketBase mapping functions in `backend/src/db/automations.ts` or focused new DB modules.
2. At startup, load enabled schedule/cron triggers and register one `Croner` instance per trigger. On definition changes, unregister only that automation's prior trigger registrations and register the new set. Recompute and persist each trigger's next-run status for the UI.
3. A schedule, cron, webhook, or manual invocation creates one run with its trigger context. Acquire a per-automation execution lock before it starts. The initial concurrency policy is **skip and record a skipped run when the automation is already active**; make this visible in run history.
4. Evaluate all conditions before creating a Pi session. A condition failure records a skipped run with a reason and does not run steps.
5. Execute steps in order with a run-scoped context. Agent output is stored under its output name. Notification templates and later Agent prompts resolve only explicit prior outputs; missing or incompatible values fail the step with a useful error.
6. For an Agent step, create and monitor a Pi session using the existing Pi SDK path, then store the session ID/title and output. Notification uses the existing notification service. Wait creates a persisted signed/opaque response token, marks the run `waiting_for_input`, and resumes from the next step after a validated answer.
7. Make retry/cancellation behavior explicit: cancellation stops any active Pi session and marks the current step/run cancelled. Do not add automatic retries in this first rebuild; record enough detail for a later retry-from-step feature.

Webhook security: generate at least 256 bits of random token material, store only a SHA-256/HMAC hash, compare in constant time, rate-limit by token/IP, cap request size, and redact sensitive payload fields from history/logs. A webhook token is shown only at creation/regeneration time. Regenerating it invalidates the previous endpoint.

## Migration and Compatibility

1. Add new collections and code without changing old data.
2. Backfill each existing `automation_jobs` row to one new automation, a Schedule/Cron trigger (interval jobs become a cron-equivalent where representable, otherwise an explicit interval-compatible schedule config), and one Agent step with the current agent/model/prompt/skill metadata. Use a default icon.
3. Convert old run records to the new run collection where possible, preserving timestamps, status, session links, response, and error text. Mark migrated records with `source: legacy` rather than inventing step output.
4. Verify counts and sample definitions, switch frontend and scheduler reads to the new APIs, then stop registering legacy jobs.
5. Remove the old routes, `GlobalAutomations`, `AutomationJobDialog`, old job/timing tabs, old URL-state variants, legacy collections, and compatibility code in a follow-up migration only after a release window. Do not leave two editable automation systems.

## Frontend Implementation

- Replace `Automations.tsx` with a project automation list/editor route and add focused components under `frontend/src/components/automations/`: `AutomationSidebarList`, `AutomationEditor`, `AutomationHeader`, `TriggerList`, `TriggerBlock`, `ConditionList`, `StepList`, `StepBlock`, `PastRunsDialog`, and typed block editors.
- Replace the current `useAutomations` jobs/run hooks and `api/automations.ts` contracts with complete-definition and run-detail queries. Invalidate the project automation list, selected definition, and run history after mutations; use optimistic reorder only after server validation.
- Update `DesktopSidebar`, mobile navigation, route helpers, and tests so project selection and automation mode remain consistent. The new-automation action must use the currently selected project, including General Chat where supported.
- Use existing Radix/Shadcn components, Lucide icons, dialogs, dropdowns, form controls, toasts, and accessibility conventions. Controls require labels, keyboard navigation, visible focus, and announced save/run/error states.
- Empty states distinguish “no automations in this project” from “no automation selected.” Maintain responsive editor usability without horizontal overflow.

## Tests and Verification

1. Shared schema tests: every trigger, condition, and step union; invalid nested config; output-reference validation; and request limits.
2. DB/migration tests: definition ordering, atomic replacement, migration/backfill fidelity, token hashing, and index-compatible queries.
3. Service tests: multi-trigger registration/unregistration, cron timezone/next run, webhook lookup and validation, condition pass/fail, execution ordering/context interpolation, wait/resume, locking, cancellation, and Pi/notification error propagation.
4. Route tests: project ownership, create/update/delete, manual runs, webhook token secrecy and rate limits, and wait answer authorization.
5. Frontend tests: sidebar mode and `+` behavior, selection URL state, editable metadata, trigger/condition/step add-edit-delete-reorder flows, validation messages, and past-run dialog.
6. Manual QA: desktop and mobile, dark and light themes, an automation with two schedules plus conditions, webhook delivery, Agent → Notification output interpolation, and Wait for user input resume.
7. Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Acceptance Criteria

- Automations is project-scoped; its sidebar list replaces session content and its adjacent plus action creates an automation for that project.
- An automation has a name, description, icon, multiple independently configured triggers, optional trigger conditions, and ordered composable steps.
- Schedule, cron, and secure webhook triggers can start the same definition; conditions block a run without executing actions.
- Agent, Notification, and Wait for user input blocks execute in order and safely expose named outputs to later blocks.
- The editor supports metadata management, deletion, and past-run inspection from its header menu.
- Existing automations and useful run history are migrated before the legacy implementation is removed.
- The resulting UI feels native to Subpolar while providing the specified project list, editor header, triggers, conditions, and ordered action blocks.
