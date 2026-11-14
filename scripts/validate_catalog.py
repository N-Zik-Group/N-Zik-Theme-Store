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


BASE_SCENES = ("player", "queue", "lyrics", "home", "navigation", "album", "artist",
               "playlist", "local-playlist", "search", "search-albums", "search-artists")
PREVIEW_ROLES = {"player": "player", "queue": "queue", "navigation": "navigation"}


def validate_gallery(manifest):
    previews = {}
    for preview in manifest["previews"]:
        stem = Path(preview["path"]).stem
        scene, _, variant = stem.rpartition("-")
        if not scene or variant not in {"normal", "glass"}:
            raise ValueError(f'{manifest["title"]}: name previews <screen>-normal or <screen>-glass')
        if stem in previews:
            raise ValueError(f'{manifest["title"]}: duplicate preview variant {stem}')
        if preview["role"] != PREVIEW_ROLES.get(scene, "other"):
            raise ValueError(f'{manifest["title"]}: incorrect preview role for {stem}')
        previews[stem] = preview
    missing = [f"{scene}-{variant}" for scene in BASE_SCENES
               for variant in ("normal", "glass") if f"{scene}-{variant}" not in previews]
    if missing:
        raise ValueError(f'{manifest["title"]}: missing previews: {", ".join(missing)}')


def validate_reviews(folder, validator):
    path = folder / "reviews.json"
    reviews = validate_json(path, validator)["reviews"]
    author_ids = [review["author"]["githubId"] for review in reviews]
    if len(author_ids) != len(set(author_ids)):
        raise ValueError(f"{path}: duplicate review author")


def main():
    manifest_validator = load_schema("theme")
    appearance_validator = load_schema("appearance")
    catalog = validate_json(ROOT / "catalog" / "index.json", load_schema("catalog"))
    reviews_validator = load_schema("reviews")
    example = ROOT / "examples" / "theme-v1"
    validate_theme(example, manifest_validator, appearance_validator)
    validate_reviews(example, reviews_validator)

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
        validate_gallery(manifest)
        if (folder / "reviews.json").exists():
            validate_reviews(folder, reviews_validator)
        if (manifest["themeId"], manifest["revision"]) != (theme_id, revision):
            raise ValueError(f"{folder}: manifest ID or revision differs from the catalog")

    print(f"Validated the v1 schemas, the example and {len(theme_ids)} published themes.")


if __name__ == "__main__":
    main()
