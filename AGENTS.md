# Repository Guidelines

## Project Structure & Module Organization
Runtime code sits in `src/`, where `index.ts` wires client pools, sandbox executors, rate limiters, and validators defined under `schemas/`, `interfaces/`, and `types/`; `dist/` holds the compiled CLI. Reference docs, release notes, and deployment guides live in `docs/`, `specs/`, `RELEASE*.md`, and `WORKTREE-GUIDE.md`. Sample agent flows are in `examples/`, while operational artifacts (`apparmor-profile`, `seccomp-profile.json`, `config/.mcp.json`, `logs/`, `audit.log`) capture security posture. Tests live mostly in `tests/` (helpers, docker checks, integrations) with a few targeted `.test.ts` files colocated in `src/`.

## Build, Test, and Development Commands
- `npm install` – install Node 22+ dependencies.
- `npm run dev` – watch/compile TypeScript while editing.
- `npm run build && npm start` – emit `dist/` and launch the MCP server locally.
- `npm run generate-wrappers` – regenerate tool wrappers after schema changes.
- `npm run typecheck` and `npm run lint`/`lint:fix` – enforce strict typing and ESLint rules.
- `npm test`, `npm run test:watch`, and `npm run test:coverage` – execute the Vitest suite and capture V8 coverage.

## Coding Style & Naming Conventions
TypeScript targets ES2022 with strict + NodeNext modules; keep 2-space indentation, single quotes, kebab-case filenames, camelCase functions, and PascalCase types. Avoid `any`, prefer `unknown` plus guards or Zod schemas, and state return types on exported APIs. Keep async code `await`-driven, reuse helpers from `src/utils.ts`, and let ESLint (`eslint.config.mjs`) enforce import order, unused symbols, and `import type` patterns.

## Testing Guidelines
Vitest powers both unit and integration suites. Place behavior-heavy tests in `tests/` (lean on `tests/helpers` for fixtures and `tests/integration` for MCP-client exercises) and keep fast schema checks next to the source. Name specs `should_<behavior>_when_<condition>`. Run `npm test` before commits and `npm run test:coverage` when touching core flows; expect ≥90% coverage. Execute `test-security.sh` or `test-docker-security.sh` after sandbox or container changes.

## Commit & Pull Request Guidelines
Follow Conventional Commits `type(scope): subject` (examples: `feat(rate-limiter): expose burst config`, `fix(proxy): reset circuit breaker`). Branch names usually start with `feature/`, `fix/`, `docs/`, or `refactor/`. Every PR should state motivation, testing output, and linked issues, and only land after `npm run typecheck && npm test && npm run build` passes. Mention schema or discovery updates when changing allowlists or tool metadata.

## Security & Configuration Tips
Configuration is managed through env vars parsed in `src/config.ts` plus optional overrides in `config/.mcp.json`; keep secrets out of version control. Update `SECURITY.md`, AppArmor/Seccomp profiles, and rate-limit defaults together, and refresh audit expectations in `tests/mcp-proxy-server-*.test.ts` if discovery responses change. Keep `logs/` and `audit.log` sanitized before committing. When enabling new MCP tools, extend allowlists in `src/security.ts` and document runtime knobs in `docs/`.
