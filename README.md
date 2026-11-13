<div align="center">
  <img alt="N-Zik project banner" src="https://raw.githubusercontent.com/N-Zik-Group/N-Zik/main/assets/design/ic_banner2.png" width="1080" />

  <h3>🌐 <a href="https://n-zik.vercel.app/">Official Website</a></h3>
  <p>
    <b>N-Zik Theme Store</b> is the community appearance catalog for <a href="https://github.com/N-Zik-Group/N-Zik">N-Zik on Android</a>.
  </p>
  <p>
    Find theme configurations and preview images for the player, queue and navigation.
  </p>
</div>

<div align="center">

[![License: GPL v3](https://img.shields.io/github/license/N-Zik-Group/N-Zik-Theme-Store?style=flat&color=blue)](LICENSE)

</div>

# 🎨 Browse themes

The [catalog index](catalog/index.json) lists the current revision of each theme. Its manifest shows the author, included files, license and minimum compatible N-Zik version. The six built-in presets are listed while release compatibility is pending.

<div align="center">

## 📚 Documentation

[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-8d5cff?style=flat)](https://deepwiki.com/N-Zik-Group/N-Zik-Theme-Store)

[Theme format and repository layout](docs/theme-format.md) · [Contribution guide](CONTRIBUTING.md)

## 🌍 Community

Join the N-Zik Discord:

<a href="https://discord.gg/bneHC7QRje">
  <img src="https://discord.com/api/guilds/1345079801324634193/widget.png?style=banner2" alt="Discord Server">
</a>

</div>

# 🎧 Features

- Versioned themes for colors, the player and queue, navigation, and Glass.
- Appearance categories that can be applied individually by compatible versions of N-Zik.
- Community submissions and updates published after manual review.

# 📷 Screenshots

Compare the six built-in presets in Normal and Glass mode. All screenshots use the same demonstration track and artwork.

<h3 align="center"><a href="themes/99edc843-6a9b-5753-8e76-cc11fe9b3295/1/manifest.json">Blurred Cover</a></h3>

<p align="center">
  <a href="docs/previews/blurred-cover.webp"><img src="docs/previews/blurred-cover.webp" width="185" alt="Blurred Cover in Normal mode" /></a>
  <a href="docs/previews/blurred-cover-glass.webp"><img src="docs/previews/blurred-cover-glass.webp" width="185" alt="Blurred Cover in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

<h3 align="center"><a href="themes/8f13dfe9-5dc9-5dc3-b563-aa9f11cf67b7/1/manifest.json">Carousel</a></h3>

<p align="center">
  <a href="docs/previews/carousel.webp"><img src="docs/previews/carousel.webp" width="185" alt="Carousel in Normal mode" /></a>
  <a href="docs/previews/carousel-glass.webp"><img src="docs/previews/carousel-glass.webp" width="185" alt="Carousel in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

<h3 align="center"><a href="themes/8d06299d-a4c1-5dc7-bf21-8694af77ae36/1/manifest.json">Coverless</a></h3>

<p align="center">
  <a href="docs/previews/coverless.webp"><img src="docs/previews/coverless.webp" width="185" alt="Coverless in Normal mode" /></a>
  <a href="docs/previews/coverless-glass.webp"><img src="docs/previews/coverless-glass.webp" width="185" alt="Coverless in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

<h3 align="center"><a href="themes/e9fb0ce8-3b8d-5c96-9d00-f4d5f1fdcf4a/1/manifest.json">Audio Waves</a></h3>

<p align="center">
  <a href="docs/previews/audio-waves.webp"><img src="docs/previews/audio-waves.webp" width="185" alt="Audio Waves in Normal mode" /></a>
  <a href="docs/previews/audio-waves-glass.webp"><img src="docs/previews/audio-waves-glass.webp" width="185" alt="Audio Waves in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

<h3 align="center"><a href="themes/1a59f7da-312a-52a4-93f3-8e469a987709/1/manifest.json">Pitch Black Gradient</a></h3>

<p align="center">
  <a href="docs/previews/pitch-black-gradient.webp"><img src="docs/previews/pitch-black-gradient.webp" width="185" alt="Pitch Black Gradient in Normal mode" /></a>
  <a href="docs/previews/pitch-black-gradient-glass.webp"><img src="docs/previews/pitch-black-gradient-glass.webp" width="185" alt="Pitch Black Gradient in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

<h3 align="center"><a href="themes/481186ac-8178-55b6-a20d-a01dbc5efe64/1/manifest.json">Artwork Gradient</a></h3>

<p align="center">
  <a href="docs/previews/artwork-gradient.webp"><img src="docs/previews/artwork-gradient.webp" width="185" alt="Artwork Gradient in Normal mode" /></a>
  <a href="docs/previews/artwork-gradient-glass.webp"><img src="docs/previews/artwork-gradient-glass.webp" width="185" alt="Artwork Gradient in Glass mode" /></a>
  <br />
  <b>Normal</b> · <b>Glass</b>
</p>

# 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to submit, update or withdraw a theme. See the [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md) for community standards and private reporting.

# 👀 Status

## 🛠️ Catalog checks

[![Validate catalog](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml)

Run `uv run --no-project --with-requirements requirements-validation.txt python scripts/validate_catalog.py` from the repository root. It checks the schemas, index, example and indexed revisions, including matching IDs, duplicate entries or preview paths, and file hashes.

## 🔄 Automation & Maintenance

[![Refresh contributor grid](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/readme-contributors.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/readme-contributors.yml)

[![Triage issues](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/triage-issues.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/triage-issues.yml)

# 👥 Contributors

<!-- project-contributors:start -->
<p align="center">
<a href="https://github.com/NEVARLeVrai"><img src="https://avatars.githubusercontent.com/u/63956787?v=4" width="54" height="54" alt="NEVARLeVrai" title="NEVARLeVrai" /></a>
</p>
<!-- project-contributors:end -->

See the [repository contributors](https://github.com/N-Zik-Group/N-Zik-Theme-Store/graphs/contributors). The original presets were introduced by [aneesh1122](https://github.com/N-Zik-Group/N-Zik/commit/ea40544986).

# 🎖️ Credits

Made with ❤️ by the N-Zik Group community · Project license: GPLv3 - see [LICENSE](LICENSE). Each theme declares its own license in its manifest.
