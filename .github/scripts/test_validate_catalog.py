import hashlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jsonschema import Draft202012Validator
from PIL import Image

import validate_catalog as catalog

MINIMAL_THEME_ID = "791a6aa9-72e1-43eb-997a-7d3ce3130d1f"


class CatalogValidationTest(unittest.TestCase):
    @staticmethod
    def image_bytes(image_format):
        buffer = io.BytesIO()
        Image.new("RGB", (8, 8), "purple").save(buffer, image_format)
        return buffer.getvalue()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)
        self.manifest = catalog.load_json(catalog.ROOT / "demo/examples/theme-v1/manifest.json")
        self.appearance = (catalog.ROOT / "demo/examples/theme-v1/appearance.json").read_bytes()

    def write_json(self, name, document):
        path = self.folder / name
        path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        return path

    def validate_theme(self, *, published=False):
        appearances = {version: catalog.load_schema("appearance", version) for version in (1, 2, 3)}
        return catalog.validate_theme(
            self.folder, catalog.load_schema("theme", self.manifest["schemaVersion"]), appearances, published=published
        )

    def write_theme(self, appearance=None):
        appearance = self.appearance if appearance is None else appearance
        (self.folder / "appearance.json").write_bytes(appearance)
        self.manifest["appearance"]["sha256"] = hashlib.sha256(appearance).hexdigest()
        self.write_json("manifest.json", self.manifest)

    def test_appearance_limit_includes_json_whitespace(self):
        at_limit = self.appearance.ljust(catalog.THEME_DOCUMENT_LIMIT, b" ")
        self.write_theme(at_limit)
        self.validate_theme()
        self.write_theme(at_limit + b" ")
        with self.assertRaisesRegex(ValueError, "exceeds 131072 bytes"):
            self.validate_theme()

    def test_publication_requires_code_97_while_v1_remains_readable(self):
        validator = catalog.load_schema("theme")
        for minimum in (None, 1, 96, 97, 98):
            with self.subTest(minimum=minimum):
                self.manifest["compatibility"] = {"minVersionCode": minimum}
                self.assertTrue(validator.is_valid(self.manifest))
                if minimum is not None and minimum >= 97:
                    catalog.validate_publication_compatibility(self.manifest, 1)
                else:
                    with self.assertRaisesRegex(ValueError, "version code 97"):
                        catalog.validate_publication_compatibility(self.manifest, 1)
        for compatibility in ({}, {"minVersionCode": "97"}, {"minVersionCode": 97.0}):
            self.manifest["compatibility"] = compatibility
            with self.assertRaisesRegex(ValueError, "version code 97"):
                catalog.validate_publication_compatibility(self.manifest, 1)
        del self.manifest["compatibility"]
        with self.assertRaisesRegex(ValueError, "version code 97"):
            catalog.validate_publication_compatibility(self.manifest, 1)
        self.manifest["compatibility"] = {"minVersionCode": 99}
        self.assertTrue(validator.is_valid(self.manifest))
        with self.assertRaisesRegex(ValueError, "above 98"):
            catalog.validate_publication_compatibility(self.manifest, 1)

    def test_v2_appearance_selects_android_code_99_at_publication(self):
        appearance = b'{"schemaVersion": 2, "categories": {"colors": {"palette": "dynamic", "mode": "system"}}}'
        self.manifest["schemaVersion"] = 2
        for minimum in (None, 97, 98, 99, 100):
            with self.subTest(minimum=minimum):
                self.manifest["compatibility"]["minVersionCode"] = minimum
                self.write_theme(appearance)
                if minimum is not None and minimum >= 99:
                    self.validate_theme(published=True)
                else:
                    with self.assertRaisesRegex(ValueError, "version code 99"):
                        self.validate_theme(published=True)

    def test_v3_action_slots_are_required_distinct_and_gated(self):
        path = catalog.CATALOG / "themes" / MINIMAL_THEME_ID / "2" / "appearance.json"
        appearance = catalog.load_json(path, catalog.THEME_DOCUMENT_LIMIT)
        player = appearance["categories"]["playerAndQueue"]
        validator = catalog.load_schema("appearance", 3)
        self.assertTrue(validator.is_valid(appearance))
        for slots in (["none", "audioVideo", "none"], ["menu", "discover", "start-radio"]):
            player["topActionSlots"] = slots
            self.assertTrue(validator.is_valid(appearance))
        for slots in ([], ["none", "none"], ["none"] * 4, ["none", "none", "invalid"], ["menu", "none", "menu"]):
            player["topActionSlots"] = slots
            self.assertFalse(validator.is_valid(appearance))
        player["topActionSlots"] = ["none"] * 3
        for old_key, old_value in (("showTopActionsBar", True), ("actionBarOrder", ["menu"])):
            player[old_key] = old_value
            self.assertFalse(validator.is_valid(appearance))
            del player[old_key]
        del player["topActionSlots"]
        self.assertFalse(validator.is_valid(appearance))
        with self.assertRaisesRegex(ValueError, "version code 101"):
            catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 100}}, 3, appearance)
        catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 101}}, 3, appearance)

    def test_v3_minimal_has_a_complete_system_gallery(self):
        path = catalog.CATALOG / "themes" / MINIMAL_THEME_ID
        manifest = catalog.load_json(path / "2" / "manifest.json")
        colors = catalog.load_json(path / "2" / "appearance.json")["categories"]["colors"]
        catalog.validate_gallery(manifest, colors=colors)
        with self.assertRaisesRegex(ValueError, "missing preview"):
            catalog.validate_gallery({**manifest, "previews": manifest["previews"][:-1]}, colors=colors)
        legacy = catalog.load_json(path / "1" / "manifest.json")
        catalog.validate_gallery(legacy, colors=colors)

    def test_v3_bottom_toolbar_can_include_audio_video_with_an_optional_switch(self):
        path = catalog.CATALOG / "themes" / MINIMAL_THEME_ID / "2" / "appearance.json"
        appearance = catalog.load_json(path, catalog.THEME_DOCUMENT_LIMIT)
        player = appearance["categories"]["playerAndQueue"]
        validator = catalog.load_schema("appearance", 3)
        self.assertEqual(14, len(player["bottomActionOrder"]))
        self.assertIn("audioVideo", player["bottomActionOrder"])
        self.assertTrue(player["actionButtons"].pop("audioVideo"))
        self.assertTrue(validator.is_valid(appearance))
        for value in (True, False):
            player["actionButtons"]["audioVideo"] = value
            self.assertTrue(validator.is_valid(appearance))
        player["actionButtons"]["audioVideo"] = "false"
        self.assertFalse(validator.is_valid(appearance))
        player["actionButtons"]["audioVideo"] = True
        player["bottomActionOrder"].append("audioVideo")
        self.assertFalse(validator.is_valid(appearance))

    def test_v3_cover_dimming_fields_are_optional_and_bounded(self):
        path = catalog.CATALOG / "themes" / MINIMAL_THEME_ID / "2" / "appearance.json"
        appearance = catalog.load_json(path, catalog.THEME_DOCUMENT_LIMIT)
        player = appearance["categories"]["playerAndQueue"]
        lyrics = player["lyrics"]
        validator = catalog.load_schema("appearance", 3)
        self.assertTrue(validator.is_valid(appearance))

        lyrics["coverDimmingEnabled"] = False
        for target, field in ((player, "visualizerCoverDimmingOpacity"), (lyrics, "coverDimmingOpacity")):
            for value in (0, 0.45, 1, -0.01, 1.01, "0.45"):
                with self.subTest(field=field, value=value):
                    target[field] = value
                    self.assertEqual(isinstance(value, (int, float)) and 0 <= value <= 1,
                                     validator.is_valid(appearance))
            target[field] = 0.45
        lyrics["coverDimmingEnabled"] = "false"
        self.assertFalse(validator.is_valid(appearance))
        lyrics["coverDimmingEnabled"] = True
        with self.assertRaisesRegex(ValueError, "version code 101"):
            catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 100}}, 3, appearance)
        catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 101}}, 3, appearance)

    def test_pure_black_mode_requires_v2_and_publication_code_101(self):
        appearance = {"schemaVersion": 1, "categories": {"colors": {
            "palette": "dynamic", "mode": "pure-black"}}}
        self.assertFalse(catalog.load_schema("appearance", 1).is_valid(appearance))
        appearance["schemaVersion"] = 2
        self.assertTrue(catalog.load_schema("appearance", 2).is_valid(appearance))
        self.manifest["schemaVersion"] = 2
        for minimum in (98, 99, 100, 101):
            with self.subTest(minimum=minimum):
                self.manifest["compatibility"]["minVersionCode"] = minimum
                self.write_theme(json.dumps(appearance).encode())
                self.validate_theme()
                if minimum >= 101:
                    self.validate_theme(published=True)
                else:
                    with self.assertRaisesRegex(ValueError, "version code 101"):
                        self.validate_theme(published=True)
        appearance["categories"]["colors"] = {"palette": "pure-black", "mode": "dark"}
        self.manifest["compatibility"]["minVersionCode"] = 99
        self.write_theme(json.dumps(appearance).encode())
        self.validate_theme(published=True)

    def test_optional_v2_custom_toolbars_require_supporting_android_version(self):
        toolbars = {"custom": {"albumOnline": {
            "order": ["enqueue", "bookmark"],
            "visibility": {"bookmark": False},
        }}}
        appearance = {"schemaVersion": 2, "categories": {"navigation": {
            "position": "bottom-floating", "labels": "icon-only", "toolbars": toolbars,
        }}}
        validator = catalog.load_schema("appearance", 2)
        self.assertTrue(validator.is_valid(appearance))
        with self.assertRaisesRegex(ValueError, "version code 101"):
            catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 100}}, 2, appearance)
        catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 101}}, 2, appearance)
        toolbars["custom"]["albumOnline"]["order"].append("notifications")
        self.assertFalse(validator.is_valid(appearance))
        toolbars["custom"]["albumOnline"]["order"].pop()
        toolbars["custom"]["albumOnline"]["visibility"]["notifications"] = True
        self.assertFalse(validator.is_valid(appearance))

    def test_v2_toolbars_accept_new_artist_library_and_on_device_actions(self):
        appearance = {"schemaVersion": 2, "categories": {"navigation": {
            "position": "bottom-floating", "labels": "icon-only", "toolbars": {"custom": {
                "artistLibrary": {
                    "order": ["playNext", "select", "addToPlaylist"],
                    "visibility": {"playNext": True, "select": True, "addToPlaylist": False},
                },
                "artistDevice": {
                    "order": ["follow", "addToPlaylist"],
                    "visibility": {"addToPlaylist": True},
                },
                "albumDevice": {
                    "order": ["bookmark", "search", "addToPlaylist"],
                    "visibility": {"search": True, "addToPlaylist": True},
                },
            }},
        }}}
        self.assertTrue(catalog.load_schema("appearance", 2).is_valid(appearance))

    def test_v2_burger_shortcuts_require_supporting_android_version(self):
        burger_menu = {"order": ["search", "history", "notifications"], "search": True, "notifications": False}
        appearance = {"schemaVersion": 2, "categories": {"navigation": {
            "position": "bottom-floating", "labels": "icon-only", "burgerMenu": burger_menu,
        }}}
        validator = catalog.load_schema("appearance", 2)
        self.assertTrue(validator.is_valid(appearance))
        with self.assertRaisesRegex(ValueError, "version code 101"):
            catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 100}}, 2, appearance)
        catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 101}}, 2, appearance)
        burger_menu["order"].append("search")
        self.assertFalse(validator.is_valid(appearance))

    def test_v2_player_preferences_and_retired_video_fields(self):
        appearance = json.loads(self.appearance)
        self.assertTrue(catalog.load_schema("appearance").is_valid(appearance))
        appearance["schemaVersion"] = 2
        player = appearance["categories"]["playerAndQueue"]
        v2 = catalog.load_schema("appearance", 2)
        self.assertFalse(v2.is_valid(appearance))
        del player["actionButtons"]["video"]
        self.assertTrue(v2.is_valid(appearance))
        player.update(openingMode="remember-last", holdToSpeedUp=True, holdToSpeedUpRate=1.1)
        self.write_theme(json.dumps(appearance).encode())
        self.validate_theme()
        self.manifest["compatibility"]["minVersionCode"] = 100
        catalog.validate_publication_compatibility(self.manifest, 2, appearance)
        for enabled in (True, False):
            with self.subTest(m3e_shapes=enabled):
                player["m3eAlwaysShowShapes"] = enabled
                self.assertTrue(v2.is_valid(appearance))
                with self.assertRaisesRegex(ValueError, "version code 101"):
                    catalog.validate_publication_compatibility(self.manifest, 2, appearance)
                catalog.validate_publication_compatibility({"compatibility": {"minVersionCode": 101}}, 2, appearance)
        del player["m3eAlwaysShowShapes"]
        for field, value in (("openingMode", "automatic"), ("holdToSpeedUp", 1),
                             ("holdToSpeedUpRate", 1.09), ("holdToSpeedUpRate", 4.01),
                             ("actionBarOrder", ["video"])):
            with self.subTest(field=field, value=value):
                invalid_player = {**player, field: value}
                self.assertFalse(v2.is_valid({**appearance, "categories": {"playerAndQueue": invalid_player}}))
        for container in ("buttonOrder", "visibleButtons"):
            with self.subTest(container=container):
                visible_buttons = (
                    "playPause", "skipBack", "skipForward", "shuffle", "repeat", "like", "addToPlaylist",
                    "download", "share", "radio", "audioOutput", "sleepTimer", "lyrics", "visualizer",
                    "queue", "discover",
                )
                mini_player = {
                    "type": "essential",
                    "buttonOrder": ["queue"],
                    "visibleButtons": dict.fromkeys(visible_buttons, True),
                }
                player["miniPlayer"] = mini_player
                self.assertTrue(v2.is_valid(appearance))
                if container == "buttonOrder":
                    mini_player["buttonOrder"].append("video")
                else:
                    mini_player["visibleButtons"]["video"] = True
                self.assertFalse(v2.is_valid(appearance))

    def test_preview_limit_is_checked_even_when_hash_matches(self):
        (self.folder / "previews").mkdir()
        for size in (catalog.PREVIEW_LIMIT, catalog.PREVIEW_LIMIT + 1):
            content = self.image_bytes("WEBP").ljust(size, b" ")
            (self.folder / "previews/player-normal.webp").write_bytes(content)
            self.manifest["previews"] = [{"path": "previews/player-normal.webp", "role": "player",
                                          "sha256": hashlib.sha256(content).hexdigest()}]
            self.write_theme()
            if size == catalog.PREVIEW_LIMIT:
                self.validate_theme()
            else:
                with self.assertRaisesRegex(ValueError, "exceeds 4194304 bytes"):
                    self.validate_theme()

    def test_custom_creator_media_uses_preview_limit(self):
        profile = catalog.load_json(catalog.ROOT / "demo/examples/creator-v1/profile.json")
        for size in (catalog.PREVIEW_LIMIT, catalog.PREVIEW_LIMIT + 1):
            content = self.image_bytes("WEBP").ljust(size, b" ")
            (self.folder / "banner.webp").write_bytes(content)
            profile["banner"] = {"source": "custom", "asset": {
                "path": "banner.webp", "sha256": hashlib.sha256(content).hexdigest()}}
            self.write_json("profile.json", profile)
            if size == catalog.PREVIEW_LIMIT:
                catalog.validate_creator(self.folder, catalog.load_schema("creator"))
            else:
                with self.assertRaisesRegex(ValueError, "exceeds 4194304 bytes"):
                    catalog.validate_creator(self.folder, catalog.load_schema("creator"))

    def test_images_must_decode_as_declared_even_with_matching_hash(self):
        for suffix, image_format in {".jpg": "JPEG", ".png": "PNG", ".webp": "WEBP", ".gif": "GIF"}.items():
            path = self.folder / f"preview{suffix}"
            with self.subTest(suffix=suffix):
                for content, expected_to_decode in (
                    (self.image_bytes(image_format), True),
                    (self.image_bytes("JPEG" if suffix == ".png" else "PNG"), False),
                    (b"x", False),
                ):
                    path.write_bytes(content)
                    sha256 = hashlib.sha256(content).hexdigest()
                    if expected_to_decode:
                        catalog.validate_image(path, sha256)
                    else:
                        with self.assertRaisesRegex(ValueError, f"invalid {image_format}"):
                            catalog.validate_image(path, sha256)

    def test_review_logins_reject_trailing_line_break(self):
        schema = catalog.load_schema("reviews").schema
        login = schema["properties"]["reviews"]["items"]["properties"]["author"]["properties"]["login"]
        validator = Draft202012Validator(login)
        self.assertTrue(validator.is_valid("Review-User"))
        self.assertFalse(validator.is_valid("Review-User\n"))

    def test_catalog_accepts_renamed_creator_and_enforces_publication_floor(self):
        author_id = self.manifest["author"]["githubId"]
        theme_id = self.manifest["themeId"]
        catalog_root = self.folder / "catalog"
        shutil.copytree(catalog.CATALOG / "schemas", catalog_root / "schemas")
        creator_root = catalog_root / "creators"
        creator_folder = creator_root / str(author_id)
        creator_folder.mkdir(parents=True)
        profile = catalog.load_json(catalog.ROOT / "demo/examples/creator-v1/profile.json")
        profile.update(githubId=author_id, login="Renamed-Creator")
        profile_path = self.write_json(creator_folder / "profile.json", profile)
        self.write_json(creator_root / "index.json", {"schemaVersion": 1, "creators": [{
            "githubId": author_id,
            "profileSha256": hashlib.sha256(profile_path.read_bytes()).hexdigest(),
        }]})
        self.write_json(creator_root / "verified.json", {"schemaVersion": 1, "githubIds": []})
        self.write_json(creator_root / "blocked.json", {"schemaVersion": 1, "accounts": []})
        theme_root = catalog_root / "themes"
        theme_folder = theme_root / theme_id / "1"
        (theme_folder / "previews").mkdir(parents=True)
        image = self.image_bytes("WEBP")
        image_hash = hashlib.sha256(image).hexdigest()
        self.manifest["previews"] = []
        for scene in catalog.BASE_SCENES:
            for variant in ("normal", "glass"):
                path = f"previews/{scene}-{variant}.webp"
                (theme_folder / path).write_bytes(image)
                self.manifest["previews"].append({
                    "path": path, "role": catalog.PREVIEW_ROLES.get(scene, "other"), "sha256": image_hash,
                })
        (theme_folder / "appearance.json").write_bytes(self.appearance)
        self.manifest["appearance"]["sha256"] = hashlib.sha256(self.appearance).hexdigest()
        manifest_path = self.write_json(theme_folder / "manifest.json", self.manifest)
        self.write_json(theme_root / "index.json", {"schemaVersion": 1, "themes": [{
            "themeId": theme_id,
            "revision": 1,
            "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        }]})
        self.write_json(theme_root / "index-v2.json", {
            "schemaVersion": 1, "previewLimit": 80, "legacyMaxVersionCode": 98, "themes": [],
        })
        self.write_json(theme_root / "index-v3.json", {
            "schemaVersion": 1, "previewLimit": 80, "legacyMaxVersionCode": 98, "themes": [],
        })
        with patch.object(catalog, "CATALOG", catalog_root):
            catalog.main()
            creator_index = creator_root / "index.json"
            saved_index = creator_index.read_bytes()
            self.write_json(creator_index, {"schemaVersion": 1, "creators": []})
            # Keep the unindexed profile off disk so the author check is the failure.
            shutil.rmtree(creator_folder)
            with self.assertRaisesRegex(ValueError, "creator profile must be published"):
                catalog.main()
            creator_folder.mkdir()
            self.write_json(creator_folder / "profile.json", profile)
            creator_index.write_bytes(saved_index)
            for minimum in (96, None):
                with self.subTest(minimum=minimum):
                    self.manifest["compatibility"] = {"minVersionCode": minimum}
                    manifest_path = self.write_json(theme_folder / "manifest.json", self.manifest)
                    self.write_json(theme_root / "index.json", {"schemaVersion": 1, "themes": [{
                        "themeId": theme_id, "revision": 1,
                        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                    }]})
                    with self.assertRaisesRegex(ValueError, "version code 97"):
                        catalog.main()

    def test_navigation_layout_values_reject_trailing_line_break(self):
        schema = catalog.load_schema("appearance").schema
        navigation = schema["properties"]["categories"]["properties"]["navigation"]["properties"]
        dock_item = navigation["toolbars"]["properties"]["dockOrder"]["items"]
        for rule, value in ((dock_item, "home"), (navigation["searchGridLayouts"], "0101010")):
            validator = Draft202012Validator(rule)
            self.assertTrue(validator.is_valid(value))
            self.assertFalse(validator.is_valid(value + "\n"))

    def test_metadata_limit_applies_before_parsing(self):
        path = self.folder / "index.json"
        path.write_bytes(b"{}".ljust(catalog.CATALOG_LIMIT, b" "))
        self.assertEqual({}, catalog.load_json(path))
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "exceeds 524288 bytes"):
            catalog.load_json(path)

    def test_nonfinite_literals_are_rejected_before_schema_validation(self):
        path = self.folder / "appearance.json"
        for literal in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(literal=literal):
                path.write_text('{"radius": ' + literal + '}', encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "not a JSON number"):
                    catalog.load_json(path)

    def test_catalog_json_requires_utf8_without_bom(self):
        path = self.folder / "index.json"
        text = '{"title": "Été"}'
        path.write_bytes(text.encode("utf-8"))
        self.assertEqual({"title": "Été"}, catalog.load_json(path))
        for encoding in ("utf-8-sig", "utf-16", "utf-32"):
            with self.subTest(encoding=encoding):
                path.write_bytes(text.encode(encoding))
                with self.assertRaisesRegex(ValueError, "UTF-8"):
                    catalog.load_json(path)

    def test_metadata_integers_require_integer_notation(self):
        path = self.folder / "index.json"
        for version in ("1", "1.0", "1e0", "true"):
            with self.subTest(version=version):
                path.write_text('{"schemaVersion": ' + version + ', "themes": []}', encoding="utf-8")
                if version == "1":
                    catalog.validate_json(path, catalog.load_schema("catalog"))
                else:
                    with self.assertRaisesRegex(ValueError, "integer notation"):
                        catalog.validate_json(path, catalog.load_schema("catalog"))

        for field, values in (
            ("revision", (1, 1.0)),
            ("author", (self.manifest["author"], {**self.manifest["author"], "githubId": 1.0})),
            ("compatibility", ({"minVersionCode": 96}, {"minVersionCode": 96.0})),
        ):
            for value, valid in zip(values, (True, False)):
                with self.subTest(field=field, value=value):
                    self.assertEqual(valid, catalog.load_schema("theme").is_valid({**self.manifest, field: value}))

    def test_appearance_still_accepts_equivalent_numeric_notation(self):
        path = self.folder / "appearance.json"
        validator = catalog.load_schema("appearance")
        for literal in ("1", "1.0", "1e0", "-2.147483648e9", "2147483647.0", "0e-9999"):
            with self.subTest(literal=literal):
                path.write_text(
                    '{"schemaVersion": 1.0, "categories": {"colors": {"mode": "system", '
                    '"palette": "dynamic", "customAccent": ' + literal + '}}}', encoding="utf-8",
                )
                catalog.validate_json(path, validator)

    def test_appearance_integer_tokens_are_checked_without_rounding(self):
        path = self.folder / "appearance.json"
        validator = catalog.load_schema("appearance")
        for literal in ("1.0000000000000001", "2147483647.00000001", "1e-9999"):
            with self.subTest(literal=literal):
                path.write_text(
                    '{"schemaVersion": 1, "categories": {"colors": {"mode": "system", '
                    '"palette": "dynamic", "customAccent": ' + literal + '}}}', encoding="utf-8",
                )
                with self.assertRaisesRegex(ValueError, "customAccent"):
                    catalog.validate_json(path, validator)
        path.write_text('{"schemaVersion": 1.0000000000000001, "categories": {}}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "schemaVersion"):
            catalog.validate_json(path, validator)

    def test_duplicate_members_cannot_hide_invalid_metadata(self):
        path = self.folder / "index.json"
        path.write_text('{"schemaVersion": 1.0, "schemaVersion": 1, "themes": []}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate JSON member 'schemaVersion'"):
            catalog.validate_json(path, catalog.load_schema("catalog"))

    def test_demo_versions_require_integer_notation(self):
        for name, sections in (("index.json", ("assets",)), ("visuals.json", ("covers", "banners"))):
            with self.subTest(name=name):
                path = self.write_json(name, {"schemaVersion": 1.0, **dict.fromkeys(sections, [])})
                with self.assertRaisesRegex(ValueError, "unsupported index version"):
                    catalog.load_demo_index(path, sections)

    def test_demo_indexes_use_android_byte_limit(self):
        for name, sections in (("index.json", ("assets",)), ("visuals.json", ("covers", "banners"))):
            with self.subTest(name=name):
                document = {"schemaVersion": 1, **dict.fromkeys(sections, [])}
                path = self.folder / name
                at_limit = json.dumps(document).encode("utf-8").ljust(8192, b" ")
                path.write_bytes(at_limit)
                self.assertEqual(document, catalog.load_demo_index(path, sections))
                path.write_bytes(at_limit + b" ")
                with self.assertRaisesRegex(ValueError, "exceeds 8192 bytes"):
                    catalog.load_demo_index(path, sections)

    def test_demo_indexes_and_entries_are_closed(self):
        entry = {"name": "atlas.jpg", "sha256": "a" * 64}
        cases = (
            ({"assets": [entry], "description": "Extra"}, "invalid demo index fields"),
            ({}, "invalid demo index fields"),
            ({"assets": {}}, "must be a list"),
            ({"assets": [{**entry, "extra": True}]}, "invalid demo asset fields"),
            ({"assets": [{"name": "atlas.jpg"}]}, "invalid demo asset fields"),
            ({"assets": [{**entry, "name": 1}]}, "must be strings"),
            ({"assets": [{**entry, "sha256": "A" * 64}]}, "invalid demo asset SHA-256"),
        )
        for changes, reason in cases:
            with self.subTest(changes=changes):
                path = self.write_json("index.json", {"schemaVersion": 1, **changes})
                with self.assertRaisesRegex(ValueError, reason):
                    catalog.load_demo_index(path, ("assets",))

    def test_playback_gallery_scenes_need_both_variants(self):
        previews = [
            {"path": f"previews/{scene}-{variant}.webp", "role": catalog.PREVIEW_ROLES.get(scene, "other")}
            for scene in catalog.BASE_SCENES for variant in ("normal", "glass")
        ]
        manifest = {"title": "Demo", "previews": previews}
        previews.append({"path": "previews/extra-photo-normal.webp", "role": "other"})
        catalog.validate_gallery(manifest)
        previews.append({"path": "previews/player-playing-normal.webp", "role": "other"})
        with self.assertRaisesRegex(ValueError, "player-playing-glass"):
            catalog.validate_gallery(manifest)
        previews.append({"path": "previews/player-playing-glass.webp", "role": "other"})
        catalog.validate_gallery(manifest)

    def test_v2_system_gallery_validates_both_brightnesses_and_roles(self):
        previews = [
            {"path": f"previews/{scene}-{brightness}-{variant}.webp",
             "role": catalog.PREVIEW_ROLES.get(scene, "other")}
            for scene in catalog.BASE_SCENES for brightness in ("light", "dark") for variant in ("normal", "glass")
        ]
        manifest = {"schemaVersion": 2, "title": "Demo", "previews": previews}
        catalog.validate_gallery(manifest, colors={"mode": "system"})
        previews[0]["role"] = "other"
        with self.assertRaisesRegex(ValueError, "incorrect preview role for player-light-normal"):
            catalog.validate_gallery(manifest, colors={"mode": "system"})
        del previews[0]
        with self.assertRaisesRegex(ValueError, "missing previews: player-light-normal"):
            catalog.validate_gallery(manifest, colors={"mode": "system"})

    def test_v2_fixed_black_palettes_use_unqualified_previews_even_in_system_mode(self):
        previews = [
            {"path": f"previews/{scene}-{variant}.webp", "role": catalog.PREVIEW_ROLES.get(scene, "other")}
            for scene in catalog.BASE_SCENES for variant in ("normal", "glass")
        ]
        manifest = {"schemaVersion": 2, "title": "Demo", "previews": previews}
        for palette in ("pure-black", "modern-black"):
            with self.subTest(palette=palette):
                catalog.validate_gallery(manifest, colors={"mode": "system", "palette": palette})
        with self.assertRaisesRegex(ValueError, "player-light-normal"):
            catalog.validate_gallery(manifest, colors={"mode": "system", "palette": "default"})

    def test_v2_index_preview_limit_is_applied_to_manifest_gallery(self):
        theme_id = self.manifest["themeId"]
        directory = self.folder / theme_id / "1"
        (directory / "previews").mkdir(parents=True)
        image = self.image_bytes("WEBP")
        image_hash = hashlib.sha256(image).hexdigest()
        names = [(f"{scene}-{variant}", catalog.PREVIEW_ROLES.get(scene, "other"))
                 for scene in catalog.BASE_SCENES for variant in ("normal", "glass")]
        names.extend((f"extra-{i}-normal", "other") for i in range(65 - len(names)))
        previews = []
        for name, role in names:
            path = f"previews/{name}.webp"
            (directory / path).write_bytes(image)
            previews.append({"path": path, "role": role, "sha256": image_hash})
        appearance = b'{"schemaVersion": 2, "categories": {"colors": {"palette": "dynamic", "mode": "light"}}}'
        (directory / "appearance.json").write_bytes(appearance)
        self.manifest.update(schemaVersion=2, previews=previews, compatibility={"minVersionCode": 99})
        self.manifest["appearance"]["sha256"] = hashlib.sha256(appearance).hexdigest()
        manifest_path = self.write_json(directory / "manifest.json", self.manifest)
        index = {"schemaVersion": 1, "previewLimit": 65, "legacyMaxVersionCode": 98, "themes": [{
            "themeId": theme_id, "revision": 1, "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        }]}
        path = self.write_json("index-v2.json", index)
        appearances = {version: catalog.load_schema("appearance", version) for version in (1, 2)}
        creator_ids = {self.manifest["author"]["githubId"]}
        self.assertEqual(catalog.validate_theme_index(path, 2, appearances, set(), creator_ids), {theme_id})
        with self.assertRaisesRegex(ValueError, "creator profile must be published"):
            catalog.validate_theme_index(path, 2, appearances, set(), set())
        index["previewLimit"] = 64
        self.write_json(path, index)
        with self.assertRaisesRegex(ValueError, "exceeds the catalog previewLimit of 64"):
            catalog.validate_theme_index(path, 2, appearances, set(), creator_ids)

    def test_empty_files_are_rejected_even_with_matching_hash(self):
        path = self.folder / "empty.webp"
        path.write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "empty"):
            catalog.check_hash(path, hashlib.sha256(b"").hexdigest(), catalog.PREVIEW_LIMIT)

    def test_snapshot_checks_serialized_size_and_raw_total(self):
        index = self.write_json("index.json", {"schemaVersion": 1, "themes": []})
        catalog.validate_snapshot(index, [])
        with patch.object(catalog, "CATALOG_SNAPSHOT_LIMIT", 64):
            with self.assertRaisesRegex(ValueError, "snapshot"):
                catalog.validate_snapshot(index, [])
            first = self.folder / "first.json"
            second = self.folder / "second.json"
            first.write_bytes(b"x" * 32)
            second.write_bytes(b"x" * 32)
            with self.assertRaisesRegex(ValueError, "exceeds"):
                catalog.validate_snapshot(index, [first, second])

    def test_metadata_integer_bounds_match_android_types(self):
        fields = [
            ("theme", "properties.author.properties.githubId", 2**63 - 1),
            ("theme", "properties.revision", 2**31 - 1),
            ("theme", "properties.compatibility.properties.minVersionCode", 2**31 - 1),
            ("catalog", "properties.themes.items.properties.revision", 2**31 - 1),
            ("creator", "properties.githubId", 2**63 - 1),
            ("creators-index", "properties.creators.items.properties.githubId", 2**63 - 1),
            ("blocked-creators", "properties.accounts.items.properties.githubId", 2**63 - 1),
            ("verified-creators", "properties.githubIds.items", 2**63 - 1),
            ("reviews", "properties.reviews.items.properties.author.properties.githubId", 2**63 - 1),
        ]
        for name, path, maximum in fields:
            with self.subTest(schema=name, path=path):
                schema = catalog.load_schema(name).schema
                for component in path.split("."):
                    schema = schema[component]
                validator = Draft202012Validator(schema)
                self.assertTrue(validator.is_valid(maximum))
                self.assertFalse(validator.is_valid(maximum + 1))

    def test_supplementary_characters_count_once_in_metadata(self):
        symbol = "\U0001f3b5"
        self.manifest.update(title=symbol * 100, description=symbol * 1000, tags=[symbol * 30])
        validator = catalog.load_schema("theme")
        self.assertTrue(validator.is_valid(self.manifest))
        self.manifest["title"] += symbol
        self.assertFalse(validator.is_valid(self.manifest))


if __name__ == "__main__":
    unittest.main()
