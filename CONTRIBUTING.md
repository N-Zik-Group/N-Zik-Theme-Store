# 🤝 Contributing to the Theme Store

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use the [issue forms](https://github.com/N-Zik-Group/N-Zik-Theme-Store/issues/new/choose) for catalog bugs and tooling ideas. Submit theme changes as pull requests into `main`.

## Submit a theme

Your creator profile must be accepted and published in the creator catalog before a theme can be published. A pending profile pull request does not qualify. If a maintainer accepts a theme first, the bot keeps that approved revision waiting and retries it after the profile is published. Changes to the theme or a withdrawn acceptance require a fresh review.

1. Fork the repository. Use the [worked example](demo/examples/theme-v1/) and [format guide](demo/examples/theme-format.md) to prepare a manifest and appearance file under `catalog/themes/<themeId>/1/`. Choose a new lowercase UUID and include your numeric GitHub ID and login.
2. Put your Normal and Glass preview files in the revision's `previews/` folder. Label them by role and publish only images you have permission to share. Follow the [preview coverage checklist](demo/examples/theme-format.md#preview-coverage) for every submission. You may add extra views. Use demo content to keep private information out of public images.
3. Set the SHA-256 of the exact appearance and preview files in the manifest, then add the manifest's SHA-256 to the index for that format ([V3](catalog/themes/index-v3.json), [V2](catalog/themes/index-v2.json), or [V1](catalog/themes/index.json)).
4. Run `uv run --no-project --with-requirements requirements-validation.txt python .github/scripts/validate_catalog.py` and open a PR. The maintainer verifies authorship, licensing, media and compatibility before merging.

The `Stock` and `Built-in` tags are reserved for verified N-Zik creators, including variants in capitalization, accents, or punctuation.

Pull request catalog scans run automatically using validators, dependencies, schemas and demo assets from the trusted base branch. They validate merged catalog data without executing code from the fork. Proposed changes to validation code, schemas or demo tooling need separate review; the full repository tests run on `main` pushes and manual runs.

The Theme Store remains **Beta**. V1 publication accepts Android version codes 97–98 in `compatibility.minVersionCode`. V2 publication requires at least 99, and V3 requires at least 101. Set the manifest and appearance to the same schema version. Keep `schemaVersion: 1` in each index envelope.

Compute hashes with `sha256sum <path>` on Linux or `Get-FileHash <path> -Algorithm SHA256` in PowerShell. Use lowercase hashes in JSON. The [README](README.md) explains compatibility and the file layout.

## Update or withdraw a theme

- **Update:** Keep the same ID and author. Submit a new numbered revision, keep older directories intact, and update the index entry. A theme's first publication in a newer format continues from its latest indexed revision. Maintainer corrections to the initial Beta catalog may update revision 1 and its manifest hash together.
- **Withdraw:** Submit the request from N-Zik, or open a PR from a `nzik/withdraw-<themeId>` branch on your own fork. Remove your theme's entry from each index that lists it. Moderation checks the numeric GitHub ID in each listed manifest before accepting the request. Once accepted, the bot removes all published revisions of that theme from the current branch. For sensitive material in Git history, contact a moderator privately.

## Licensing

The Theme Store, its themes and their previews are released under [GPL-3.0-only](LICENSE). Include any attribution and license notices required for the material you contribute.
