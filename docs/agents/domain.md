# Domain Docs

This repository uses a single-context domain documentation layout.

Before exploring the codebase, read these files when they exist:

- `CONTEXT.md` for domain terminology and boundaries
- Relevant ADRs under `docs/adr/`

Use terminology defined in `CONTEXT.md` consistently. If proposed work
contradicts an ADR, identify the conflict explicitly instead of silently
overriding the recorded decision.

Expected layout:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

Missing domain documents do not block work. They are created only when
domain terminology or architectural decisions need to be recorded.
