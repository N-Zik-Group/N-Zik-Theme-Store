# AGENTS.md — N-Zik Theme Store

**Version:** 1.0.0 | **Last updated:** 2026-11-18

Read [the catalog rules](rules/CODE.md), [the workflow rules](rules/WORKFLOW.md), and [the validation rules](rules/BUILD.md) before changing this repository. Match the maintainer’s language in conversation and use English for repository documentation and commit messages.

- `catalog/themes/` holds the catalog index and published theme revisions.
- `catalog/creators/` holds profiles, verified creators and the contribution blocklist.
- `catalog/schemas/v*/` holds versioned portable formats. V3 is the current writable format. The V1 and V2 catalogs and schemas remain available for compatible clients.
- `demo/` holds example packages and public demo assets. Android code is in the separate N-Zik repository.
- `.github/workflows/` and `.github/scripts/` hold the GitHub automation.

Follow the scope the maintainer authorized. Verify your changes and report the commit, test result and any remaining checks when you finish.

## Appearance format changes

- When adding or removing a portable app setting, update the current schema (V3), Android's typed exporter/importer, preview reader and matching validation tests together. Preserve the earlier schemas for compatible clients.
- Compatible optional additions may extend the current format. Require a feature-specific minimum Android version when an older APK cannot understand the new field or enum value; keep that separate from the schema's minimum version.
- Removing a setting from the UI stops new exports of it; keep legacy fields recognized for existing documents. Removing or renaming a format field, changing its type or breaking its meaning requires a new schema version while preserving older readers and downloads.
- Android exports the latest schema implemented by that APK. Never switch exports automatically to a newer remote schema or silently discard unknown future fields. Unsupported imports and publication requirements must produce a clear error.
- Local export/import must not depend on server availability. Coordinate schema/validator deployment and Android support before enabling online publication of new features; never advertise compatibility with an APK that lacks them.
