# Approach for Agents

You are a pragmatic senior engineer. Your job is to help me design and build a long-term maintainable backend API.

Non-negotiable rules:

1. Prefer modular monolith with strict module boundaries
2. Evolutionary design — we extract services only when there is a clear need
3. Strong typing + OpenAPI contract-first
4. PostgreSQL as primary database
5. Every suggestion must include trade-offs and a path to evolve later
6. Never introduce complexity (Kafka, microservices, CQRS, etc.) unless I explicitly request it

Current goal: [describe what you want right now]

Respond with:

- Reasoning (max 5 bullets)
- Concrete recommendation
- Risks
- What I should verify next

# Engineering Rules

## Architecture

- Feature-oriented modules.
- Domain logic belongs inside domain/application boundaries.
- Infrastructure must not leak into domain logic.
- Do not introduce CQRS unless the feature explicitly requires it.
- Do not introduce a new abstraction when an existing one is sufficient.

## Dependencies

- Do not add packages without explicit justification.
- Prefer the standard library/framework.
- Reuse existing utilities and services.

## Database

- PostgreSQL is the source of truth.
- Transactions must be explicit where consistency matters.
- Never perform read-modify-write without considering concurrency.

## API

- Controllers remain thin.
- Business logic belongs in application/domain services.
- Validate at the boundary.

## Code Generation

- Modify the smallest possible number of files.
- Do not rewrite working code unnecessarily.
- Do not rename files/classes unless required.
- Do not create "future-proof" abstractions without a current use case.

## Testing

- Add tests for changed behavior.
- Do not generate tests that merely duplicate implementation details.

## Before finishing

- Remove unused imports.
- Remove dead code.
- Remove speculative abstractions.
- Explain every new file and dependency.

## Project conventions

- **Stack:** TypeScript monorepo managed with pnpm and Turborepo. It contains a NestJS backend (Drizzle ORM, PostgreSQL, Supabase), a Next.js/React web app, an Expo/React Native mobile app, and shared React UI packages.
- **Style:** Follow the naming, formatting, and module patterns already used in the affected package; use strong TypeScript types and validate inputs at boundaries. In the backend, use DTO validation and the existing NestJS exception handling rather than ad hoc parsing or response shapes. Add tests for changed behavior using the package's existing test setup; do not add a test framework just for a change.
- **Important paths:** Treat `apps/backend/src/auth/`, `apps/backend/src/payment/`, `apps/backend/src/chat/` (especially `e2e/`), `apps/backend/src/db/schema/`, and `apps/backend/drizzle/migrations/` as high-impact areas. Trace their callers, database constraints, and API contracts before changing them. Never expose or commit secrets from environment files.
- **Never:** Add dependencies without a concrete need; introduce Kafka, microservices, CQRS, or other architectural complexity unless explicitly requested; or edit generated output and lockfiles by hand. Use the relevant source files and tooling instead.

## Review rules

When reviewing changes, report actionable findings with the affected behavior and location. Always flag:

- Logic errors and edge cases that can produce incorrect results or state.
- Security issues, including authorization, input validation, and secret exposure.
- Cross-file regressions or broken API/database contracts.
- Missing error handling when a failure can cause incorrect behavior, unsafe partial work, or a misleading success response.
- Missing tests for non-trivial changed behavior when the existing test setup can cover it.

Treat as **Nit** style-only inconsistencies with conventions in the touched file or module. Do not downgrade correctness, security, or maintainability problems to Nits. Skip generated files, lockfiles, and pure formatting changes unless they contain a substantive issue.

## Module README convention

A request like "give me the README for `<module>`" or "let's do a README for `src/<module>`" means: write `src/<module>/README.md` in the fixed shape below, so module docs stay comparable to each other instead of drifting into whatever shape felt natural that day. `apps/backend/src/payment/README.md` and `apps/backend/src/chat/README.md` are the canonical examples — re-read both for tone and depth before writing a new one; this section describes their shape, not a substitute for looking at them.

_module term can be the same as feature for this topic_

**Sections, in this order:**

1. Title + a one-to-two sentence purpose statement.
2. `## Architecture`
   - An opening subsection whose heading names the module's actual core design idea (`The ledger boundary`, `REST is authoritative, the socket is a shortcut`) — never a generic `### Overview`.
   - A table: one row per file for a thin/service-style module, or one row per DB table for a schema-heavy one. One-line purpose per row.
   - `### Entity map` — a `mermaid erDiagram` of the tables the module owns (fields + FK relationships). Skip this subsection entirely if the module owns no tables.
   - A short subsection on how the module relates to this backend's two standing cross-cutting mechanisms — the transactional outbox (`src/outbox/`) and BullMQ queues. State plainly which ones it uses and which it deliberately skips, and why (chat skips both; payment is designed around both).
3. `## Lifecycle, end to end` — one or more `mermaid sequenceDiagram` blocks tracing the module's real request/data flow (not a generic CRUD sketch), followed by a short `Key properties this gives us` bullet list pulling out the non-obvious invariants the diagram makes visible.
4. `## Current state` — a table of piece vs. status (`Done` / `Not started` / partial with a caveat). Be honest: a mostly-unbuilt module should read as mostly-unbuilt, not padded out to look further along.
5. `## Open items` — real findings from reading the actual code (a structural gap, a guard that isn't applied consistently, a doc that's gone stale), each with why it matters. No filler items. Carry forward anything from this file's `Known gaps` section that applies to the module, plus whatever new gaps surfaced while writing the README.

**Process, before and while writing:**

- Read every file in the module first — an empty stub file changes what the README can honestly claim (this is why payment's README reads as mostly-unbuilt and chat's doesn't).
- Verify each architectural claim against the actual code (imports, schema, guards actually applied) rather than the file's own comments or this file's prose — both can be stale.
- Reuse the terminology this file and sibling READMEs already use for the same concept, rather than introducing a new synonym for it.
- Run `pnpm format` (or `npx prettier --write <path>`) on the finished file, and confirm the mermaid fences survived formatting untouched.
- If writing the README surfaces something that contradicts this file (e.g. a module description here turns out stale because the code moved on), note it under that module's Open items — don't silently rewrite this file as a side effect unless asked to.
