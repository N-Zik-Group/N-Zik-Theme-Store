import hashlib
import io
import json
import re
import unicodedata
from decimal import Decimal
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError, validators
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / "catalog"
CATALOG_LIMIT = 512 * 1024
THEME_DOCUMENT_LIMIT = 128 * 1024
PREVIEW_LIMIT = 4 * 1024 * 1024
CATALOG_SNAPSHOT_LIMIT = 16 * 1024 * 1024
DEMO_INDEX_LIMIT = 8 * 1024
STOCK_INDEX_LIMIT = 64 * 1024
MINIMUM_PUBLISHED_VERSION_CODES = {1: 97, 2: 99}
LEGACY_MAX_VERSION_CODE = MINIMUM_PUBLISHED_VERSION_CODES[2] - 1


def validate_metadata_const(validator, expected, value, schema):
    if type(expected) is int and type(value) is not int:
        yield ValidationError(f"{value!r} must use JSON integer notation")
        return
    yield from Draft202012Validator.VALIDATORS["const"](validator, expected, value, schema)


MetadataValidator = validators.extend(
    Draft202012Validator,
    validators={"const": validate_metadata_const},
    type_checker=Draft202012Validator.TYPE_CHECKER.redefine("integer", lambda _, value: type(value) is int),
)

AppearanceValidator = validators.extend(
    Draft202012Validator,
    type_checker=Draft202012Validator.TYPE_CHECKER.redefine(
        "integer",
        lambda _, value: type(value) is int or isinstance(value, Decimal) and value == value.to_integral_value(),
    ),
)


def read_limited(path, limit):
    with path.open("rb") as source:
        content = source.read(limit + 1)
    if not 0 < len(content) <= limit:
        raise ValueError(f"{path}: file is empty or exceeds {limit} bytes")
    return content


def load_json(path, limit=CATALOG_LIMIT):
    def reject_nonfinite(value):
        raise ValueError(f"{path}: {value} is not a JSON number")

    def unique_members(pairs):
        members = {}
        for name, value in pairs:
            if name in members:
                raise ValueError(f"{path}: duplicate JSON member {name!r}")
            members[name] = value
        return members

    try:
        content = read_limited(path, limit).decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(f"{path}: expected UTF-8 JSON") from error
    if content.startswith("\ufeff"):
        raise ValueError(f"{path}: UTF-8 BOM is unsupported")
    return json.loads(content, parse_float=Decimal, parse_constant=reject_nonfinite, object_pairs_hook=unique_members)


def load_schema(name, version=1):
    schema = load_json(CATALOG / "schemas" / f"v{version}" / f"{name}.schema.json")
    Draft202012Validator.check_schema(schema)
    validator = AppearanceValidator if name == "appearance" else MetadataValidator
    return validator(schema)


def validate_json(path, validator, limit=CATALOG_LIMIT):
    document = load_json(path, limit)
    validate_document(path, document, validator)
    return document


def validate_document(path, document, validator):
    errors = list(validator.iter_errors(document))
    if errors:
        error = errors[0]
        raise ValueError(f"{path} at {error.json_path}: {error.message}")


def check_hash(path, expected, limit=CATALOG_LIMIT):
    content = read_limited(path, limit)
    if hashlib.sha256(content).hexdigest() != expected:
        raise ValueError(f"{path}: SHA-256 mismatch")
    return content


def validate_image(path, expected):
    content = check_hash(path, expected, PREVIEW_LIMIT)
    expected_format = {".jpg": "JPEG", ".png": "PNG", ".webp": "WEBP", ".gif": "GIF"}[path.suffix]
    try:
        with Image.open(io.BytesIO(content), formats=[expected_format]) as image:
            image.verify()
        with Image.open(io.BytesIO(content), formats=[expected_format]) as image:
            image.load()
    except (OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError(f"{path}: invalid {expected_format} image") from error


def validate_theme(folder, manifest_validator, appearance_validators, *, published=False):
    manifest = validate_json(folder / "manifest.json", manifest_validator)
    appearance = manifest["appearance"]
    appearance_path = folder / appearance["path"]
    check_hash(appearance_path, appearance["sha256"], THEME_DOCUMENT_LIMIT)
    document = load_json(appearance_path, THEME_DOCUMENT_LIMIT)
    version = document.get("schemaVersion") if isinstance(document, dict) else None
    if not isinstance(version, (int, Decimal)) or isinstance(version, bool) or version not in appearance_validators:
        raise ValueError(f"{appearance_path}: unsupported appearance schemaVersion {version!r}")
    validate_document(appearance_path, document, appearance_validators[version])
    if published:
        if version != manifest["schemaVersion"]:
            raise ValueError(f"{appearance_path}: manifest and appearance schema versions must match")
        validate_publication_compatibility(manifest, version, document)

    preview_paths = set()
    for preview in manifest["previews"]:
        path = preview["path"]
        if path in preview_paths:
            raise ValueError(f"{folder}: duplicate preview {path}")
        preview_paths.add(path)
        validate_image(folder / path, preview["sha256"])
    return manifest, document


BASE_SCENES = ("player", "queue", "lyrics", "home", "navigation", "album", "artist",
               "playlist", "local-playlist", "search", "search-albums", "search-artists")
PREVIEW_ROLES = {"player": "player", "queue": "queue", "navigation": "navigation"}
FIXED_DARK_PALETTES = {"pure-black", "modern-black"}


def validate_reserved_tags(manifest, verified_ids):
    if manifest["author"]["githubId"] in verified_ids:
        return
    for tag in manifest["tags"]:
        normalized = "".join(char for char in unicodedata.normalize("NFKD", tag).casefold() if char.isalnum())
        if normalized in {"stock", "builtin"}:
            raise ValueError(f'{manifest["title"]}: tag {tag!r} is reserved for verified N-Zik creators')


def validate_publication_compatibility(manifest, appearance_version, appearance=None):
    required_version_code = MINIMUM_PUBLISHED_VERSION_CODES[appearance_version]
    if (appearance or {}).get("categories", {}).get("colors", {}).get("mode") == "pure-black":
        if appearance_version != 2:
            raise ValueError("Pure Black mode requires appearance V2 for publication")
        required_version_code = max(required_version_code, 101)
    minimum = (manifest.get("compatibility") or {}).get("minVersionCode")
    if type(minimum) is not int or minimum < required_version_code:
        raise ValueError(f"Published themes must require Android version code {required_version_code} or later")
    if appearance_version == 1 and minimum > LEGACY_MAX_VERSION_CODE:
        raise ValueError(f"Published V1 themes cannot require an Android version code above {LEGACY_MAX_VERSION_CODE}")


def validate_gallery(manifest, *, colors=None):
    colors = colors or {}
    system_gallery = (manifest.get("schemaVersion") == 2 and colors.get("mode", "system") == "system"
                      and colors.get("palette") not in FIXED_DARK_PALETTES)
    previews = {}
    for preview in manifest["previews"]:
        stem = Path(preview["path"]).stem
        scene, _, variant = stem.rpartition("-")
        if not scene or variant not in {"normal", "glass"}:
            raise ValueError(f'{manifest["title"]}: name previews <screen>-normal or <screen>-glass')
        if stem in previews:
            raise ValueError(f'{manifest["title"]}: duplicate preview variant {stem}')
        base_scene, _, brightness = scene.rpartition("-")
        if system_gallery and brightness in {"light", "dark"}:
            scene = base_scene
        if preview["role"] != PREVIEW_ROLES.get(scene, "other"):
            raise ValueError(f'{manifest["title"]}: incorrect preview role for {stem}')
        previews[stem] = preview
    suffixes = ("-light", "-dark") if system_gallery else ("",)
    missing = [f"{scene}{suffix}-{variant}" for scene in BASE_SCENES for suffix in suffixes
               for variant in ("normal", "glass") if f"{scene}{suffix}-{variant}" not in previews]
    if missing:
        raise ValueError(f'{manifest["title"]}: missing previews: {", ".join(missing)}')
    paired_scenes = ("player-playing", "miniplayer-playing")
    if manifest.get("schemaVersion") == 2:
        paired_scenes += ("menu", "dialog")
    for scene in paired_scenes:
        names = [f"{scene}{suffix}-{variant}" for suffix in suffixes for variant in ("normal", "glass")]
        if any(name in previews for name in names):
            for name in names:
                if name not in previews:
                    raise ValueError(f'{manifest["title"]}: missing preview counterpart {name}')


def validate_reviews(folder, validator):
    path = folder / "reviews.json"
    reviews = validate_json(path, validator)["reviews"]
    author_ids = [review["author"]["githubId"] for review in reviews]
    if len(author_ids) != len(set(author_ids)):
        raise ValueError(f"{path}: duplicate review author")


def validate_creator(folder, validator, expected_id=None):
    path = folder / "profile.json"
    profile = validate_json(path, validator)
    if expected_id is not None and str(profile["githubId"]) != expected_id:
        raise ValueError(f"{path}: GitHub ID differs from the creator directory")
    for field in ("avatar", "banner"):
        media = profile[field]
        if media["source"] == "custom":
            asset = media["asset"]
            validate_image(folder / asset["path"], asset["sha256"])
    return profile


def validate_snapshot(index_path, manifest_paths):
    index = read_limited(index_path, CATALOG_LIMIT)
    remaining = CATALOG_SNAPSHOT_LIMIT - len(index)
    manifests = []
    for path in manifest_paths:
        content = read_limited(path, min(CATALOG_LIMIT, remaining))
        remaining -= len(content)
        manifests.append(content.decode("utf-8"))
    snapshot = {"index": index.decode("utf-8"), "manifests": manifests,
                "syncedAt": 9223372036854775807}
    encoded = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > CATALOG_SNAPSHOT_LIMIT:
        raise ValueError("catalog: encoded Android snapshot exceeds 16 MiB")


def load_demo_index(path, sections):
    index = load_json(path, DEMO_INDEX_LIMIT)
    if not isinstance(index, dict) or set(index) != {"schemaVersion", *sections}:
        raise ValueError(f"{path}: invalid demo index fields")
    if type(index["schemaVersion"]) is not int or index["schemaVersion"] != 1:
        raise ValueError(f"{path}: unsupported index version")
    for section in sections:
        entries = index[section]
        if not isinstance(entries, list):
            raise ValueError(f"{path}: {section} must be a list")
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"name", "sha256"}:
                raise ValueError(f"{path}: invalid demo asset fields in {section}")
            if not isinstance(entry["name"], str) or not isinstance(entry["sha256"], str):
                raise ValueError(f"{path}: demo asset name and SHA-256 must be strings")
            if re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None:
                raise ValueError(f"{path}: invalid demo asset SHA-256")
    return index


def validate_demo_assets():
    demo = ROOT / "demo" / "v1"
    palettes = ("atlas", "signal", "tide", "violet", "ember")
    covers = {f"{name}.jpg" for name in palettes}
    banners = {f"banners/{name}.webp" for name in palettes}

    def validate_assets(entries, expected):
        file_names = [entry["name"] for entry in entries]
        if len(file_names) != len(expected) or set(file_names) != expected:
            raise ValueError("demo: index does not match the required assets")
        for entry in entries:
            path = demo / entry["name"]
            if not 0 < path.stat().st_size <= 512 * 1024:
                raise ValueError(f"{path}: demo asset exceeds 512 KiB or is empty")
            check_hash(path, entry["sha256"])

    base = load_demo_index(demo / "index.json", ("assets",))
    visuals = load_demo_index(demo / "visuals.json", ("covers", "banners"))
    validate_assets(base["assets"], (covers - {"ember.jpg"}) | {"silence.mp3"})
    validate_assets(visuals["covers"], covers)
    validate_assets(visuals["banners"], banners)


STOCK_SCENES = (*BASE_SCENES, "player-playing", "miniplayer-playing", "menu", "dialog")
STOCK_PREVIEW_PATHS = {
    f"previews/{scene}-{brightness}-{variant}.webp"
    for scene in STOCK_SCENES for brightness in ("light", "dark") for variant in ("normal", "glass")
}


def validate_stock_previews(folder=None):
    folder = ROOT / "demo" / "stock" if folder is None else Path(folder)
    path = folder / "index.json"
    index = load_json(path, STOCK_INDEX_LIMIT)
    if not isinstance(index, dict) or set(index) != {"schemaVersion", "previews"}:
        raise ValueError(f"{path}: invalid Stock index fields")
    if type(index["schemaVersion"]) is not int or index["schemaVersion"] != 1:
        raise ValueError(f"{path}: unsupported Stock index version")
    entries = index["previews"]
    if not isinstance(entries, list) or len(entries) != 64:
        raise ValueError(f"{path}: Stock requires exactly 64 previews")
    paths = set()
    for entry in entries:
        if (not isinstance(entry, dict) or not {"path", "role", "sha256"} <= set(entry)
                or set(entry) - {"path", "role", "sha256", "caption"}):
            raise ValueError(f"{path}: invalid Stock preview fields")
        name = entry["path"]
        if not isinstance(name, str) or name not in STOCK_PREVIEW_PATHS or name in paths:
            raise ValueError(f"{path}: invalid or duplicate Stock preview path")
        paths.add(name)
        scene = name.removeprefix("previews/").rsplit("-", 2)[0]
        if entry["role"] != PREVIEW_ROLES.get(scene, "other"):
            raise ValueError(f"{path}: incorrect Stock preview role")
        if not isinstance(entry["sha256"], str) or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None:
            raise ValueError(f"{path}: invalid Stock preview SHA-256")
        if "caption" in entry and (not isinstance(entry["caption"], str) or len(entry["caption"]) > 160):
            raise ValueError(f"{path}: invalid Stock preview caption")
        image_path = folder / name
        if image_path.is_symlink() or image_path.parent.is_symlink():
            raise ValueError(f"{image_path}: Stock assets cannot be symlinks")
        validate_image(image_path, entry["sha256"])
        with Image.open(image_path, formats=["WEBP"]) as image:
            if image.size != (862, 1920) or getattr(image, "n_frames", 1) != 1:
                raise ValueError(f"{image_path}: Stock previews must be static 862x1920 WebP")
    if paths != STOCK_PREVIEW_PATHS:
        raise ValueError(f"{path}: incomplete Stock scene matrix")
    files = {p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file()}
    if files != {"index.json", *STOCK_PREVIEW_PATHS}:
        raise ValueError(f"{folder}: unexpected Stock assets")
    return index


def validate_theme_index(index_path, version, appearance_validators, verified_ids, creator_ids):
    catalog = validate_json(index_path, load_schema("catalog", version))
    manifest_validator = load_schema("theme", version)
    theme_ids = set()
    manifest_paths = []
    for entry in catalog["themes"]:
        theme_id = entry["themeId"]
        revision = entry["revision"]
        if theme_id in theme_ids:
            raise ValueError(f"{index_path}: duplicate theme ID {theme_id}")
        theme_ids.add(theme_id)
        folder = index_path.parent / theme_id / str(revision)
        manifest_path = folder / "manifest.json"
        manifest_paths.append(manifest_path)
        check_hash(manifest_path, entry["manifestSha256"])
        manifest, appearance = validate_theme(folder, manifest_validator, appearance_validators, published=True)
        if manifest["author"]["githubId"] not in creator_ids:
            raise ValueError(f"{manifest_path}: the creator profile must be published before its themes")
        if version == 2 and len(manifest["previews"]) > catalog["previewLimit"]:
            raise ValueError(f"{manifest_path}: gallery exceeds the catalog previewLimit of {catalog['previewLimit']}")
        validate_gallery(manifest, colors=appearance["categories"].get("colors"))
        validate_reserved_tags(manifest, verified_ids)
        if (manifest["themeId"], manifest["revision"]) != (theme_id, revision):
            raise ValueError(f"{folder}: manifest ID or revision differs from the catalog")
    validate_snapshot(index_path, manifest_paths)
    return theme_ids


def main():
    validate_demo_assets()
    validate_stock_previews()
    manifest_validator = load_schema("theme")
    appearance_validators = {version: load_schema("appearance", version) for version in MINIMUM_PUBLISHED_VERSION_CODES}
    reviews_validator = load_schema("reviews")
    creator_validator = load_schema("creator")
    official = validate_json(CATALOG / "creators" / "verified.json", load_schema("verified-creators"))
    verified_ids = set(official["githubIds"])
    blocked = validate_json(CATALOG / "creators" / "blocked.json", load_schema("blocked-creators"))
    blocked_ids = [entry["githubId"] for entry in blocked["accounts"]]
    if len(blocked_ids) != len(set(blocked_ids)):
        raise ValueError("creators: duplicate blocked GitHub ID")
    validate_creator(ROOT / "demo" / "examples" / "creator-v1", creator_validator)
    creator_ids = set()
    creator_root = CATALOG / "creators"
    index = validate_json(creator_root / "index.json", load_schema("creators-index"))
    for entry in index["creators"]:
        github_id = entry["githubId"]
        if github_id in creator_ids:
            raise ValueError(f"creators: duplicate GitHub ID {github_id}")
        folder = creator_root / str(github_id)
        check_hash(folder / "profile.json", entry["profileSha256"])
        validate_creator(folder, creator_validator, folder.name)
        creator_ids.add(github_id)
    if {p.name for p in creator_root.iterdir() if p.is_dir()} != {str(i) for i in creator_ids}:
        raise ValueError("creators: index and profile directories differ")
    example = ROOT / "demo" / "examples" / "theme-v1"
    validate_theme(example, manifest_validator, appearance_validators)
    validate_reviews(example, reviews_validator)

    themes = CATALOG / "themes"
    legacy_theme_ids = validate_theme_index(themes / "index.json", 1, appearance_validators, verified_ids, creator_ids)
    current_theme_ids = validate_theme_index(themes / "index-v2.json", 2, appearance_validators, verified_ids, creator_ids)

    for reviews in (CATALOG / "themes").glob("*/*/reviews.json"):
        if not (reviews.parent / "manifest.json").is_file():
            raise ValueError(f"{reviews}: missing revision manifest")
        validate_reviews(reviews.parent, reviews_validator)

    print(f"Validated the schemas, examples, {len(legacy_theme_ids)} V1 and {len(current_theme_ids)} V2 theme listings, "
          f"and {len(creator_ids)} creators.")


if __name__ == "__main__":
    main()
