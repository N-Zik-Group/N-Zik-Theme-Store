# 🤝 Contributing to the Theme Store

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Use the [issue forms](https://github.com/N-Zik-Group/N-Zik-Theme-Store/issues/new/choose) for catalog bugs and tooling ideas. Submit theme changes as pull requests into `main`.

## Submit a theme

1. Fork the repository. Use the [worked example](examples/theme-v1/) and [v1 schemas](schemas/v1/) to prepare a manifest and appearance file under `themes/<themeId>/1/`. Choose a new lowercase UUID and include your numeric GitHub ID and login.
2. Put your Normal and Glass preview files in the revision's `previews/` folder. Label them by role and publish only images you have permission to share. Follow the [preview coverage checklist](docs/theme-format.md#preview-coverage) for every submission. You may add extra views. Use demo content to keep private information out of public images.
3. Set the SHA-256 of the exact appearance and preview files in the manifest, then add the manifest's SHA-256 to [the index](catalog/index.json).
4. Run `uv run --no-project --with-requirements requirements-validation.txt python scripts/validate_catalog.py` and open a PR. The maintainer verifies authorship, licensing, media and compatibility before merging.

Compute hashes with `sha256sum <path>` on Linux or `Get-FileHash <path> -Algorithm SHA256` in PowerShell. Use lowercase hashes in JSON. The [README](README.md) explains compatibility and the file layout.

## Update or withdraw a theme

- **Update:** Keep the same ID and author. Before the stable release, update revision 1 and its manifest hash in the index. After the stable release, create the next revision directory, keep older directories intact, and update the index entry.
- **Withdraw:** Remove the entry from the index and explain the request in the PR. The revision directories preserve the publication history. Contact a moderator privately if removal involves sensitive material.

## Licensing

Repository tooling and documentation use [GPL-3.0](LICENSE). Themes and their previews carry the license recorded in their manifest. Include any attribution and license notices required for the material you contribute.
