# Skill System Revision Plan

## Goal

Make skills first-class agent configuration. Tools grant capability; skills explain how agent should use capability. Agent editor should preview complete runtime prompt, including Subpolar defaults, agent prompt, tool-use instructions, skill discovery payload, and `${user}` placeholder.

## Current State

- Agent create/edit UI lives in `frontend/src/components/settings/AgentDialog.tsx`.
- Agents page passes global managed skill names from `settingsApi.listManagedSkills()` in `frontend/src/pages/Agents.tsx`.
- Agent config currently stores `skills?: string[]` plus `toolAccess?: Array<{ type, id, permission, command? }>`.
- Existing "Agent Tools" carousel mixes built-in tools, skills, CLI utilities, and Subpolar tools.
- Managed skills are listed by `backend/src/services/skills.ts`, but project listing only reads direct children of `.opencode/skills/<name>/SKILL.md`.
- Runtime already has broader project skill discovery in `backend/src/runtime/pi-runtime.ts`, including nested `SKILL.md` search.
- System prompt composition currently happens in `PiRuntimeAdapter.getSystemPrompt()`, appending `AGENTS.md` to provided agent prompt.

## Desired Product Behavior

- Edit/add agent modal uses two columns on desktop: `2fr 1fr`.
- Left column keeps current editable form.
- Right column shows full prompt preview and ends with `${user}` placeholder.
- Preview updates live as left column changes.
- Under `Agent Tools`, add separate `Skills` section with carousel UI matching tool carousel.
- Skills section shows skills made available by selected tools plus manually selected skills.
- Selecting skill card reveals discovery behavior select for that skill.
- Web fetch access should add Research skill by default.
- Skill list includes global skills and auto-discovered project skills from nested `SKILL.md` files.
- Tool access and skill instruction access stay separate. Example: agent may have `webfetch` tool, while Research skill decides when/how to use it.

## Discovery Modes

Store discovery mode per selected skill:

| Mode | Prompt Payload | Runtime Need |
| --- | --- | --- |
| `full` | Skill name, description, and full `SKILL.md` body appended to system prompt | No search/load needed for this skill |
| `description` | Skill name and brief description appended | Agent may use skill loader/search for full body |
| `name` | Skill name only appended | Agent only knows identifier exists |
| `search` | Not listed directly; discoverable through skill search tool | Skill search tool must be allowed/available |

Default modes:

- Tool-provided default skills: `description`.
- Manually added skills: `description`.
- Project auto-discovered skills: `description` when explicitly selected; otherwise only available through search.
- If skill search tool is not available, warn in UI when selected skill uses `search`.

## Proposed Config Shape

Keep legacy `skills: string[]` during migration, but make new config authoritative:

```ts
type SkillDiscoveryMode = 'full' | 'description' | 'name' | 'search'

interface AgentSkillAccess {
  id: string
  discovery: SkillDiscoveryMode
  source?: 'manual' | 'tool-default' | 'project-auto'
}

interface Agent {
  skills?: string[]
  skillAccess?: AgentSkillAccess[]
  toolAccess?: Array<{ type: 'builtin' | 'cli' | 'subpolar'; id: string; permission: 'allow' | 'ask' | 'deny'; command?: string }>
}
```

Migration rules in UI read path:

- If `skillAccess` exists, use it.
- Else map `skills` to `{ id, discovery: 'description', source: 'manual' }`.
- Remove `type: 'skill'` from new `toolAccess` writes.
- Continue writing `skills` as flattened selected skill ids for compatibility until runtime consumes `skillAccess` everywhere.

## Prompt Model

Create shared prompt assembly logic instead of duplicating preview and runtime behavior.

Recommended module:

- `shared/src/schemas/agent.ts` or `shared/src/schemas/skills.ts`: shared types for `SkillDiscoveryMode`, `AgentSkillAccess`.
- `backend/src/services/agent-prompt.ts`: canonical runtime prompt builder.
- `frontend/src/lib/agentPromptPreview.ts`: browser-safe mirror or API-backed preview.

Prompt sections:

1. Subpolar default instructions.
2. Agent prompt from form.
3. Project instructions (`AGENTS.md`) when project directory known.
4. Tool usage block generated from enabled tools and permissions.
5. Skill discovery block generated from `skillAccess` and available skill metadata.
6. `${user}` placeholder in preview only.

Preview should show missing data clearly:

- If project not selected, show `Project instructions unavailable until project context selected`.
- If selected skill body has not loaded, show name and description only with loading state.
- If skill file missing, show warning badge and omit body.

## Backend Work

### 1. Shared Skill Types

Files:

- `shared/src/schemas/skills.ts`
- `shared/src/index.ts`

Add:

- `SkillDiscoveryModeSchema`.
- `AgentSkillAccessSchema`.
- `SkillFileInfo.discoveryEligible?: boolean` only if UI needs to distinguish indexed/discovered skills.
- `SkillFileInfo.source?: 'global' | 'project' | 'auto'` if useful for display.

### 2. Recursive Skill Listing

Files:

- `backend/src/services/skills.ts`
- `backend/src/routes/settings.ts`

Change `listManagedSkills()` to include nested `SKILL.md` files under project directory, not only `.opencode/skills/<name>/SKILL.md`.

Rules:

- Always include global managed skills.
- Include project managed skills from `.opencode/skills`.
- Include auto-discovered project skills from subfolders when `directory` or `repoId` is supplied.
- Skip `node_modules`, `.git`, `dist`, `build`, `.next`, `.vite`, `coverage`.
- De-dupe by canonical file path first, then by skill name where same scope conflicts.
- Validate frontmatter name; if absent, derive from parent directory only for display, but mark invalid if it cannot be used as identifier.

### 3. Tool-To-Default-Skill Mapping

Files:

- New `shared/src/schemas/tool-skill-defaults.ts` or frontend-only constant first.

Start minimal:

```ts
const TOOL_DEFAULT_SKILLS = {
  webfetch: ['research'],
}
```

Do not create missing skill files automatically in first pass. UI should show missing default skill as suggested/unavailable unless global Research skill exists.

### 4. Runtime Prompt Assembly

Files:

- `backend/src/runtime/pi-runtime.ts`
- New `backend/src/services/agent-prompt.ts`

Move prompt assembly out of `getSystemPrompt()` into testable builder.

Builder inputs:

- base Subpolar instructions
- agent prompt
- `AGENTS.md` content
- enabled tools/tool policies
- selected `skillAccess`
- resolved `SkillFileInfo[]`

Output:

- final system prompt string
- warnings for missing skill/search-tool mismatch

Runtime should honor discovery modes:

- `full`: append body.
- `description`: append name and description.
- `name`: append name.
- `search`: omit from direct block, leave to skill search.

## Frontend Work

### 1. AgentDialog Layout

File: `frontend/src/components/settings/AgentDialog.tsx`

Change dialog width and body:

- `DialogContent` desktop width from `sm:max-w-2xl` to wider value such as `xl:max-w-6xl`.
- Inside scroll body, use `grid gap-4 lg:grid-cols-[2fr_1fr]`.
- Left column contains current form fields.
- Right column is sticky prompt preview panel on desktop, normal flow on mobile.

### 2. Split Tools And Skills

File: `frontend/src/components/settings/AgentDialog.tsx`

Change form schema:

- Remove `skill` from `toolAccessSchema.type` for new writes.
- Add `skillAccess: z.array(agentSkillAccessSchema).optional()`.

UI:

- Keep `Agent Tools` carousel for built-in, CLI, Subpolar tools.
- Add `Skills` carousel under `Agent Tools`.
- Skill card displays name, source, discovery mode, and missing/unavailable state.
- Selected skill editor has skill select and discovery select.
- Add/remove skill buttons mirror tool carousel behavior.

### 3. Default Skill Suggestions

File: `frontend/src/components/settings/AgentDialog.tsx`

Behavior:

- Watch `toolAccess`.
- If `webfetch` changes from denied to allowed/ask, add `research` to `skillAccess` if available and absent.
- If user removes `research`, do not re-add until webfetch toggles again.
- If `webfetch` is denied later, keep `research` but mark as manually retained, or ask via non-blocking UI. Prefer keep to avoid destructive hidden changes.

### 4. Prompt Preview

Files:

- `frontend/src/components/settings/AgentDialog.tsx`
- New `frontend/src/lib/agentPromptPreview.ts`

Inputs:

- `form.watch()` values.
- Available skills with bodies.
- Tool metadata.

Preview content:

```md
## Subpolar Instructions
...

## Agent Instructions
...

## Tools
...

## Skills
...

## User Prompt
${user}
```

Use same mode semantics as backend. Keep preview deterministic and readable, not exact token-perfect if backend includes runtime-only project data.

### 5. Agents Page Wiring

File: `frontend/src/pages/Agents.tsx`

Changes:

- Pass full `SkillFileInfo[]`, not only names, to `AgentDialog`.
- Query project-aware skills when project context exists: `settingsApi.listManagedSkills(undefined, generalChatDirectory)` for general chat, and later selected project directory for project-specific agent editing.
- Show skill discovery mode in agent detail view when `skillAccess` exists.

### 6. Settings AgentsEditor Compatibility

File: `frontend/src/components/settings/AgentsEditor.tsx`

Changes:

- Update local `Agent` interface with `skillAccess`.
- Pass `availableSkills` once config manager has managed skill data, or let `AgentDialog` fetch when not supplied.

## Tests

Backend:

- `backend/src/services/skills.test.ts`: recursive discovery, skipped directories, de-dupe, malformed frontmatter.
- `backend/src/services/agent-prompt.test.ts`: each discovery mode produces expected prompt sections.
- Runtime test around `PiRuntimeAdapter` prompt builder if existing harness allows.

Frontend:

- `AgentDialog` tests for two separate carousels.
- `webfetch` enables Research default skill.
- Discovery mode select updates preview.
- Legacy `skills: string[]` maps to `skillAccess`.

Manual verification:

- Create agent with webfetch allowed; Research appears in Skills.
- Switch Research from `description` to `full`; preview includes body.
- Add nested project skill at `some/folder/SKILL.md`; it appears when editing agent with project directory.
- Run `pnpm lint`.
- Run `pnpm test`.

## Open Questions

1. Should `Research` be seeded as global built-in skill if missing, or should UI only suggest it when user has created it?
2. Should `search` discovery mode automatically force-enable skill search tool, or only warn?
3. Should project auto-discovery scan whole repo recursively with ignore list, or cap depth like current runtime `findSkillFiles(cwd, 3)`?
4. Should prompt preview call backend for canonical prompt, or keep frontend mirror for instant updates?
5. Should selected skills be project-specific per agent, or should same agent config behave differently depending on project open at runtime?

## Implementation Order

1. Add shared `SkillDiscoveryMode` and `AgentSkillAccess` types.
2. Update `listManagedSkills()` to return recursive project auto-discovered `SKILL.md` files.
3. Add backend prompt builder tests and implementation for discovery modes.
4. Refactor runtime prompt assembly to use builder.
5. Update `AgentDialog` schema and data normalization for `skillAccess` while preserving legacy `skills`.
6. Split UI into Tools carousel and Skills carousel.
7. Add live prompt preview panel.
8. Add webfetch-to-Research default skill behavior.
9. Update `Agents.tsx` and `AgentsEditor.tsx` wiring/details.
10. Run lint/tests and fix regressions.
