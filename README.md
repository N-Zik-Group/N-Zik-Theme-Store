# N-Zik Theme Store

Public catalog of appearance themes for N-Zik. A maintainer publishes a theme by merging its pull request into `main`.

## Repository layout

- [catalog/index.json](catalog/index.json) lists the revisions available for download.
- [schemas/v1/](schemas/v1/) defines the catalog index, theme manifest and appearance payload in JSON Schema Draft 2020-12.
- [examples/theme-v1/](examples/theme-v1/) contains a sample manifest and configuration for validation.

Published revisions use this layout:

```text
themes/<themeId>/<revision>/
  manifest.json
  appearance.json
  previews/
```

The catalog derives a manifest URL from `themeId` and `revision`. Each entry pins the SHA-256 of the manifest. The manifest pins the SHA-256 of the raw appearance and preview bytes. Use the lowercase hexadecimal SHA-256 of the committed bytes, including the final newline when present. Resolve media paths relative to the manifest directory.

## Version 1

- `schemaVersion` selects the format. `themeId` is a permanent lowercase UUID independent of the theme title. Every published change increments `revision` and uses a new directory. A catalog lists one current revision per theme. To withdraw a theme, remove its index entry.
- `compatibility.minVersionCode` is the minimum Android version code that supports the theme. The sample uses a placeholder. Publish a real compatibility value once N-Zik supports the format.
- The appearance payload contains a closed set of categories for colors, player and queue, navigation, and Glass. A category contains all its v1 fields whenever present. Applying a theme writes only the fields in the selected categories. A category that is missing or unchecked leaves its settings untouched. The client must map these stable values to its own settings.
- The schema accepts only the declared appearance fields. Accounts, audio settings, library data and file paths have no representation in the payload. Glass quality, custom palettes, fonts, page layout, lyrics and animation settings are outside this initial contract.
- The numeric GitHub user ID identifies the author and the login is display metadata. Check ownership against the authenticated GitHub account when processing a submission. The manifest alone cannot establish ownership.
- Reviewers verify media content, rights and license identifiers before publication. Preview files should depict the submitted theme and may include JPG, PNG, WebP or GIF files.

## Validation

Run `uv run --no-project --with jsonschema python scripts/validate_catalog.py` from the repository root. It validates schemas, the index, the example and all indexed revisions. It also checks matching IDs and revisions, duplicate entries or preview paths, and declared file hashes.
