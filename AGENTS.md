# Subpolar - Agent Guidelines

## Commands

- `pnpm dev` - Start both backend (5003) and frontend (5173)
- `pnpm dev:backend` - Backend only: `bun --watch-path backend/src --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `pnpm --filter frontend dev`
- `pnpm build` - Build both backend and frontend
- `pnpm test` - Run backend tests: `pnpm --filter backend test` (vitest)
- `cd backend && vitest <filename>` - Run single test file
- `cd backend && vitest --ui` - Test UI with coverage
- `cd backend && vitest --coverage` - Coverage report (80% threshold)
- `pnpm lint` - Lint both backend and frontend
- `pnpm lint:backend` - Backend linting
- `pnpm lint:frontend` - Frontend linting

## Package Managers

- Prefer pnpm for workspace dependency management and scripts.
- pnpm is installed, but its configured global bin directory is not currently on PATH; avoid relying on `pnpm link --global` unless the shell setup is fixed first.
- npm global installs link into `/opt/homebrew`, which is on PATH; use `npm link` for globally linking this local package when needed.
- The root package exposes `subpolar-cli` via the `bin` field and requires Bun to execute the TypeScript script.

## Code Style

- No comments, self-documenting code only
- No console logs (use Bun's logger or proper error handling)
- Strict TypeScript everywhere, proper typing required
- Named imports only: `import { Hono } from 'hono'`, `import { useState } from 'react'`

## Project Overview

Subpolar is a workspace for agents. Think ChatGPT with terminal access, organized around projects, reusable agent instructions, and explicit permission boundaries.

The homepage is a new chat UI where a user selects an agent, model, project, and permissions before starting work. Projects are folders the agent runs in. Each user also gets a `General chat` project for general-purpose tasks that are not tied to a specific workspace.

Agents combine a system prompt with permissions, including which skills they can access. Skills are dynamically loaded instructions: the model can discover them with a get-skills flow, optionally search for the right skill, then load the full skill instructions into context before using them.

Subpolar uses the `pi-coding-agent` package as its agent harness and extends it with Subpolar-specific projects, permission handling, session persistence, provider compatibility APIs, and tool authorization callbacks.

## Pi Runtime Architecture

- Subpolar uses Pi as the native coding-agent runtime and keeps OpenCode-shaped frontend APIs as compatibility adapters where needed.
- Prefer the Pi SDK from `@earendil-works/pi-coding-agent` for runtime integration instead of spawning `pi --mode rpc`.
- Model selection flows from the frontend as `providerID/modelID`, is posted to the native session run API, and is resolved through the Pi SDK before execution.
- `/api/provider` is a compatibility endpoint backed by the Pi SDK `ModelRegistry`; it maps Pi models into the provider/model shape expected by the current React model selector.
- Session messages are persisted in Subpolar's database, while each run creates a Pi SDK `AgentSession` with Subpolar's Pi extension loaded for tool authorization callbacks.

### Backend (Bun + Hono)

- Hono framework with Zod validation, Bun SQLite (bun:sqlite) database
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage: 80% minimum required

### Frontend (React + Vite)

- @/ alias for components: `import { Button } from '@/components/ui/button'`
- Radix UI + Tailwind CSS, React Hook Form + Zod
- React Query (@tanstack/react-query) for state management
- ESLint TypeScript rules enforced
- Use React hooks properly, no direct state mutations

### General

- DRY principles, follow existing patterns
- Use SOLID principles throughout design and implementation:
  - **Single Responsibility**: Each module/class/function should have one reason to change—keep responsibilities focused.
  - **Open/Closed**: Entities should be open for extension, closed for modification—prefer adding new code over altering stable code.
  - **Liskov Substitution**: Subtypes must be substitutable for their base types—no breaking expected behavior when swapping implementations.
  - **Interface Segregation**: Prefer small, specific interfaces over large, general ones—clients shouldn’t depend on methods they don’t use.
  - **Dependency Inversion**: Depend on abstractions, not concretions—inject dependencies and avoid hard-coding implementations.
- YAGNI: Don’t build or keep code you don’t need. If you change something, remove the unused parts. use the new code or keep the old, but don’t keep both.
- Never leave dead code: remove unused code, commented-out blocks, and unused variables/imports.
- ./temp/opencode is reference only, never commit has opencode src
- Use shared types from workspace package (@opencode-manager/shared)
- Pi runs through the SDK; backend API runs on port 5003
- Prefer pnpm over npm for all package management
- Run `pnpm lint` after completing tasks to ensure code quality
