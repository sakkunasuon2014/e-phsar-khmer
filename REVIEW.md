# Review Rules

Always flag:

- Logic bugs / edge cases
- Security issues (auth, input validation, secrets)
- Cross-file regressions
- Broken contracts / missing error handling

Treat as Nit:

- Style that doesn't match CLAUDE.md
- Missing tests only when the change is non-trivial

Skip:

- Generated files
- Lockfiles
- Pure formatting changes
