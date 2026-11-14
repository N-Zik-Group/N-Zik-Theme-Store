# Theme format

## 📦 Repository layout

- [catalog/index.json](../catalog/index.json) lists the revisions available for download.
- [schemas/v1/](../schemas/v1/) defines the catalog index, theme manifest and appearance payload in JSON Schema Draft 2020-12.
- [examples/theme-v1/](../examples/theme-v1/) contains a sample manifest and configuration for validation.

Published revisions use this layout:

```text
themes/<themeId>/<revision>/
  manifest.json
  appearance.json
  previews/
```

The catalog derives a manifest URL from `themeId` and `revision`. Each entry pins the SHA-256 of the manifest. The manifest pins the SHA-256 of the raw appearance and preview bytes. Use the lowercase hexadecimal SHA-256 of the committed bytes, including the final newline when present. Resolve media paths relative to the manifest directory.

## Version 1

- `schemaVersion` selects the format. `themeId` is a permanent lowercase UUID independent of the theme title. Before the stable release, update the existing revision 1 directory and refresh the manifest hash in the index. Once the catalog is stable, each published change increments `revision` and uses a new directory. The catalog lists one current revision per theme. To withdraw a theme, remove its index entry.
- `compatibility.minVersionCode` is the minimum Android version code that supports the theme. A `null` value marks a listing with pending compatibility. Clients must disable applying that revision until a supporting version is declared.
- The appearance payload contains a closed set of categories for colors, player and queue, navigation, and Glass. A category contains all its v1 fields whenever present. Applying a theme writes only the fields in the selected categories. A category that is missing or unchecked leaves its settings untouched. The client must map these stable values to its own settings.
- The schema accepts only the declared appearance fields. Accounts, audio settings, library data and file paths have no representation in the payload. V1 supports optional built-in font and interface settings under navigation, and some lyrics and animation controls under player and queue. Custom palettes, custom fonts and the full range of layout, Glass, lyrics and animation settings are not yet represented.
- The numeric GitHub user ID identifies the author and the login is display metadata. Check ownership against the authenticated GitHub account when processing a submission. The manifest alone cannot establish ownership.
- Reviewers verify media content, rights and license identifiers before publication. Preview files should depict the submitted theme and may include JPG, PNG, WebP or GIF files.

## 🎧 Built-in N-Zik presets

The first six catalog entries follow the order of the original preset chooser in [N-Zik at `1013c849fb`](https://github.com/N-Zik-Group/N-Zik/tree/1013c849fb66e3a8c9fb200eede3d5600a16d234). The built-in presets were [introduced by aneesh1122](https://github.com/N-Zik-Group/N-Zik/commit/ea40544986) and maintained in N-Zik. Their catalog names are descriptive labels added for this conversion. See the [GPL-3.0 license](../themes/LICENSE-GPL-3.0.txt).

Each theme uses N-Zik's Appearance reset values for fields its original preset inherited. For example, all six use the Modern queue style, the third uses a 90 cover size, and the fourth uses System palette mode. The conversion includes the colors and player/queue categories. Minimum release compatibility is pending for the six current listings. The README gallery shows captures from a debug build.

Appearance field mappings are defined by the source settings. `coverSize` maps to the portrait `thumbnailSizeDp` preference, which the UI exposes as a 0–100 control. `transparentPlayerBar`, `noBlur` and `showExpandPlayerButton` map to `transparentbar`, `noblur` and `expandedplayertoggle`, respectively. The app still resolves how these settings interact with its layout and rendering rules.


## Preview coverage

Each new submission includes one Normal and one Glass preview for each of these views:

- Player, queue and lyrics.
- Quick Picks and library/navigation.
- Album, artist, online playlist and local playlist.
- Online search results for songs, albums and artists.

Use the actual N-Zik pages with demo content or content you have permission to share.
Keep both variants even when they look similar. You can add up to 12 extra previews.
WebP is preferred for still images. Animated GIFs are also accepted.

Name files `<screen>-normal.webp` and `<screen>-glass.webp`, using the extensions
accepted by the schema. Required screen names are `player`, `queue`, `lyrics`,
`home`, `navigation`, `album`, `artist`, `playlist`, `local-playlist`, `search`,
`search-albums` and `search-artists`. Use the corresponding role for the player,
queue and navigation. Use `other` for all other screens. Add a readable caption.

## Maintainer reviews

A theme revision can have a `themes/<themeId>/<revision>/reviews.json` file
next to its manifest. Reviews apply to that revision. A missing file means the
revision has no maintainer reviews. Each GitHub author can review a revision once.

See the [review schema](../schemas/v1/reviews.schema.json) and
[example](../examples/theme-v1/reviews.json).
