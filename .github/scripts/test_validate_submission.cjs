const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { creatorSubmission, themeSubmission, trustedCandidate, publishedCreator } = require('./validate_submission.cjs');

const id = 101;
const login = 'Creator';
const themeId = '9fabc1ee-37b1-4d82-8d3b-f7b141ceb831';
const themePath = `catalog/themes/${themeId}/`;
const themeIndex = 'catalog/themes/index.json';
const currentThemeIndex = 'catalog/themes/index-v2.json';
const v3ThemeIndex = 'catalog/themes/index-v3.json';
const profilePath = `catalog/creators/${id}/profile.json`;
const creatorIndex = 'catalog/creators/index.json';
const encode = value => Buffer.from(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const file = (filename, status = 'added') => ({ filename, status });

function makeCandidate() {
  const revisions = Object.fromEntries(['ancestor', 'base', 'head'].map(ref => [ref, new Map()]));
  const put = (ref, filename, value) => {
    const bytes = encode(value);
    revisions[ref].set(filename, bytes);
    return hash(bytes);
  };
  const candidate = {
    ancestor: 'ancestor', base: 'base', head: 'head', changes: [],
    read(ref, filename) {
      assert.ok(revisions[ref].has(filename), `Missing fixture ${ref}:${filename}`);
      return revisions[ref].get(filename);
    },
  };
  return { candidate, put };
}

function themeFixture({ published = false, submittedOwner = id, publishedOwner = id, publishedLogin = login,
  compatibility = { minVersionCode: 97 }, appearanceVersion = 1, manifestVersion = appearanceVersion,
  indexVersion = manifestVersion === 2 || manifestVersion === 3 ? manifestVersion : 1,
  previewCount = 1, previewLimit = 80, legacyOnly = false, v2Only = false,
  categories = {}, scenes = Array.from({ length: previewCount }, (_, index) => `photo-${index}-normal`) } = {}) {
  const { candidate, put } = makeCandidate();
  const profileSha256 = put('base', profilePath, { githubId: id, login });
  put('base', creatorIndex, { schemaVersion: 1, creators: [{ githubId: id, profileSha256 }] });
  const revision = published || legacyOnly || v2Only ? 2 : 1;
  const manifestFile = `${themePath}${revision}/manifest.json`;
  const oldManifest = { themeId, revision: 1, author: { githubId: publishedOwner, login: publishedLogin } };
  const previous = published || legacyOnly || v2Only ? [{
    themeId, revision: 1, manifestSha256: put('base', `${themePath}1/manifest.json`, oldManifest),
  }] : [];
  const previews = scenes.map(scene => ({ path: `previews/${scene}.webp` }));
  const manifest = { schemaVersion: manifestVersion, themeId, revision, author: { githubId: submittedOwner, login },
    compatibility,
    appearance: { path: 'appearance.json' }, previews };
  const entry = { themeId, revision, manifestSha256: put('head', manifestFile, manifest) };
  put('head', `${themePath}${revision}/appearance.json`, { schemaVersion: appearanceVersion, categories });
  const reviewsFile = `${themePath}${revision}/reviews.json`;
  put('head', reviewsFile, { schemaVersion: 1, reviews: [] });
  const indexPath = [themeIndex, currentThemeIndex, v3ThemeIndex][indexVersion - 1];
  const index = { schemaVersion: 1, ...(indexVersion >= 2 && { previewLimit, legacyMaxVersionCode: 98 }) };
  put('ancestor', indexPath, { ...index, themes: legacyOnly || v2Only ? [] : previous });
  put('base', indexPath, { ...index, themes: legacyOnly || v2Only ? [] : previous });
  put('head', indexPath, { ...index, themes: [entry] });
  if (indexVersion >= 2) {
    for (const ref of ['ancestor', 'base']) {
      put(ref, themeIndex, { schemaVersion: 1, themes: legacyOnly ? previous : [] });
    }
  }
  if (indexVersion === 3) {
    for (const ref of ['ancestor', 'base']) {
      put(ref, currentThemeIndex, { ...index, themes: v2Only ? previous : [] });
    }
  }
  candidate.changes = [
    file(indexPath, 'modified'), file(manifestFile), file(`${themePath}${revision}/appearance.json`),
    ...previews.map(preview => file(`${themePath}${revision}/${preview.path}`)), file(reviewsFile),
  ];
  return { candidate, put, entry };
}

test('themes require an already published creator profile from trusted main', () => {
  const { candidate, put } = themeFixture();
  put('base', creatorIndex, { schemaVersion: 1, creators: [] });
  put('head', creatorIndex, { schemaVersion: 1, creators: [{ githubId: id, profileSha256: 'a'.repeat(64) }] });
  assert.equal(publishedCreator(candidate, id), false);
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /profile must be published/);
  // A profile added in the same unmerged PR cannot satisfy the prerequisite.
  const profileSha256 = put('base', profilePath, { githubId: id, login: 'Old-Login' });
  put('base', creatorIndex, { schemaVersion: 1, creators: [{ githubId: id, profileSha256 }] });
  assert.equal(publishedCreator(candidate, id), true);
  assert.doesNotThrow(() => themeSubmission(candidate, id, login, themeId));
  put('base', profilePath, { githubId: id + 1, login });
  assert.throws(() => publishedCreator(candidate, id), /Invalid published creator profile/);
});

test('a creator can publish and update their own theme', () => {
  for (const published of [false, true]) {
    const { candidate, entry } = themeFixture({ published });
    assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
  }
});

test('an updated theme uses the authenticated current login after a GitHub rename', () => {
  const { candidate, entry } = themeFixture({ published: true, publishedLogin: 'Previous-Creator' });
  assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
  assert.throws(() => themeSubmission(candidate, id, 'Previous-Creator', themeId), /author/);
});

test('V1 theme publication requires Android code 97 or 98', () => {
  for (const published of [false, true]) {
    for (const compatibility of [null, {}, { minVersionCode: null }, { minVersionCode: 96 }, { minVersionCode: '97' }]) {
      const { candidate } = themeFixture({ published, compatibility });
      assert.throws(() => themeSubmission(candidate, id, login, themeId), /version code 97/);
    }
    for (const minVersionCode of [97, 98]) {
      const { candidate, entry } = themeFixture({ published, compatibility: { minVersionCode } });
      assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
    }
    const tooNew = themeFixture({ published, compatibility: { minVersionCode: 99 } });
    assert.throws(() => themeSubmission(tooNew.candidate, id, login, themeId), /above 98/);
  }
});

test('appearance v2 publication requires Android code 99 or later', () => {
  for (const published of [false, true]) {
    for (const minVersionCode of [null, 97, 98, 99, 100]) {
      const { candidate, entry } = themeFixture({ published, appearanceVersion: 2, compatibility: { minVersionCode } });
      if (minVersionCode < 99) {
        assert.throws(() => themeSubmission(candidate, id, login, themeId), /version code 99/);
      } else {
        assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
      }
    }
  }
});

test('theme publication rejects an unsupported appearance version', () => {
  const { candidate } = themeFixture({ appearanceVersion: 4 });
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /Unsupported appearance schema version/);
});

test('V3 publication requires code 101 and the latest V1 or V2 predecessor', () => {
  for (const predecessor of [{}, { legacyOnly: true }, { v2Only: true }, { published: true }]) {
    const options = { ...predecessor, appearanceVersion: 3, compatibility: { minVersionCode: 101 } };
    const { candidate, entry } = themeFixture(options);
    const submission = themeSubmission(candidate, id, login, themeId);
    assert.equal(submission.indexPath, v3ThemeIndex);
    assert.deepEqual(submission.index.themes, [entry]);
    const tooOld = themeFixture({ ...options, compatibility: { minVersionCode: 100 } });
    assert.throws(() => themeSubmission(tooOld.candidate, id, login, themeId), /version code 101/);
  }
  const wrongOwner = themeFixture({
    v2Only: true, appearanceVersion: 3, compatibility: { minVersionCode: 101 }, publishedOwner: id + 1,
  });
  assert.throws(() => themeSubmission(wrongOwner.candidate, id, login, themeId), /Only the owner/);
});

test('theme publication enforces the selected index and its trusted preview limit', () => {
  const options = { appearanceVersion: 2, compatibility: { minVersionCode: 99 }, previewLimit: 72 };
  assert.throws(() => themeSubmission(themeFixture({ ...options, indexVersion: 1 }).candidate, id, login, themeId),
    /versions must match the catalog index/);
  const { candidate, entry, put } = themeFixture({ ...options, previewCount: 72 });
  assert.deepEqual(themeSubmission(candidate, id, login, themeId),
    { entry, indexPath: currentThemeIndex, index: { schemaVersion: 1, previewLimit: 72, legacyMaxVersionCode: 98, themes: [entry] } });
  put('head', currentThemeIndex, { schemaVersion: 1, previewLimit: 80, legacyMaxVersionCode: 98, themes: [entry] });
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /changes other index entries/);
  const overflow = themeFixture({ ...options, previewCount: 73 });
  assert.throws(() => themeSubmission(overflow.candidate, id, login, themeId), /at most 72 previews/);
});

test('initial V2 publication of an existing V1 theme verifies the legacy revision and owner', () => {
  const options = { legacyOnly: true, appearanceVersion: 2, compatibility: { minVersionCode: 99 } };
  const { candidate, entry, put } = themeFixture(options);
  assert.equal(entry.revision, 2);
  assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
  const otherOwner = themeFixture({ ...options, publishedOwner: id + 1 });
  assert.throws(() => themeSubmission(otherOwner.candidate, id, login, themeId), /Only the owner/);
  put('base', themeIndex, { schemaVersion: 1, themes: [] });
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /legacy theme changed on main/);
});

test('V2 Pure Black and Modern Black submissions use fixed dark previews even in System mode', () => {
  const baseScenes = ['player', 'queue', 'lyrics', 'home', 'navigation', 'album', 'artist',
    'playlist', 'local-playlist', 'search', 'search-albums', 'search-artists'];
  const scenes = baseScenes.flatMap(scene => [`${scene}-normal`, `${scene}-glass`]);
  for (const palette of ['pure-black', 'modern-black']) {
    const options = { appearanceVersion: 2, compatibility: { minVersionCode: 99 },
      categories: { colors: { palette, mode: 'system' } } };
    const { candidate, entry } = themeFixture({ ...options, scenes });
    assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [entry]);
    const brightnessNames = scenes.map(scene => scene.replace(/-(normal|glass)$/, '-dark-$1'));
    const qualified = themeFixture({ ...options, scenes: brightnessNames });
    assert.throws(() => themeSubmission(qualified.candidate, id, login, themeId),
      /Fixed-dark gallery is missing previews: player-normal/);
  }
});

test('theme approval rejects unrelated files and changes to existing revisions', () => {
  for (const unexpected of [file('docs/note.md'), file(`${themePath}1/appearance.json`, 'modified')]) {
    const { candidate } = themeFixture({ published: true });
    candidate.changes.push(unexpected);
    assert.throws(() => themeSubmission(candidate, id, login, themeId), /only change the index/);
  }
});

test('theme approval rejects reviews included in a new revision', () => {
  const { candidate, put } = themeFixture();
  put('head', `${themePath}1/reviews.json`, { schemaVersion: 1, reviews: [{ author: { githubId: id } }] });
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /empty review list/);
});

test('theme approval validates the new and previous owners', () => {
  for (const options of [{ submittedOwner: 102 }, { published: true, publishedOwner: 102 }]) {
    const { candidate } = themeFixture(options);
    assert.throws(() => themeSubmission(candidate, id, login, themeId), /author|owner/);
  }
});

test('theme index repair preserves unrelated entries added to main', () => {
  const { candidate, put, entry } = themeFixture();
  const unrelated = { themeId: '087ff26b-5ebb-4a41-97ca-b45134306be3', revision: 1 };
  put('base', themeIndex, { schemaVersion: 1, themes: [unrelated] });
  assert.deepEqual(themeSubmission(candidate, id, login, themeId).index.themes, [unrelated, entry]);
  put('head', themeIndex, { schemaVersion: 1, themes: [unrelated, entry] });
  assert.throws(() => themeSubmission(candidate, id, login, themeId), /other index entries/);
});

test('creator profile may replace its own referenced artwork and remove the old artwork', () => {
  const { candidate, put } = makeCandidate();
  const oldProfile = { githubId: id, login, avatar: { source: 'custom', asset: { path: 'old.webp' } } };
  const profile = { githubId: id, login, avatar: { source: 'custom', asset: { path: 'new.webp' } } };
  const previous = { schemaVersion: 1, creators: [{ githubId: id, profileSha256: put('base', profilePath, oldProfile) }] };
  put('ancestor', creatorIndex, previous);
  put('base', creatorIndex, previous);
  const updated = { githubId: id, profileSha256: put('head', profilePath, profile) };
  put('head', creatorIndex, { ...previous, creators: [updated] });
  const directory = `catalog/creators/${id}/`;
  candidate.changes = [file(creatorIndex, 'modified'), file(profilePath, 'modified'),
    file(directory + 'old.webp', 'removed'), file(directory + 'new.webp')];
  const other = { githubId: 102, profileSha256: 'a'.repeat(64) };
  put('base', creatorIndex, { ...previous, creators: [other, ...previous.creators] });
  assert.deepEqual(creatorSubmission(candidate, id, login).index.creators, [other, updated]);
  candidate.changes.push(file(directory + 'unreferenced.webp'));
  assert.throws(() => creatorSubmission(candidate, id, login), /referenced images/);
  candidate.changes.pop();
  put('head', creatorIndex, { ...previous, creators: [updated, { githubId: 102 }] });
  assert.throws(() => creatorSubmission(candidate, id, login), /other index entries/);
  put('head', creatorIndex, { ...previous, creators: [updated] });
  put('base', creatorIndex, { ...previous, creators: [{ ...updated, profileSha256: 'b'.repeat(64) }] });
  assert.throws(() => creatorSubmission(candidate, id, login), /profile changed on main/);
});

test('trusted checkout validates merged data for the exact approved PR head', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nzik-submission-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  run('init', '-q');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  run('config', 'core.autocrlf', 'false');
  run('config', 'core.filemode', 'false');
  run('remote', 'add', 'origin', '.');
  fs.mkdirSync(path.join(root, '.github', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'catalog'));
  fs.writeFileSync(path.join(root, '.github', 'scripts', 'validate_catalog.py'),
    'from pathlib import Path\nassert Path("catalog/submission.json").read_bytes() == b\'{"expected":true}\'\n');
  run('add', '.');
  run('commit', '-qm', 'Trusted validator');
  const base = run('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'catalog', 'submission.json'), '{"expected":true}');
  run('add', '.');
  run('commit', '-qm', 'Submit catalog data');
  const head = run('rev-parse', 'HEAD');
  run('update-ref', 'refs/pull/4/head', head);
  run('checkout', '--detach', '-q', base);
  const pr = { number: 4, base: { sha: base }, head: { sha: head } };
  assert.throws(() => trustedCandidate(root, { ...pr, head: { sha: base } }), /changed after approval/);
  const candidate = trustedCandidate(root, pr);
  assert.deepEqual(candidate.changes, [file('catalog/submission.json')]);
  assert.doesNotThrow(() => candidate.validateMerged());
  assert.equal(run('rev-parse', 'HEAD'), base);

  // Simulate a prior approval advancing main while this approval was queued.
  run('reset', '--hard', base);
  fs.writeFileSync(path.join(root, 'catalog', 'earlier-publication.json'), '{}');
  const validator = path.join(root, '.github', 'scripts', 'validate_catalog.py');
  fs.appendFileSync(validator, 'assert Path("catalog/earlier-publication.json").is_file()\n');
  run('add', '.');
  run('commit', '-qm', 'Earlier publication');
  const latestBase = run('rev-parse', 'HEAD');
  assert.throws(() => trustedCandidate(root, pr), /Main changed/);
  const queued = trustedCandidate(root, { ...pr, base: { sha: latestBase } });
  assert.deepEqual(queued.changes, [file('catalog/submission.json')]);
  assert.doesNotThrow(() => queued.validateMerged());
  assert.equal(run('rev-parse', 'HEAD'), latestBase);
  run('update-ref', 'refs/heads/main', latestBase);
  assert.throws(() => trustedCandidate(root, { ...pr, base: { sha: latestBase } })
    .publishValidatedMerge('Unvalidated merge'), /must pass/);

  const tree = run('rev-parse', 'HEAD^{tree}');
  const racingCommit = run('commit-tree', tree, '-p', latestBase, '-m', 'Independent publication');
  run('update-ref', 'refs/heads/main', racingCommit);
  assert.throws(() => queued.publishValidatedMerge('Stale approval'), /stale info/);
  assert.equal(run('rev-parse', 'refs/heads/main'), racingCommit);

  run('reset', '--hard', latestBase);
  run('checkout', '--detach', '-q', racingCommit);
  const retry = trustedCandidate(root, { ...pr, base: { sha: racingCommit } });
  retry.validateMerged();
  const merged = retry.publishValidatedMerge('Revalidated approval');
  assert.equal(run('rev-parse', 'refs/heads/main'), merged);
  assert.equal(run('rev-parse', merged + '^1'), racingCommit);
  assert.equal(run('rev-parse', merged + '^2'), head);
});

test('a repaired V2 index publishes a gallery above the V1 file limit without writing main workflows into the fork', t => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'nzik-repaired-submission-'));
  t.after(() => {
    assert.equal(path.dirname(root), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const put = (filename, value) => {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), value);
  };
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  git('remote', 'add', 'origin', '.');
  const index = themes => ({ schemaVersion: 1, previewLimit: 80, legacyMaxVersionCode: 98, themes });
  put('.github/scripts/validate_catalog.py', [
    'import json', 'from pathlib import Path',
    'index = json.loads(Path("catalog/themes/index-v2.json").read_text())',
    'assert index == {"schemaVersion": 1, "previewLimit": 80, "legacyMaxVersionCode": 98, "themes": ["main", "submission"]}',
    'assert Path("catalog/themes/submission.json").read_text() == "checked data"',
    'assert len(list(Path("catalog/themes/test-previews").glob("*.webp"))) == 39',
    'assert Path(".github/workflows/test.yml").read_text() == "current trusted workflow"',
  ].join('\n'));
  put('.github/workflows/test.yml', 'old workflow already in the fork');
  put(currentThemeIndex, JSON.stringify(index([])));
  git('add', '.');
  git('commit', '-qm', 'Shared ancestor');
  const ancestor = git('rev-parse', 'HEAD');
  put(currentThemeIndex, JSON.stringify(index(['submission'])));
  put('catalog/themes/submission.json', 'checked data');
  for (let preview = 1; preview <= 39; preview++) {
    put(`catalog/themes/test-previews/photo-${preview}.webp`, 'checked preview');
  }
  git('add', '.');
  git('commit', '-qm', 'Accepted fork submission');
  const head = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/pull/4/head', head);
  git('checkout', '--detach', '-q', ancestor);
  put(currentThemeIndex, JSON.stringify(index(['main'])));
  put('.github/workflows/test.yml', 'current trusted workflow');
  git('add', '.');
  git('commit', '-qm', 'Concurrent main publication and workflow update');
  const base = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/heads/main', base);
  const candidate = trustedCandidate(root, { number: 4, base: { sha: base }, head: { sha: head } });
  assert.equal(candidate.mergeTree(), null);
  assert.throws(() => candidate.validateRepairedIndex(index(['submission']), currentThemeIndex));
  assert.throws(() => candidate.publishValidatedMerge('Invalid repair'), /must pass/);
  candidate.validateRepairedIndex(index(['main', 'submission']), currentThemeIndex);
  const merged = candidate.publishValidatedMerge('Validated index repair');
  assert.equal(git('rev-parse', merged + '^1'), base);
  assert.equal(git('rev-parse', merged + '^2'), head);
  assert.equal(git('show', merged + ':.github/workflows/test.yml'), 'current trusted workflow');
  assert.equal(git('rev-parse', 'refs/pull/4/head'), head);
  assert.equal(git('show', head + ':.github/workflows/test.yml'), 'old workflow already in the fork');

  // A conflicting main-side addition is not an index conflict and must never
  // be silently replaced by automatic repair.
  git('reset', '--hard', base);
  put('catalog/themes/submission.json', 'different main work');
  git('add', '.');
  git('commit', '-qm', 'Independent conflicting file on main');
  const conflictingBase = git('rev-parse', 'HEAD');
  const conflicting = trustedCandidate(root, { number: 4, base: { sha: conflictingBase }, head: { sha: head } });
  assert.throws(() => conflicting.validateRepairedIndex(index(['main', 'submission']), currentThemeIndex),
    /cannot replace a conflicting file added to main/);
  assert.throws(() => conflicting.publishValidatedMerge('Unvalidated conflicting repair'), /must pass/);
});

for (const updating of [false, true]) {
  test(`concurrent creator ${updating ? 'update' : 'creation'} preserves both authors and the approved head`, t => {
    const temporaryRoot = path.resolve(os.tmpdir());
    const root = fs.mkdtempSync(path.join(temporaryRoot, 'nzik-creator-repair-'));
    t.after(() => {
      assert.equal(path.dirname(root), temporaryRoot);
      fs.rmSync(root, { recursive: true, force: true });
    });
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    const put = (filename, value) => {
      fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
      fs.writeFileSync(path.join(root, filename), value);
    };
    const profile = (githubId, login, bio = '') => ({ schemaVersion: 1, githubId, login, displayName: login,
      bio, avatar: { source: 'github' }, banner: { source: 'generated' } });
    const first = profile(101, 'FirstCreator');
    const second = profile(102, 'SecondCreator', 'Submitted profile');
    const firstPath = 'catalog/creators/101/profile.json';
    const secondPath = 'catalog/creators/102/profile.json';
    const oldImage = 'catalog/creators/102/old.webp';
    const newImage = 'catalog/creators/102/new.webp';
    const entry = document => ({ githubId: document.githubId, profileSha256: hash(encode(document)) });
    const writeIndex = creators => put(creatorIndex, encode({ schemaVersion: 1, creators }));
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('config', 'core.autocrlf', 'false');
    git('remote', 'add', 'origin', '.');
    put('.github/scripts/validate_catalog.py', [
      'import hashlib, json', 'from pathlib import Path',
      'index = json.loads(Path("catalog/creators/index.json").read_text())',
      'assert {entry["githubId"] for entry in index["creators"]} == {101, 102}',
      'for entry in index["creators"]:',
      '    data = Path(f"catalog/creators/{entry[\"githubId\"]}/profile.json").read_bytes()',
      '    assert hashlib.sha256(data).hexdigest() == entry["profileSha256"]',
      '    assert json.loads(data)["githubId"] == entry["githubId"]',
      'assert Path(".github/workflows/trusted.yml").read_text() == "current trusted workflow"',
    ].join('\n'));
    put('.github/workflows/trusted.yml', 'old trusted workflow');
    const previous = profile(102, 'SecondCreator');
    if (updating) {
      previous.banner = { source: 'custom', asset: { path: 'old.webp', sha256: hash(Buffer.from('old artwork')) } };
      put(secondPath, encode(previous));
      put(oldImage, 'old artwork');
    }
    writeIndex(updating ? [entry(previous)] : []);
    git('add', '.');
    git('commit', '-qm', 'Shared catalog base');
    const ancestor = git('rev-parse', 'HEAD');
    if (updating) {
      second.banner = { source: 'custom', asset: { path: 'new.webp', sha256: hash(Buffer.from('new artwork')) } };
      fs.unlinkSync(path.join(root, oldImage));
      put(newImage, 'new artwork');
    }
    put(secondPath, encode(second));
    writeIndex([entry(second)]);
    git('add', '.');
    git('commit', '-qm', 'Second author submission');
    const head = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/pull/2/head', head);
    git('checkout', '--detach', '-q', ancestor);
    put(firstPath, encode(first));
    writeIndex(updating ? [entry(previous), entry(first)] : [entry(first)]);
    put('.github/workflows/trusted.yml', 'current trusted workflow');
    git('add', '.');
    git('commit', '-qm', 'First author approved while second approval was queued');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/heads/main', base);
    const candidate = trustedCandidate(root, { number: 2, base: { sha: base }, head: { sha: head } });
    assert.throws(() => creatorSubmission(candidate, first.githubId, first.login), /index entry/);
    const { index } = creatorSubmission(candidate, second.githubId, second.login);
    assert.equal(candidate.mergeTree(), null);
    candidate.validateRepairedIndex(index, creatorIndex);
    const merged = candidate.publishValidatedMerge('Approve second creator against current main');
    assert.equal(git('rev-parse', merged + '^1'), base);
    assert.equal(git('rev-parse', merged + '^2'), head);
    assert.equal(git('show', merged + ':' + firstPath), encode(first).toString());
    assert.equal(git('show', merged + ':' + secondPath), encode(second).toString());
    assert.equal(git('rev-parse', 'refs/pull/2/head'), head);
    assert.equal(git('show', head + ':.github/workflows/trusted.yml'), 'old trusted workflow');
    if (updating) {
      assert.equal(git('ls-tree', merged, '--', oldImage), '');
      assert.equal(git('show', merged + ':' + newImage), 'new artwork');
    }

    // Repair is not permission to overwrite unrelated main-side changes to profile assets.
    git('reset', '--hard', base);
    put(updating ? oldImage : secondPath, 'independent main work');
    git('add', '.');
    git('commit', '-qm', 'Concurrent change outside the shared index');
    const changedBase = git('rev-parse', 'HEAD');
    const conflicting = trustedCandidate(root, { number: 2, base: { sha: changedBase }, head: { sha: head } });
    assert.throws(() => conflicting.validateRepairedIndex(index, creatorIndex), /cannot replace a conflicting file/);
    assert.throws(() => conflicting.publishValidatedMerge('Unsafe repair'), /must pass/);
  });
}

test('Pure Black mode publication requires V2 and feature code 101 for create and edit', () => {
  for (const published of [false, true]) {
    for (const appearanceVersion of [1, 2]) {
      for (const minVersionCode of [98, 99, 100, 101]) {
        const { candidate } = themeFixture({ published, appearanceVersion,
          compatibility: { minVersionCode }, categories: { colors: { palette: 'dynamic', mode: 'pure-black' } } });
        if (appearanceVersion === 2 && minVersionCode >= 101) {
          assert.doesNotThrow(() => themeSubmission(candidate, id, login, themeId));
        } else {
          assert.throws(() => themeSubmission(candidate, id, login, themeId), /V2|version code 101/);
        }
      }
    }
    const namedPalette = themeFixture({ published, appearanceVersion: 2,
      compatibility: { minVersionCode: 99 }, categories: { colors: { palette: 'pure-black', mode: 'dark' } },
      scenes: ['player', 'queue', 'lyrics', 'home', 'navigation', 'album', 'artist', 'playlist',
        'local-playlist', 'search', 'search-albums', 'search-artists'].flatMap(scene => [`${scene}-normal`, `${scene}-glass`]) });
    assert.doesNotThrow(() => themeSubmission(namedPalette.candidate, id, login, themeId));
  }
});

test('M3E shape overrides require code 101 for create and edit', () => {
  for (const published of [false, true]) {
    for (const enabled of [true, false]) {
      for (const minVersionCode of [100, 101]) {
        const { candidate } = themeFixture({ published, appearanceVersion: 2,
          compatibility: { minVersionCode }, categories: { playerAndQueue: { m3eAlwaysShowShapes: enabled } } });
        if (minVersionCode === 101) {
          assert.doesNotThrow(() => themeSubmission(candidate, id, login, themeId));
        } else {
          assert.throws(() => themeSubmission(candidate, id, login, themeId), /version code 101/);
        }
      }
    }
  }
});

test('custom toolbars require code 101 for create and edit', () => {
  const categories = { navigation: { toolbars: { custom: { albumOnline: {
    order: ['enqueue', 'bookmark'], visibility: { bookmark: false },
  } } } } };
  for (const published of [false, true]) {
    for (const minVersionCode of [100, 101]) {
      const { candidate } = themeFixture({ published, appearanceVersion: 2, compatibility: { minVersionCode }, categories });
      if (minVersionCode === 101) {
        assert.doesNotThrow(() => themeSubmission(candidate, id, login, themeId));
      } else {
        assert.throws(() => themeSubmission(candidate, id, login, themeId), /version code 101/);
      }
    }
  }
});

test('burger shortcut flags and ordering require code 101', () => {
  for (const burgerMenu of [{ search: true }, { order: ['history', 'notifications'] }]) {
    for (const minVersionCode of [100, 101]) {
      const categories = { navigation: { burgerMenu } };
      const { candidate } = themeFixture({ appearanceVersion: 2, compatibility: { minVersionCode }, categories });
      if (minVersionCode === 101) {
        assert.doesNotThrow(() => themeSubmission(candidate, id, login, themeId));
      } else {
        assert.throws(() => themeSubmission(candidate, id, login, themeId), /version code 101/);
      }
    }
  }
});
