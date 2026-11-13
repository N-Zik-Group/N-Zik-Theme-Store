<div align="center">
  <img alt="N-Zik" src="https://raw.githubusercontent.com/N-Zik-Group/N-Zik/main/assets/design/ic_banner2.png" width="1080" />

  <h1>N-Zik Theme Store</h1>
  <p>Community appearance themes for <a href="https://github.com/N-Zik-Group/N-Zik">N-Zik on Android</a>.</p>
  <p><a href="https://n-zik.vercel.app/">🌐 Official website</a> · <a href="https://discord.gg/bneHC7QRje">💬 Discord</a></p>
</div>

## 🎨 Catalog

Browse the [catalog index](catalog/index.json) for published theme revisions. A maintainer publishes changes by merging a pull request into `main`.

## 📦 Repository layout

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
- `compatibility.minVersionCode` is the minimum Android version code that supports the theme. A `null` value marks a listing with pending compatibility. Clients must disable applying that revision until a supporting version is declared.
- The appearance payload contains a closed set of categories for colors, player and queue, navigation, and Glass. A category contains all its v1 fields whenever present. Applying a theme writes only the fields in the selected categories. A category that is missing or unchecked leaves its settings untouched. The client must map these stable values to its own settings.
- The schema accepts only the declared appearance fields. Accounts, audio settings, library data and file paths have no representation in the payload. Glass quality, custom palettes, fonts, page layout, lyrics and animation settings are outside this initial contract.
- The numeric GitHub user ID identifies the author and the login is display metadata. Check ownership against the authenticated GitHub account when processing a submission. The manifest alone cannot establish ownership.
- Reviewers verify media content, rights and license identifiers before publication. Preview files should depict the submitted theme and may include JPG, PNG, WebP or GIF files.

## 🎧 Built-in N-Zik presets

The first six catalog entries follow the order of the original preset chooser in [N-Zik at `1013c849fb`](https://github.com/N-Zik-Group/N-Zik/tree/1013c849fb66e3a8c9fb200eede3d5600a16d234). The built-in presets were [introduced by aneesh1122](https://github.com/N-Zik-Group/N-Zik/commit/ea40544986) and maintained in N-Zik. Their catalog names are descriptive labels added for this conversion. See the [GPL-3.0 license](themes/LICENSE-GPL-3.0.txt).

Each theme uses N-Zik's Appearance reset values for fields its original preset inherited. For example, all six use the Modern queue style, the third uses a 90 cover size, and the fourth uses System palette mode. The conversion includes the colors and player/queue categories. Preview images and minimum app compatibility are pending verification.

Appearance field mappings are defined by the source settings. `coverSize` maps to the portrait `thumbnailSizeDp` preference, which the UI exposes as a 0–100 control. `transparentPlayerBar`, `noBlur` and `showExpandPlayerButton` map to `transparentbar`, `noblur` and `expandedplayertoggle`, respectively. The app still resolves how these settings interact with its layout and rendering rules.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to submit, update or withdraw a theme and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards.

## 👀 Status

[![Validate catalog](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml)

Run `uv run --no-project --with-requirements requirements-validation.txt python scripts/validate_catalog.py` from the repository root. It checks the schemas, index, example and indexed revisions, including matching IDs, duplicate entries or preview paths, and file hashes.

## 👥 Contributors

See the [repository contributors](https://github.com/N-Zik-Group/N-Zik-Theme-Store/graphs/contributors). The built-in preset credits are listed above.

## 📜 License

The repository tooling and documentation use [GPL-3.0](LICENSE). Each theme declares its own license in its manifest.
