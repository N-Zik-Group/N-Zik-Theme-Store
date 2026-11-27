# Theme format

## 📦 Repository layout

- [The V3 index](../../catalog/themes/index-v3.json) lists revisions for Android version code 101 and later. [The V2 index](../../catalog/themes/index-v2.json) remains available for code 99 and later, and [the V1 index](../../catalog/themes/index.json) serves codes 97–98.
- [The V1 schemas](../../catalog/schemas/v1/), [V2 schemas](../../catalog/schemas/v2/), and [V3 schemas](../../catalog/schemas/v3/) define the indexes, manifests and appearance payloads in JSON Schema Draft 2020-12.
- [theme-v1/](theme-v1/) contains a sample manifest and configuration for validation.

Published revisions use this layout:

```text
catalog/themes/<themeId>/<revision>/
  manifest.json
  appearance.json
  previews/
```

The catalog derives a manifest URL from `themeId` and `revision`. Each entry pins the SHA-256 of the manifest. The manifest pins the SHA-256 of the raw appearance and preview bytes. Use the lowercase hexadecimal SHA-256 of the committed bytes, including the final newline when present. Resolve media paths relative to the manifest directory.

Android accepts up to 128 KiB for an appearance document, 512 KiB for each index,
manifest, creator profile or review document, and 4 MiB for each preview or custom
creator image. Files must not be empty. The index and current manifests must also
fit together in the 16 MiB Android catalog snapshot, including JSON string escaping.
The catalog validator enforces these limits before publication.

Text length limits count Unicode code points, including one for a supplementary
character such as an emoji. GitHub IDs fit a positive signed 64-bit integer;
revision and Android version codes fit a positive signed 32-bit integer.

## Catalog and manifest

- `schemaVersion` selects the format. All indexes use `schemaVersion: 1`. The manifest and appearance share the version of their catalog format. `themeId` is a permanent lowercase UUID independent of the theme title. Community updates increment `revision` and use a new directory. Each index lists one revision per theme. Withdrawal removes the theme from every index that lists it.
- `compatibility.minVersionCode` is the minimum Android version code that supports the theme. V1 publication accepts codes 97–98. V2 publication requires code 99 or higher, and V3 requires code 101 or higher. The modern indexes declare `legacyMaxVersionCode: 98` for the V1 catalog. A legacy `null` value marks pending compatibility and must disable applying that revision.
- The appearance payload contains a closed set of categories for colors, player and queue, navigation, and Glass. Applying a theme writes only the fields present in the selected categories. Missing optional fields and missing or unchecked categories leave the corresponding settings untouched. The preview uses N-Zik defaults for settings the theme omits.
- The schema accepts only the declared appearance fields. Colors includes optional custom accents and light and dark palettes. Player and queue includes optional lyrics appearance, mini-player controls and order, visualizer styles, artwork settings and player controls. Navigation includes optional home tabs and sections, toolbar and sort menu layouts, swipe actions, corner radii, item sizes, search layouts, and floating control offsets. Floating offsets are stored in Android pixels and clamped to the destination screen. Glass includes optional optics, interaction feedback, surface modes and destination overrides. Accounts, library data, audio files, custom fonts and file paths have no representation in the payload.
- The numeric GitHub user ID identifies the author. Published revisions retain the login recorded when they were submitted, so it can differ from the creator's current login. Check ownership against the authenticated GitHub account when processing a submission. The manifest alone cannot establish ownership.
- Reviewers verify media content and rights before publication. Preview files should depict the submitted theme and may include JPG, PNG, WebP or GIF files.

## Appearance V2

Set `schemaVersion` to `2` in `appearance.json`. The `playerAndQueue` category supports the optional `openingMode` (`audio`, `video`, or `remember-last`), `holdToSpeedUp` (boolean), and `holdToSpeedUpRate` (number from 1.1 to 4, inclusive).

When converting a V1 appearance, remove the `video` property from `playerAndQueue.actionButtons` and `playerAndQueue.miniPlayer.visibleButtons`. Remove any `video` entries from `playerAndQueue.miniPlayer.buttonOrder` and `playerAndQueue.actionBarOrder`. Recalculate the appearance and manifest hashes before updating the index.

## Appearance V3

The `playerAndQueue` category defines `topActionSlots` with exactly three IDs in screen order. Use `none` to leave a slot empty. The category's optional `bottomActionOrder` accepts the previous wire IDs and `audioVideo`. Its optional `actionButtons.audioVideo` switch defaults to off.

When converting a V1 or V2 appearance, put the old `actionBarOrder` in `bottomActionOrder`, then remove `showTopActionsBar` and `navigation.toolbars.custom.playerTop`. Convert their layout to the three slots and use all `none` when the old top bar was disabled. Preserve the old Audio/Video fallback in the bottom bar unless the theme explicitly hid it. An enabled bottom Menu remains in the bottom bar. Keep the original revision and its index entry.

## 🎧 Built-in N-Zik presets

The first six catalog entries follow the order of the original preset chooser in [N-Zik at `1013c849fb`](https://github.com/N-Zik-Group/N-Zik/tree/1013c849fb66e3a8c9fb200eede3d5600a16d234). The built-in presets were [introduced by aneesh1122](https://github.com/N-Zik-Group/N-Zik/commit/ea40544986) and maintained in N-Zik. Their catalog names are descriptive labels added for this conversion. All themes and their previews are released under the repository's [GPL-3.0-only license](../../LICENSE).

Each theme uses N-Zik's Appearance reset values for fields its original preset inherited. For example, all six use the Modern queue style, the third uses a 90 cover size, and the fourth uses System palette mode. The conversion includes the colors and player/queue categories. All seven current V2 catalog listings require Android version code 99 or later. The README gallery shows captures from a debug build.

Appearance field mappings are defined by the source settings. `coverSize` maps to the portrait `thumbnailSizeDp` preference, which the UI exposes as a 0–100 control. `transparentPlayerBar`, `noBlur` and `showExpandPlayerButton` map to `transparentbar`, `noblur` and `expandedplayertoggle`, respectively. The app still resolves how these settings interact with its layout and rendering rules.


## Demo artwork

The app downloads the media in [demo/v1](../v1/) on demand. The demo includes square album covers, wide creator banner variants, and silent audio. The indexes provide SHA-256 checksums. The app’s built-in N-Zik Default theme has bundled screenshots.

## Preview coverage

Each new submission includes one Normal and one Glass preview for each of these views:

- Player, queue and lyrics.
- Quick Picks and library/navigation.
- Album, artist, online playlist and local playlist.
- Online search results for songs, albums and artists.

Use the actual N-Zik pages with demo content or content you have permission to share.
Keep both variants even when they look similar. The modern gallery limits are published as
`previewLimit` in the V2 and V3 catalog indexes. Use the remaining slots for additional previews.
V1 galleries accept up to 36 images.
WebP is preferred for still images. Animated GIFs are also accepted.

Name V1 and fixed-appearance V2 and V3 files `<screen>-normal.webp` and `<screen>-glass.webp`.
The Pure Black and Modern Black palettes use the fixed dark gallery format.
For V2 and V3 themes that follow system appearance, name files
`<screen>-light-normal.webp`, `<screen>-light-glass.webp`,
`<screen>-dark-normal.webp` and `<screen>-dark-glass.webp`.
Required screen names are `player`, `queue`, `lyrics`,
`home`, `navigation`, `album`, `artist`, `playlist`, `local-playlist`, `search`,
`search-albums` and `search-artists`. Use the corresponding role for the player,
queue and navigation. Use `other` for all other screens. Add a readable caption.

N-Zik also captures `player-playing` and `miniplayer-playing` with the demo
player running, plus `menu` and `dialog` with the demo song menu and confirmation
dialog. V2 and V3 system galleries include the light and dark combinations for these
optional scenes when present. The app generates these images for both Publish and Edit.

## Maintainer reviews

A theme revision can have a `catalog/themes/<themeId>/<revision>/reviews.json` file
next to its manifest. Reviews apply to that revision. A missing file means the
revision has no maintainer reviews. Each GitHub author can review a revision once.

See the [review schema](../../catalog/schemas/v1/reviews.schema.json) and
[example](theme-v1/reviews.json).

## Creator profiles

Look up `catalog/creators/<githubId>/profile.json` using the theme manifest's author ID.
The GitHub ID and login identify the authenticated account. The profile editor
must keep them read-only. Maintainers verify account ownership before publishing
profile changes. The display name and bio are editable.

An avatar with source `github` uses the account avatar resolved by GitHub ID.
A banner with source `generated` selects a variant from the demo banner set
using the GitHub ID. For either image, `custom` refers to an image
committed next to the profile JSON and pinned by SHA-256. Clients can use the
default artwork if a profile or image is unavailable.

Recommended dimensions for custom images:

| Image | Dimensions | Aspect ratio | Framing |
| --- | --- | --- | --- |
| Avatar | 256 x 256 px | 1:1 | Center the subject for a circular crop. |
| Banner | 1100 x 500 px | 2.2:1 | Fill the canvas and remove transparent outer margins. |

The dimensions are recommendations. The schema does not inspect image pixels.

See the [creator schema](../../catalog/schemas/v1/creator.schema.json) and
[example](creator-v1/profile.json).

The [creator index](../../catalog/creators/index.json) lists published profiles independently
of the theme catalog and pins each profile's SHA-256. Update the index when a
profile is added, removed or changed.

The [verified creator list](../../catalog/creators/verified.json) is maintained by the
project. A verified GitHub ID marks the creator and their themes as official.
Keep this list separate from editable profiles.

Maintainers can add a numeric GitHub ID and a public moderation message to
[`catalog/creators/blocked.json`](../../catalog/creators/blocked.json). N-Zik shows that message when
the account tries to connect or submit a profile. The repository workflow closes
pull requests from listed accounts and posts the same message. Keep private
information out of these messages.
