import hashlib
import json
from pathlib import Path

from jsonschema import Draft202012Validator


ROOT = Path(__file__).resolve().parents[1]


def load_json(path):
    return json.loads(path.read_bytes())


def load_schema(name):
    schema = load_json(ROOT / "schemas" / "v1" / f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_json(path, validator):
    document = load_json(path)
    errors = list(validator.iter_errors(document))
    if errors:
        error = errors[0]
        raise ValueError(f"{path} at {error.json_path}: {error.message}")
    return document


def check_hash(path, expected):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise ValueError(f"{path}: SHA-256 mismatch")


def validate_theme(folder, manifest_validator, appearance_validator):
    manifest = validate_json(folder / "manifest.json", manifest_validator)
    appearance = manifest["appearance"]
    appearance_path = folder / appearance["path"]
    check_hash(appearance_path, appearance["sha256"])
    validate_json(appearance_path, appearance_validator)

    preview_paths = set()
    for preview in manifest["previews"]:
        path = preview["path"]
        if path in preview_paths:
            raise ValueError(f"{folder}: duplicate preview {path}")
        preview_paths.add(path)
        check_hash(folder / path, preview["sha256"])
    return manifest


# Revision 3 contains the original two player captures. New official revisions
# must include the complete base gallery; Glass and conditional scenes may vary.
OFFICIAL_NORMAL_SCENES = ("player", "queue", "navigation", "home", "search", "album")
OFFICIAL_PREVIEW_ROLES = {"player": "player", "queue": "queue", "navigation": "navigation"}


def validate_official_gallery(manifest):
    if manifest["author"]["login"].lower() != "n-zik-group" or "built-in" not in manifest["tags"]:
        return
    if manifest["revision"] <= 3:
        return
    previews = {}
    for preview in manifest["previews"]:
        stem = Path(preview["path"]).stem
        scene, _, variant = stem.rpartition("-")
        if not scene or variant not in {"normal", "glass"}:
            raise ValueError(f'{manifest["title"]}: name previews <screen>-normal or <screen>-glass')
        if stem in previews:
            raise ValueError(f'{manifest["title"]}: duplicate preview variant {stem}')
        if preview["role"] != OFFICIAL_PREVIEW_ROLES.get(scene, "other"):
            raise ValueError(f'{manifest["title"]}: incorrect preview role for {stem}')
        previews[stem] = preview
    missing = [scene for scene in OFFICIAL_NORMAL_SCENES if f"{scene}-normal" not in previews]
    if missing:
        raise ValueError(f'{manifest["title"]}: missing Normal previews: {", ".join(missing)}')
    for stem in previews:
        if not stem.endswith("-glass"):
            continue
        normal = previews.get(stem.removesuffix("-glass") + "-normal")
        if not normal or previews[stem]["sha256"] == normal["sha256"]:
            raise ValueError(f'{manifest["title"]}: {stem} needs a distinct Normal counterpart')


def main():
    manifest_validator = load_schema("theme")
    appearance_validator = load_schema("appearance")
    catalog = validate_json(ROOT / "catalog" / "index.json", load_schema("catalog"))
    validate_theme(ROOT / "examples" / "theme-v1", manifest_validator, appearance_validator)

    theme_ids = set()
    for entry in catalog["themes"]:
        theme_id = entry["themeId"]
        revision = entry["revision"]
        if theme_id in theme_ids:
            raise ValueError(f"catalog: duplicate theme ID {theme_id}")
        theme_ids.add(theme_id)
        folder = ROOT / "themes" / theme_id / str(revision)
        check_hash(folder / "manifest.json", entry["manifestSha256"])
        manifest = validate_theme(folder, manifest_validator, appearance_validator)
        validate_official_gallery(manifest)
        if (manifest["themeId"], manifest["revision"]) != (theme_id, revision):
            raise ValueError(f"{folder}: manifest ID or revision differs from the catalog")

    print(f"Validated the v1 schemas, the example and {len(theme_ids)} published themes.")


if __name__ == "__main__":
    main()
