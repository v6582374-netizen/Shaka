# Skills Manager provenance

The Skills Manager frontend is derived from [`jiweiyeah/Skills-Manager`](https://github.com/jiweiyeah/Skills-Manager) commit `c0b16ba603d3d110e3e39d587b0a1a3a310ea464`. The retained 183-file snapshot has Git tree `b4375731610de43c31af4053cc5ba450f88689b9`.

The immutable, 183-file upstream snapshot lives at `../../third_party/skills-manager/`. It is audit material, not an installable workspace and not a second application runtime. It contains only the retained frontend source; this console does not contain a `src-tauri` host crate.

The executable frontend adaptation lives at `src/features/skills-manager/` and is mounted by `SkillsManagerWorkspace`. Its `web-bridge.ts` provides the browser-side platform bridge; all product-specific changes belong here, never in `third_party/`.

`skills-manager-provenance.json` records the upstream Git tree, source digests, each file's disposition, and the digests of the integrated frontend files. `npm run skills-manager:verify` reconstructs the upstream Git tree and checks the scoped generated stylesheet. It additionally verifies a Tauri command handler only if a future console host crate is actually present.

## Update procedure

1. Replace the snapshot in `third_party/skills-manager/` with the intended upstream commit and update its `UPSTREAM.md`.
2. Copy only the retained frontend files into `src/features/skills-manager/`, then reapply the documented browser, router, theme, and compatibility adaptations.
3. Run `npm run skills-manager:css` after every upstream CSS change.
4. Regenerate the provenance record with `npm run skills-manager:verify -- --write`.
5. Run `npm run skills-manager:test`, `npm test`, and `npm run build` from this directory.
