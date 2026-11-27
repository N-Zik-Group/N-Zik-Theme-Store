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
[![CodeFactor](https://www.codefactor.io/repository/github/n-zik-group/n-zik-theme-store/badge)](https://www.codefactor.io/repository/github/n-zik-group/n-zik-theme-store)

</div>

# 🎨 Browse themes

The [V3 catalog](catalog/themes/index-v3.json) lists revisions for N-Zik Android version code 101 and later. The [V2 catalog](catalog/themes/index-v2.json) remains available for code 99 and later, and the [V1 catalog](catalog/themes/index.json) serves codes 97–98. Each revision's manifest shows the author, included files and minimum compatible N-Zik version.

**Theme Store is in Beta**, including in the stable N-Zik 8.7.0 app. The V2 built-in gallery revisions require Android version code **99 or later**. Earlier builds continue to browse the V1 revisions.

<div align="center">

## 📚 Documentation

[![Ask DeepWiki](https://img.shields.io/badge/Ask-DeepWiki-8d5cff?style=flat)](https://deepwiki.com/N-Zik-Group/N-Zik-Theme-Store)

[Theme format and repository layout](demo/examples/theme-format.md) · [Contribution guide](CONTRIBUTING.md)

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

# 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to submit, update or withdraw a theme. See the [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md) for community standards and private reporting.

Use [the Theme Store issue forms](https://github.com/N-Zik-Group/N-Zik-Theme-Store/issues/new/choose) for catalog bugs, store features and moderation reports. See the [issue guide](https://github.com/N-Zik-Group/N-Zik-Theme-Store/issues/15) for where to report Android app issues.

### Set up your creator account in N-Zik

In versions with creator setup, open **Theme Store → Creator → Connect GitHub**. N-Zik signs you in, reuses your existing Theme Store fork or creates it if needed, then opens the N-Zik Sign In installation in the same panel.

On GitHub, choose your own account and select only your **N-Zik-Theme-Store** fork. This gives the moderation bot permission to clean up merged submission branches. N-Zik saves your sign-in after confirming N-Zik Sign In on your personal account. If it is already installed, you can reconnect without installing it again. The same GitHub controls are available in N-Zik's Services settings. After setup, open **App installation** in Creator to manage or revoke access in your personal GitHub settings. GitHub must allow **N-Zik Sign In** to be installed on any account so creators can grant access to their own forks.

# 👀 Status

[![N-Zik Roadmap](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/mobile-roadmap.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/mobile-roadmap.yml)

[![Roadmap Reconciliation](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/roadmap-reconcile.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/roadmap-reconcile.yml)

[N-Zik roadmap](https://github.com/orgs/N-Zik-Group/projects/1)

## 🛠️ Catalog checks

[![Validate catalog](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/validate-catalog.yml)

[![CodeQL](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/github-code-scanning/codeql)

[![GitHub Code Quality](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/github-code-quality/codeql/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/github-code-quality/codeql)

Run `uv run --no-project --with-requirements requirements-validation.txt python .github/scripts/validate_catalog.py` from the repository root. It checks the schemas, index, example and indexed revisions, including matching IDs, duplicate entries or preview paths, and file hashes.

## 🔄 Automation & Maintenance

[![Refresh contributor grid](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/readme-contributors.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/readme-contributors.yml)

[![Dependabot Updates](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/dependabot/dependabot-updates/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/dependabot/dependabot-updates)

[![Dependency Graph](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/dependabot/update-graph/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/dependabot/update-graph)

[![Moderate Theme Store reports](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/assign-reports.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/assign-reports.yml)

[![Blocked contributors and moderation](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/blocked-contributors.yml/badge.svg)](https://github.com/N-Zik-Group/N-Zik-Theme-Store/actions/workflows/blocked-contributors.yml)

[Repository labels](https://github.com/N-Zik-Group/N-Zik-Theme-Store/labels)

Submissions use `in review`, `accepted`, `merged`, `refused` or `ban`. Refusals and bans use a `reason:` label. Catalog reports are tagged `report` and assigned to a maintainer.

If fork cleanup fails after publication, the theme remains published and the pull request keeps `merged` plus `cleanup pending`. The bot records the approved commit and preserves newer branch work. Restore fork access, then rerun the approval job or run **Blocked contributors** manually with the pull request number. A successful retry removes `cleanup pending`. For older merged submissions without a cleanup record, the bot uses the approved head preserved in the merge commit. If that evidence is unavailable, it preserves the branch and reports the incomplete cleanup.

# 👥 Contributors

<!-- project-contributors:start -->
<p align="center">
<a href="https://github.com/NEVARLeVrai"><img src="https://avatars.githubusercontent.com/u/63956787?v=4" width="54" height="54" alt="NEVARLeVrai" title="NEVARLeVrai" /></a>
</p>

# 🎖️ Credits

Made with ❤️ by the N-Zik Group community · Project license: GPLv3 - see [LICENSE](LICENSE). The same license applies to the themes and their previews.
