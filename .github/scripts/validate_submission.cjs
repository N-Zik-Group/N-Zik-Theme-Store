const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const legacyThemeIndexPath = 'catalog/themes/index.json';
const currentThemeIndexPath = 'catalog/themes/index-v2.json';
const themeIndexPaths = [legacyThemeIndexPath, currentThemeIndexPath];
const creatorIndexPath = 'catalog/creators/index.json';
const minimumVersionCodeByAppearance = new Map([[1, 97], [2, 99]]);
const fixedDarkPalettes = new Set(['pure-black', 'modern-black']);
const baseScenes = ['player', 'queue', 'lyrics', 'home', 'navigation', 'album', 'artist',
  'playlist', 'local-playlist', 'search', 'search-albums', 'search-artists'];
const previewPath = /^previews\/[a-z0-9][a-z0-9_-]{0,79}\.(jpg|png|webp|gif)(?![\s\S])/;
const creatorImage = /^[a-z0-9][a-z0-9_-]{0,63}\.(webp|png|jpg)(?![\s\S])/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function catalogPreviewLimit(index) {
  const limit = index.previewLimit;
  assert(Number.isSafeInteger(limit) && limit >= 64 && limit <= 128, 'Invalid catalog preview limit.');
  return limit;
}

function matchIndex(ancestor, submitted, key, identifies) {
  assert(Array.isArray(ancestor[key]) && Array.isArray(submitted[key]), 'Invalid submission index.');
  const entries = submitted[key].filter(identifies);
  assert(entries.length === 1, 'The submission must identify exactly one index entry.');
  const other = index => ({ ...index, [key]: index[key].filter(row => !identifies(row)) });
  assert(isDeepStrictEqual(other(ancestor), other(submitted)), 'The submission changes other index entries.');
  return entries[0];
}

function verifyAccount(id, login, author) {
  assert(author?.githubId === id && typeof author.login === 'string' &&
    author.login.toLowerCase() === login.toLowerCase(), 'The submission author must match the pull request account.');
}

function readProfileImages(profile, directory) {
  return new Set(['avatar', 'banner'].flatMap(field => {
    if (profile?.[field]?.source !== 'custom') return [];
    const filename = profile[field].asset?.path;
    assert(typeof filename === 'string' && creatorImage.test(filename), 'Invalid creator image path.');
    return [directory + filename];
  }));
}

function publishedCreator(candidate, id) {
  const index = JSON.parse(candidate.read(candidate.base, creatorIndexPath));
  assert(index.schemaVersion === 1 && Array.isArray(index.creators), 'Invalid published creator index.');
  const entries = index.creators.filter(row => row.githubId === id);
  if (!entries.length) return false;
  assert(entries.length === 1, 'Duplicate published creator profile.');
  const bytes = candidate.read(candidate.base, `catalog/creators/${id}/profile.json`);
  const profile = JSON.parse(bytes);
  assert(profile.githubId === id && sha256(bytes) === entries[0].profileSha256,
    'Invalid published creator profile.');
  return true;
}

function themeSubmission(candidate, id, login, themeId) {
  assert(publishedCreator(candidate, id), 'The creator profile must be published before its themes.');
  const identifies = row => row.themeId === themeId;
  const { ancestor, base, head, changes, read } = candidate;
  const changedIndexes = changes.filter(file => themeIndexPaths.includes(file.filename));
  assert(changedIndexes.length === 1 && changedIndexes[0].status === 'modified',
    'A theme submission must update exactly one catalog index.');
  const themeIndexPath = changedIndexes[0].filename;
  const format = themeIndexPath === currentThemeIndexPath ? 2 : 1;
  const previousIndex = JSON.parse(read(ancestor, themeIndexPath));
  const currentIndex = JSON.parse(read(base, themeIndexPath));
  const submittedIndex = JSON.parse(read(head, themeIndexPath));
  const previous = previousIndex.themes.find(identifies);
  const current = currentIndex.themes.find(identifies);
  const entry = matchIndex(previousIndex, submittedIndex, 'themes', identifies);
  assert(isDeepStrictEqual(previous, current), 'The theme changed on main. Resubmit the next revision from N-Zik.');
  let predecessor = current;
  if (format === 2 && !predecessor) {
    const previousLegacy = JSON.parse(read(ancestor, legacyThemeIndexPath)).themes.find(identifies);
    predecessor = JSON.parse(read(base, legacyThemeIndexPath)).themes.find(identifies);
    assert(isDeepStrictEqual(previousLegacy, predecessor), 'The legacy theme changed on main. Resubmit from N-Zik.');
  }
  assert(Number.isSafeInteger(entry.revision) && entry.revision === (predecessor?.revision ?? 0) + 1,
    'A theme submission must add exactly its next revision.');
  const prefix = `catalog/themes/${themeId}/`;
  const directory = `${prefix}${entry.revision}/`;
  if (predecessor) {
    const bytes = read(base, `${prefix}${predecessor.revision}/manifest.json`);
    const published = JSON.parse(bytes);
    assert(sha256(bytes) === predecessor.manifestSha256 && published.themeId === themeId &&
      published.revision === predecessor.revision && published.author?.githubId === id,
    'Only the owner of the published theme may submit an update.');
  }
  const manifestFile = directory + 'manifest.json';
  const bytes = read(head, manifestFile);
  const manifest = JSON.parse(bytes);
  verifyAccount(id, login, manifest.author);
  assert(sha256(bytes) === entry.manifestSha256 && manifest.themeId === themeId &&
    manifest.revision === entry.revision && manifest.appearance?.path === 'appearance.json' &&
    Array.isArray(manifest.previews), 'The index and manifest must identify the submitted revision.');
  const appearanceFile = directory + 'appearance.json';
  const appearance = JSON.parse(read(head, appearanceFile));
  let minimumPublishedVersionCode = minimumVersionCodeByAppearance.get(appearance?.schemaVersion);
  if (appearance.categories?.colors?.mode === 'pure-black') {
    assert(appearance.schemaVersion === 2, 'Pure Black mode requires appearance V2 for publication.');
    minimumPublishedVersionCode = Math.max(minimumPublishedVersionCode ?? 0, 101);
  }
  if (Object.hasOwn(appearance.categories?.playerAndQueue ?? {}, 'm3eAlwaysShowShapes')) {
    assert(appearance.schemaVersion === 2, 'Always Show M3E Shapes requires appearance V2 for publication.');
    minimumPublishedVersionCode = Math.max(minimumPublishedVersionCode ?? 0, 101);
  }
  assert(minimumPublishedVersionCode !== undefined, 'Unsupported appearance schema version.');
  assert(manifest.schemaVersion === format && appearance.schemaVersion === format,
    'The manifest and appearance versions must match the catalog index.');
  assert(Number.isSafeInteger(manifest.compatibility?.minVersionCode) &&
    manifest.compatibility.minVersionCode >= minimumPublishedVersionCode,
  `Published themes must require Android version code ${minimumPublishedVersionCode} or later.`);
  const legacyMaxVersionCode = minimumVersionCodeByAppearance.get(2) - 1;
  assert(format !== 1 || manifest.compatibility.minVersionCode <= legacyMaxVersionCode,
    `Published V1 themes cannot require an Android version code above ${legacyMaxVersionCode}.`);
  const previewLimit = format === 2 ? catalogPreviewLimit(currentIndex) : 36;
  assert(manifest.previews.length <= previewLimit, `The catalog allows at most ${previewLimit} previews.`);
  const expected = new Set([manifestFile, appearanceFile]);
  for (const preview of manifest.previews) {
    assert(typeof preview.path === 'string' && previewPath.test(preview.path), 'Invalid preview path.');
    expected.add(directory + preview.path);
  }
  if (format === 2 && fixedDarkPalettes.has(appearance.categories?.colors?.palette)) {
    const scenes = new Set(manifest.previews.map(preview => path.posix.basename(preview.path, path.posix.extname(preview.path))));
    const missing = baseScenes.flatMap(scene => [`${scene}-normal`, `${scene}-glass`])
      .filter(scene => !scenes.has(scene));
    assert(!missing.length, `Fixed-dark gallery is missing previews: ${missing.join(', ')}.`);
  }
  const reviewsFile = directory + 'reviews.json';
  if (changes.some(file => file.filename === reviewsFile)) {
    const reviews = JSON.parse(read(head, reviewsFile));
    assert(isDeepStrictEqual(reviews, { schemaVersion: 1, reviews: [] }),
      'A theme submission must start with an empty review list.');
    expected.add(reviewsFile);
  }
  assert(changes.length === expected.size + 1 &&
    changes.some(file => file.filename === themeIndexPath && file.status === 'modified') &&
    changes.every(file => file.filename === themeIndexPath || file.status === 'added' && expected.has(file.filename)),
  'A theme submission may only change the index and add the files of the submitted revision.');
  return { entry, indexPath: themeIndexPath,
    index: { ...currentIndex, themes: [...currentIndex.themes.filter(row => !identifies(row)), entry] } };
}

function creatorSubmission(candidate, id, login) {
  const identifies = row => row.githubId === id;
  const { ancestor, base, head, changes, read } = candidate;
  const previousIndex = JSON.parse(read(ancestor, creatorIndexPath));
  const currentIndex = JSON.parse(read(base, creatorIndexPath));
  const submittedIndex = JSON.parse(read(head, creatorIndexPath));
  const previous = previousIndex.creators.find(identifies);
  const current = currentIndex.creators.find(identifies);
  const entry = matchIndex(previousIndex, submittedIndex, 'creators', identifies);
  assert(isDeepStrictEqual(previous, current), 'The creator profile changed on main. Resubmit from N-Zik.');
  const directory = `catalog/creators/${id}/`;
  const profilePath = directory + 'profile.json';
  const bytes = read(head, profilePath);
  const profile = JSON.parse(bytes);
  verifyAccount(id, login, profile);
  assert(sha256(bytes) === entry.profileSha256, 'The index must pin the submitted creator profile.');
  const images = readProfileImages(profile, directory);
  let oldImages = new Set();
  if (current) {
    const oldBytes = read(base, profilePath);
    const oldProfile = JSON.parse(oldBytes);
    assert(oldProfile.githubId === id && sha256(oldBytes) === current.profileSha256, 'Invalid published creator profile.');
    oldImages = readProfileImages(oldProfile, directory);
  }
  assert(changes.some(file => file.filename === creatorIndexPath && file.status === 'modified') &&
    changes.some(file => file.filename === profilePath && file.status === (current ? 'modified' : 'added')) &&
    changes.every(file => {
      if (file.filename === creatorIndexPath) return file.status === 'modified';
      if (file.filename === profilePath) return file.status === (current ? 'modified' : 'added');
      if (file.status === 'removed') return oldImages.has(file.filename) && !images.has(file.filename);
      return images.has(file.filename) && (file.status === 'added' || file.status === 'modified');
    }), 'A profile submission may only change its own index entry, profile and referenced images.');
  const creators = currentIndex.creators.map(row => identifies(row) ? entry : row);
  if (!current) creators.push(entry);
  return { entry, index: { ...currentIndex, creators } };
}

function trustedCandidate(root, current) {
  const { number, base, head } = current;
  const env = { ...process.env };
  delete env.THEME_STORE_CLEANUP_TOKEN;
  delete env.THEME_STORE_MERGE_TOKEN;
  delete env.THEME_STORE_GITHUB_APP_PRIVATE_KEY;
  const run = (command, args, options = {}) => execFileSync(command, args, {
    cwd: root, env, maxBuffer: 4 * 1024 * 1024 + 1, ...options,
  });
  const git = (...args) => run('git', args);
  const revision = (...args) => git(...args).toString('utf8').trim();
  assert(Number.isSafeInteger(number) && number > 0 && /^[0-9a-f]{40}$/.test(base.sha)
    && /^[0-9a-f]{40}$/.test(head.sha), 'Invalid pull request revisions.');
  assert(revision('rev-parse', 'HEAD') === base.sha,
    'Main changed since approval. Reapply accepted against current main.');
  git('fetch', '--no-tags', 'origin', `refs/pull/${number}/head`);
  assert(revision('rev-parse', 'FETCH_HEAD') === head.sha, 'The pull request branch changed after approval.');
  const ancestor = revision('merge-base', base.sha, head.sha);
  function read(ref, filename) {
    const entry = revision('ls-tree', ref, '--', filename);
    assert(/^100644 blob [0-9a-f]{40}\t/.test(entry), `Expected a regular data file: ${filename}`);
    return git('show', `${ref}:${filename}`);
  }
  function diff(from, to) {
    const fields = git('diff', '--name-status', '--no-renames', '-z', from, to, '--').toString('utf8').split('\0');
    fields.pop();
    const changes = [];
    const statuses = { A: 'added', M: 'modified', D: 'removed' };
    for (let i = 0; i < fields.length; i += 2) {
      const status = statuses[fields[i]];
      const filename = fields[i + 1];
      assert(status && /^[a-z0-9][a-z0-9._/-]*(?![\s\S])/.test(filename) &&
        filename.split('/').every(part => part && part !== '.' && part !== '..'), 'Unexpected change type or file path.');
      changes.push({ status, filename });
    }
    return changes;
  }
  const changes = diff(ancestor, head.sha);
  const fileLimit = changes.some(file => file.filename === currentThemeIndexPath)
    ? catalogPreviewLimit(JSON.parse(read(base.sha, currentThemeIndexPath))) + 4
    : 40;
  assert(changes.length > 0 && changes.length <= fileLimit, 'Unexpected submission file count.');
  function blob(filename) {
    read(head.sha, filename);
    return revision('rev-parse', `${head.sha}:${filename}`);
  }
  function validate(changed, source, replacement) {
    for (const { filename, status } of changed) {
      const destination = path.join(root, filename);
      if (status === 'removed') {
        fs.unlinkSync(destination);
      } else {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, replacement?.filename === filename ? replacement.bytes : read(source, filename));
      }
    }
    run('python', ['-B', '.github/scripts/validate_catalog.py'], { stdio: 'inherit' });
  }
  let validatedTree;
  let computedTree;
  function mergeTree() {
    if (computedTree !== undefined) return computedTree;
    try {
      const merged = revision('merge-tree', '--write-tree', base.sha, head.sha);
      assert(/^[0-9a-f]{40}$/.test(merged), 'Git did not produce a candidate tree.');
      computedTree = merged;
    } catch (error) {
      if (error.status !== 1) throw error;
      computedTree = null;
    }
    return computedTree;
  }
  function validateTree(tree) {
    const mergedChanges = diff(base.sha, tree);
    const allowedPaths = new Set(changes.map(file => file.filename));
    assert(mergedChanges.every(file => allowedPaths.has(file.filename)), 'The merge changes files outside the checked submission.');
    validate(mergedChanges, tree);
    validatedTree = tree;
  }
  return {
    ancestor, base: base.sha, head: head.sha, changes, read, blob, mergeTree,
    validateMerged() {
      // This creates a candidate tree without checking out or running anything from the fork.
      const merged = mergeTree();
      assert(merged, 'Git did not produce a conflict-free candidate tree.');
      validateTree(merged);
    },
    publishValidatedMerge(message, token) {
      assert(validatedTree, 'The merge tree must pass catalog validation before publication.');
      const commit = revision(
        '-c', 'user.name=github-actions[bot]',
        '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit-tree', validatedTree, '-p', base.sha, '-p', head.sha, '-m', message,
      );
      const pushEnv = token ? {
        ...env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64'),
        GIT_TERMINAL_PROMPT: '0',
      } : env;
      // The validated base is the commit's first parent. The explicit lease also
      // makes Git reject the update if main was changed or rewound during validation.
      run('git', ['push', `--force-with-lease=refs/heads/main:${base.sha}`,
        'origin', `${commit}:refs/heads/main`], { env: pushEnv });
      return commit;
    },
    validateRepairedIndex(index, indexPath = legacyThemeIndexPath) {
      this.validateRepairedIndexes(new Map([[indexPath, index]]));
    },
    validateRepairedIndexes(indexes) {
      // Resolve only owner-checked indexes against trusted main. Publishing this
      // tree upstream avoids importing unrelated workflow changes into the fork.
      const indexPaths = [...indexes.keys()];
      assert(indexPaths.length > 0 && indexPaths.every(indexPath =>
        [...themeIndexPaths, creatorIndexPath].includes(indexPath) &&
        changes.some(file => file.filename === indexPath && file.status === 'modified')) &&
        (indexes.has(creatorIndexPath) ? indexes.size === 1 : changes.every(file =>
          indexes.has(file.filename) || (indexes.size === 1 && file.status === 'added'))),
      'Index repair requires an owner-checked theme or creator submission.');
      const temporaryRoot = path.resolve(require('node:os').tmpdir());
      const directory = fs.mkdtempSync(path.join(temporaryRoot, 'nzik-candidate-index-'));
      const indexEnv = { ...env, GIT_INDEX_FILE: path.join(directory, 'index') };
      const indexed = (...args) => run('git', args, { env: indexEnv }).toString('utf8').trim();
      try {
        indexed('read-tree', base.sha);
        for (const file of changes) {
          if (!indexes.has(file.filename)) {
            const existing = revision('ls-tree', base.sha, '--', file.filename);
            const previous = revision('ls-tree', ancestor, '--', file.filename);
            const submitted = file.status === 'removed' ? '' : `100644 blob ${blob(file.filename)}\t${file.filename}`;
            assert(existing === previous || existing === submitted,
              `Index repair cannot replace a conflicting file ${file.status === 'added' ? 'added to' : 'changed on'} main.`);
          }
          if (file.status === 'removed') {
            indexed('update-index', '--force-remove', '--', file.filename);
            continue;
          }
          const sha = indexes.has(file.filename)
            ? run('git', ['hash-object', '-w', '--stdin'], {
              input: Buffer.from(JSON.stringify(indexes.get(file.filename), null, 2) + '\n'),
            }).toString('utf8').trim()
            : blob(file.filename);
          indexed('update-index', '--add', '--cacheinfo', '100644', sha, file.filename);
        }
        validateTree(indexed('write-tree'));
      } finally {
        assert(path.dirname(directory) === temporaryRoot, 'Unexpected candidate index directory.');
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

module.exports = { themeSubmission, creatorSubmission, trustedCandidate, publishedCreator };
