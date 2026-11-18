const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const labelSubmission = require('./label_submission.cjs');

const workflow = fs.readFileSync(path.join(__dirname, '../workflows/blocked-contributors.yml'), 'utf8');
const script = workflow.slice(workflow.indexOf('            const event = context.payload;'));
const functions = [
  ['async function forkCleanupToken(', 'async function cleanSubmissionBranch('],
  ['async function resetSubmissionBranch(', 'async function finishPublication('],
].map(([start, end]) => script.slice(script.indexOf(start), script.indexOf(end))).join('\n');

const original = 'a'.repeat(40);
const main = 'b'.repeat(40);
const ancestor = 'e'.repeat(40);
const repaired = 'c'.repeat(40);
const concurrent = 'd'.repeat(40);
const branch = 'nzik/theme-9fabc1ee-37b1-4d82-8d3b-f7b141ceb831';
const fork = { id: 2, owner: { id: 101, login: 'Creator' }, name: 'N-Zik-Theme-Store', default_branch: 'main' };

test('withdrawal requires all indexed revisions and preserves unrelated catalog metadata', async () => {
  const themeId = branch.slice('nzik/theme-'.length);
  const withdrawalRef = `nzik/withdraw-${themeId}`;
  const themeIndexPaths = ['catalog/themes/index.json', 'catalog/themes/index-v2.json'];
  const manifest = revision => Buffer.from(JSON.stringify({ themeId, revision, author: { githubId: 101 } }));
  const entry = revision => ({
    themeId, revision, manifestSha256: require('node:crypto').createHash('sha256').update(manifest(revision)).digest('hex'),
  });
  const indexes = new Map([
    [themeIndexPaths[0], { schemaVersion: 1, themes: [entry(1)] }],
    [themeIndexPaths[1], { schemaVersion: 1, previewLimit: 80, legacyMaxVersionCode: 98, themes: [entry(2)] }],
  ]);
  const functions = script.slice(script.indexOf('            function readThemeIndex('),
    script.indexOf('            const themeLabels'));
  const validate = vm.runInNewContext(functions + '\nwithdrawalIndexes', {
    isWithdrawal: true, pull: { user: { id: 101 }, head: { ref: withdrawalRef } },
    withdrawalBranch: [withdrawalRef, themeId], themeIndexPaths,
    isDeepStrictEqual: require('node:util').isDeepStrictEqual, require,
    readFile: async path => indexes.has(path) ? JSON.stringify(indexes.get(path)) : manifest(Number(path.split('/')[3])),
  });
  const current = { base: { sha: main }, head: { repo: fork, ref: withdrawalRef } };
  const candidate = {
    ancestor, head: original, changes: [{ filename: themeIndexPaths[1], status: 'modified' }],
    read: (sha, path) => JSON.stringify(sha === ancestor ? indexes.get(path) : { ...indexes.get(path), themes: [] }),
  };
  await assert.rejects(validate(current, candidate), /every catalog that lists it/);
  candidate.changes.push({ filename: themeIndexPaths[0], status: 'modified' });
  const repaired = await validate(current, candidate);
  assert.deepEqual(JSON.parse(JSON.stringify(repaired.get(themeIndexPaths[1]))), {
    schemaVersion: 1, previewLimit: 80, legacyMaxVersionCode: 98, themes: [],
  });
  assert.equal(repaired.get(themeIndexPaths[0]).themes.length, 0);
});

function harness({ race, missingInstallation = false, environment = {} } = {}) {
  let head = original;
  let reads = 0;
  const commands = [];
  const apiCalls = [];
  const appCalls = [];
  const secrets = [];
  const failures = [];
  const statuses = [];
  const removed = [];
  const temporaryRoot = path.resolve(os.tmpdir());
  const temporaryDirectory = path.join(temporaryRoot, 'nzik-fork-ref-test');
  const current = { head: { repo: fork, ref: branch, sha: original }, base: { sha: main } };
  const cleanup = { head: original, reset: ancestor };
  const context = {
    Buffer,
    process: { env: { PATH: process.env.PATH, THEME_STORE_GITHUB_APP_PRIVATE_KEY: 'private-key', ...environment } },
    event: { repository: { id: 1 } },
    context: { repo: { owner: 'N-Zik-Group', repo: 'N-Zik-Theme-Store' } },
    pull: { number: 7, user: { id: 101 } },
    indexPath: 'catalog/themes/index.json',
    currentLabels: new Set(['accepted']),
    target: { issue_number: 7 },
    core: {
      setSecret: value => secrets.push(value),
      setFailed: value => failures.push(value),
      notice: () => {},
      warning: () => {},
    },
    status: async value => statuses.push(value),
    fetch: async (url, options) => {
      appCalls.push({ url, options });
      if (url.endsWith('/installation')) return {
        status: missingInstallation ? 404 : 200, ok: !missingInstallation,
        json: async () => ({ id: 501, account: { id: fork.owner.id }, permissions: { contents: 'write' } }),
      };
      return { status: 201, ok: true, json: async () => ({ token: 'installation-token' }) };
    },
    require: name => {
      if (name === 'node:crypto') return { ...require('node:crypto'), sign: () => Buffer.from('signature') };
      if (name === 'node:fs') return {
        mkdtempSync: prefix => { assert.equal(prefix, path.join(temporaryRoot, 'nzik-fork-ref-')); return temporaryDirectory; },
        rmSync: (directory, options) => removed.push({ directory, options }),
      };
      if (name === 'node:child_process') return {
        execFileSync: (command, args, options) => {
          commands.push({ command, args, options });
          if (args[0] === 'fetch' && race === 'before-push') head = concurrent;
          if (args[0] !== 'push') return Buffer.alloc(0);
          assert.equal(args[1], `--force-with-lease=refs/heads/${branch}:${original}`);
          if (head !== original) throw new Error('stale info');
          head = args.at(-1).split(':')[0] || null;
          return Buffer.alloc(0);
        },
      };
      return require(name);
    },
    github: { rest: {
      git: {
        getRef: async args => {
          apiCalls.push({ method: 'getRef', args });
          const result = { data: { object: { sha: head } } };
          if (++reads === 1 && race === 'after-read') head = concurrent;
          return result;
        },
        getCommit: async args => { apiCalls.push({ method: 'getCommit', args }); return { data: { tree: { sha: main } } }; },
        createTree: async args => { apiCalls.push({ method: 'createTree', args }); return { data: { sha: repaired } }; },
        createCommit: async args => { apiCalls.push({ method: 'createCommit', args }); return { data: { sha: repaired } }; },
        updateRef: async () => { assert.fail('Ref writes must use a Git lease'); },
      },
      pulls: { get: async () => ({ data: { head: { sha: head }, changed_files: 0 } }), list: async () => ({ data: [] }) },
      issues: { removeLabel: async args => apiCalls.push({ method: 'removeLabel', args }) },
    } },
  };
  context.github.paginate = async (method, args) => (await method(args)).data;
  vm.createContext(context);
  vm.runInContext(functions, context);
  return { context, current, cleanup, commands, apiCalls, appCalls, secrets, failures, statuses, removed, head: () => head };
}

test('moderation workflow script parses', () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('github', 'context', 'core', script));
});

function lifecycle({ liveHead = original, decision = 'refused', resetFailure = false, deletionFailure = false,
  approvalRace, resetRace, creatorProfile = false, publishedCreator = true } = {}) {
  const repo = { owner: 'N-Zik-Group', repo: 'N-Zik-Theme-Store' };
  const labels = new Set([decision, 'reason: other', 'in review']);
  const comments = [];
  const failures = [];
  const writes = [];
  const publications = [];
  const labelFailures = [];
  let validatedRepair = false;
  let forkReads = 0;
  const faults = { reset: resetFailure, deletion: deletionFailure, close: false, publication: false };
  const otherPulls = { upstream: [], fork: [] };
  let refHead = liveHead;
  let accounts = [];
  let approvalId = 900;
  const current = {
    number: 7, user: { id: 101, login: 'Creator' },
    head: { repo: fork, ref: creatorProfile ? 'nzik/creator-profile-101' : branch, sha: liveHead },
    base: { sha: main, ref: 'main', repo: { owner: { login: repo.owner }, name: repo.repo } },
    state: 'open', merged: false, locked: false, draft: false, changed_files: 3,
  };
  const snapshot = () => JSON.parse(JSON.stringify({ ...current, labels: [...labels].map(name => ({ name })) }));
  const initial = snapshot();
  initial.head.sha = original;
  const missing = () => Object.assign(new Error('Not found'), { status: 404 });
  const github = { rest: {
    checks: { listForRef: async args => ({ data: [{ id: 1, name: 'validate', head_sha: args.ref, status: 'completed', conclusion: 'success', check_suite: { id: 1 } }] }) },
    actions: { listWorkflowRunsForRepo: async args => ({ data: [{ id: 1, workflow_id: 1, head_sha: args.head_sha, check_suite_id: 1, path: '.github/workflows/validate-catalog.yml', status: 'completed', conclusion: 'success' }] }) },
    pulls: {
      get: async () => ({ data: snapshot() }),
      update: async args => {
        if (faults.close) throw new Error('Transient close failure');
        current.state = args.state;
        return { data: snapshot() };
      },
      list: async args => ({ data: args.owner === repo.owner ? otherPulls.upstream : otherPulls.fork }),
      listFiles: async () => {
        if (faults.publication) throw new Error('Transient publication bookkeeping failure');
        return { data: [] };
      },
    },
    repos: {
      listCommitStatusesForRef: async () => ({ data: [] }),
      getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }),
      getContent: async () => ({ data: { sha: main,
        content: Buffer.from(JSON.stringify({ schemaVersion: 1, accounts })).toString('base64') } }),
      compareCommits: async args => {
        assert.ok([original, concurrent].includes(args.head));
        assert.equal(args.base, main);
        return { data: { merge_base_commit: { sha: ancestor } } };
      },
      getBranch: async () => {
        if (!refHead) throw missing();
        return { data: { protected: false, commit: { sha: refHead } } };
      },
      createOrUpdateFileContents: async args => {
        accounts = JSON.parse(Buffer.from(args.content, 'base64')).accounts;
        return { data: {} };
      },
    },
    git: { getCommit: async () => ({ data: { parents: [{ sha: main }, { sha: original }] } }), getRef: async args => {
      if (args.ref === 'heads/main') return { data: { object: { sha: main } } };
      if (++forkReads === 1 && resetRace === 'before-read') {
        refHead = concurrent;
        current.head.sha = concurrent;
      }
      if (!refHead) throw missing();
      return { data: { object: { sha: refHead } } };
    } },
    issues: {
      get: async () => ({ data: { locked: current.locked, active_lock_reason: current.active_lock_reason } }),
      createLabel: async () => {},
      addLabels: async args => { args.labels.forEach(name => labels.add(name)); },
      removeLabel: async args => { labels.delete(args.name); },
      listComments: async () => ({ data: comments }),
      listEvents: async () => ({ data: [{ id: approvalId, event: 'labeled', label: { name: 'accepted' }, actor: { login: 'Moderator' } }] }),
      createComment: async args => {
        if (current.locked) throw new Error('Unable to create comment because issue is locked');
        comments.push({ id: comments.length + 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: args.body });
      },
      updateComment: async args => {
        if (current.locked) throw Object.assign(new Error('Unable to create comment because issue is locked.'), { status: 403 });
        comments.find(comment => comment.id === args.comment_id).body = args.body;
      },
      unlock: async () => { current.locked = false; },
      lock: async () => { current.locked = true; },
    },
  } };
  github.paginate = async (method, args) => (await method(args)).data;
  const temp = path.join(path.resolve(os.tmpdir()), 'nzik-lifecycle-test');
  const globals = {
    Buffer, github, setTimeout: callback => callback(),
    process: { env: { PATH: process.env.PATH, THEME_STORE_GITHUB_APP_PRIVATE_KEY: 'private-key',
      GITHUB_WORKSPACE: temp, THEME_STORE_MERGE_TOKEN: 'upstream-token' } },
    setTimeout: callback => callback(),
    core: { setSecret() {}, info() {}, warning() {}, notice() {}, setFailed: message => failures.push(message) },
    fetch: async url => ({ ok: true, status: 200, json: async () => url.endsWith('/installation')
      ? { id: 501, account: { id: fork.owner.id }, permissions: { contents: 'write' } }
      : { token: 'installation-token' } }),
    require: name => {
      if (name.endsWith('validate_submission.cjs')) return {
        themeSubmission: () => ({ indexPath: 'catalog/themes/index-v2.json',
          index: { schemaVersion: 1, previewLimit: 80, themes: [] } }),
        creatorSubmission: (_candidate, authorId, authorLogin) => {
          assert.equal(authorId, current.user.id);
          assert.equal(authorLogin, current.user.login);
          return { index: { schemaVersion: 1, creators: [] } };
        },
        publishedCreator: () => publishedCreator,
        trustedCandidate: () => ({
          head: original, changes: [], mergeTree: () => null,
          validateRepairedIndex: (index, indexPath) => {
            assert.equal(indexPath, creatorProfile ? 'catalog/creators/index.json' : 'catalog/themes/index-v2.json');
            assert.ok(creatorProfile ? index.creators : index.themes);
            validatedRepair = true;
            if (approvalRace === 'head') { current.head.sha = concurrent; refHead = concurrent; }
            if (approvalRace === 'decision') labels.delete('accepted');
          },
          publishValidatedMerge: () => {
            assert.ok(validatedRepair);
            publications.push({ parent: original });
            current.merged = true;
            current.state = 'closed';
            current.merged_at = '2026-11-15T12:00:00Z';
            current.merge_commit_sha = repaired;
          },
        }),
      };
      if (name === 'node:crypto') return { ...require('node:crypto'), sign: () => Buffer.from('signature') };
      if (name === 'node:fs') return { mkdtempSync: () => temp, rmSync() {} };
      if (name === 'node:child_process') return { execFileSync: (_command, args) => {
        if (args[0] !== 'push') return Buffer.alloc(0);
        const next = args.at(-1).split(':')[0] || null;
        if (next ? faults.reset : faults.deletion) throw new Error('Transient Git failure');
        if (next && resetRace === 'during-push') {
          refHead = concurrent;
          current.head.sha = concurrent;
          throw new Error('stale info');
        }
        const expected = args[1].split(':').at(-1);
        assert.equal(refHead, expected, 'Git must use the persisted expected head');
        writes.push({ expected, next });
        refHead = next;
        if (next) { current.head.sha = next; current.changed_files = next === ancestor ? 0 : 3; }
        if (next && resetRace === 'after-push') {
          refHead = concurrent;
          current.head.sha = concurrent;
          current.changed_files = 3;
        }
        return Buffer.alloc(0);
      } };
      return require(name);
    },
  };
  return {
    current, labels, comments, failures, faults, writes, publications, otherPulls, github, labelFailures,
    head: () => refHead, blocked: () => accounts,
    publishCreator() { publishedCreator = true; },
    reapprove() { approvalId++; },
    push(sha) { refHead = sha; current.head.sha = sha; current.changed_files = 3; },
    async run({ dispatch = false, eventHead = original, eventLabels = initial.labels, action = 'labeled', label = decision, runId = 42 } = {}) {
      const payload = { repository: { id: 1, default_branch: 'main' },
        ...(dispatch ? { inputs: { pull_request_number: '7' } }
          : { action, label: { name: label }, sender: { login: 'Moderator' },
            pull_request: { ...initial, head: { ...initial.head, sha: eventHead }, labels: eventLabels } }) };
      try { await labelSubmission({ github, context: { repo, payload } }); }
      catch (error) { labelFailures.push(error.message); }
      const context = vm.createContext({ ...globals, context: { repo,
        runId, eventName: dispatch ? 'workflow_dispatch' : 'pull_request_target', payload } });
      await vm.runInContext(`(async () => {\n${script}\n})()`, context);
    },
  };
}

test('a refusal queued for an older head preserves newer work and requests fresh review', async () => {
  const h = lifecycle({ liveHead: concurrent });
  await h.run();
  assert.equal(h.head(), concurrent);
  assert.equal(h.writes.length, 0);
  assert.equal(h.current.state, 'open');
  assert.equal(h.current.locked, false);
  assert.ok(h.labels.has('in review'));
  assert.ok(!h.labels.has('refused'));
  assert.ok(!h.labels.has('reason: other'));
  assert.ok(h.comments.some(comment => comment.body.includes('nzik-moderation-stale:') &&
    comment.body.includes(original) && comment.body.includes(concurrent)));
});

test('a delayed stale refusal cannot remove fresh moderation labels on the newer head', async () => {
  const h = lifecycle({ liveHead: concurrent });
  await h.run();
  h.labels.add('refused');
  h.labels.add('reason: other');
  const freshLabels = [...h.labels].map(name => ({ name }));
  await h.run();
  assert.ok(h.labels.has('refused'));
  assert.ok(h.labels.has('reason: other'));
  assert.equal(h.current.state, 'open');
  assert.equal(h.head(), concurrent);
  await h.run({ eventHead: concurrent, eventLabels: freshLabels });
  assert.equal(h.current.state, 'closed');
  assert.equal(h.head(), null);
  assert.equal(h.writes[0].expected, concurrent);
});

test('an incomplete label event cannot borrow a later reason to refuse a submission', async () => {
  const h = lifecycle();
  await h.run({ eventLabels: [{ name: 'refused' }] });
  assert.equal(h.current.state, 'open');
  assert.equal(h.writes.length, 0);
  assert.equal(h.comments.length, 0);
});

test('a label event with an older reason cannot act on a later moderation decision', async () => {
  const h = lifecycle();
  await h.run({ eventLabels: [{ name: 'refused' }, { name: 'reason: invalid theme' }] });
  assert.equal(h.current.state, 'open');
  assert.equal(h.writes.length, 0);
  assert.ok(h.labels.has('reason: other'));
});

test('a stale ban blocks the account while preserving newer branch work', async () => {
  const h = lifecycle({ liveHead: concurrent, decision: 'ban' });
  await h.run();
  assert.equal(h.head(), concurrent);
  assert.equal(h.writes.length, 0);
  assert.equal(h.blocked()[0].githubId, 101);
  assert.equal(h.current.state, 'closed');
  assert.ok(h.labels.has('ban'));
  assert.ok(h.labels.has('cleanup pending'));
  assert.ok(!h.comments.some(comment => comment.body.includes('Submission removed from the branch.')));
});

for (const resetRace of ['before-read', 'during-push', 'after-push']) {
  test(`a refusal that becomes stale ${resetRace} remains open for fresh review`, async () => {
    const h = lifecycle({ resetRace });
    await h.run();
    assert.equal(h.head(), concurrent);
    assert.equal(h.current.state, 'open');
    assert.equal(h.current.locked, false);
    assert.ok(h.labels.has('in review'));
    assert.ok(!h.labels.has('refused'));
    assert.ok(!h.labels.has('cleanup pending'));
    assert.ok(!h.writes.some(write => write.next === null));
    assert.ok(h.comments.some(comment => comment.body.includes('nzik-moderation-stale:')));
    assert.ok(h.comments.some(comment => comment.body.includes('nzik-cleanup-cancelled')));
  });
}

for (const dispatch of [false, true]) {
  test(`failed reset can be retried after closure via ${dispatch ? 'workflow_dispatch' : 'the original event'}`, async () => {
    const h = lifecycle({ resetFailure: true });
    await h.run();
    assert.equal(h.head(), original);
    assert.equal(h.current.state, 'closed');
    assert.ok(h.current.locked);
    assert.ok(h.labels.has('cleanup pending'));
    h.faults.reset = false;
    h.failures.length = 0;
    await h.run({ dispatch });
    assert.equal(h.head(), null);
    assert.deepEqual(h.writes, [{ expected: original, next: ancestor }, { expected: ancestor, next: null }]);
    assert.ok(!h.labels.has('cleanup pending'));
    assert.equal(h.failures.length, 0);
  });
}

test('a failed deletion stays pending and retries without resetting the branch again', async () => {
  const h = lifecycle({ deletionFailure: true });
  await h.run();
  assert.equal(h.head(), ancestor);
  assert.ok(h.labels.has('cleanup pending'));
  h.failures.length = 0;
  await h.run({ dispatch: true });
  assert.match(h.failures[0], /Cleanup remains pending/);
  h.faults.deletion = false;
  await h.run({ dispatch: true });
  assert.equal(h.head(), null);
  assert.equal(h.writes.filter(write => write.next === ancestor).length, 1);
  assert.ok(!h.labels.has('cleanup pending'));
});

test('cleanup retries remain bound to the original head when new work appears after failure', async () => {
  const h = lifecycle({ resetFailure: true });
  await h.run();
  h.push(concurrent);
  h.faults.reset = false;
  await h.run({ dispatch: true });
  assert.equal(h.head(), concurrent);
  assert.equal(h.writes.length, 0);
  assert.ok(h.labels.has('cleanup pending'));
});

for (const repository of ['upstream', 'fork']) {
  test(`cleanup does not reset a branch shared with another open ${repository} pull request`, async () => {
    const h = lifecycle({ resetFailure: true });
    await h.run();
    h.faults.reset = false;
    h.otherPulls[repository].push({ number: 99 });
    await h.run({ dispatch: true });
    assert.equal(h.head(), original);
    assert.equal(h.writes.length, 0);
    assert.ok(h.labels.has('cleanup pending'));
  });
}

for (const dispatch of [false, true]) {
  test(`a reset interrupted before closure resumes its persisted cleanup via ${dispatch ? 'dispatch' : 'rerun'}`, async () => {
    const h = lifecycle();
    h.faults.close = true;
    await assert.rejects(h.run(), /Transient close failure/);
    assert.equal(h.head(), ancestor);
    assert.equal(h.current.state, 'open');
    assert.ok(h.labels.has('cleanup pending'));
    h.faults.close = false;
    await h.run({ dispatch });
    assert.equal(h.head(), null);
    assert.equal(h.current.state, 'closed');
    assert.equal(h.writes.filter(write => write.next === ancestor).length, 1);
    assert.ok(!h.labels.has('cleanup pending'));
    assert.ok(!h.comments.some(comment => comment.body.includes('nzik-moderation-stale:')));
  });
}

test('repaired approval follows the common validation, merge confirmation and cleanup path', async () => {
  const h = lifecycle({ decision: 'accepted' });
  await h.run();
  assert.deepEqual(h.publications, [{ parent: original }]);
  assert.deepEqual(h.writes, [{ expected: original, next: null }]);
  assert.ok(h.labels.has('merged'));
  assert.ok(h.current.locked);
});

test('repaired creator approval follows validation, exact-head merge confirmation and cleanup', async () => {
  const h = lifecycle({ decision: 'accepted', creatorProfile: true });
  await h.run();
  assert.deepEqual(h.publications, [{ parent: original }]);
  assert.deepEqual(h.writes, [{ expected: original, next: null }]);
  assert.ok(h.labels.has('merged'));
  assert.ok(h.current.locked);
});

for (const dispatch of [false, true]) {
  test(`merged cleanup failure stays visible and retries via ${dispatch ? 'dispatch' : 'the approval event'}`, async () => {
    const h = lifecycle({ decision: 'accepted', deletionFailure: true });
    await h.run();
    assert.equal(h.current.merged, true);
    assert.equal(h.head(), original);
    assert.ok(h.labels.has('merged'));
    assert.ok(h.labels.has('cleanup pending'));
    assert.match(h.failures.at(-1), /Publication succeeded.*cleanup remains pending/);
    const record = h.comments.find(comment => comment.body.startsWith('<!-- nzik-cleanup-state '));
    assert.match(record.body, new RegExp(`"head":"${original}"`));
    assert.match(record.body, /only delete the branch at commit/);
    h.faults.deletion = false;
    h.failures.length = 0;
    await h.run({ dispatch });
    assert.equal(h.head(), null);
    assert.equal(h.publications.length, 1);
    assert.deepEqual(h.failures, []);
    assert.ok(!h.labels.has('cleanup pending'));
    assert.match(record.body, /cleanup completed/);
  });
}

test('merged cleanup retries preserve new branch work using the recorded approved head', async () => {
  const h = lifecycle({ decision: 'accepted', deletionFailure: true });
  await h.run();
  h.faults.deletion = false;
  h.push(concurrent);
  await h.run({ dispatch: true });
  assert.equal(h.head(), concurrent);
  assert.equal(h.writes.length, 0);
  assert.equal(h.publications.length, 1);
  assert.ok(h.labels.has('cleanup pending'));
  const record = h.comments.find(comment => comment.body.startsWith('<!-- nzik-cleanup-state '));
  assert.match(record.body, new RegExp(`"head":"${original}"`));
});

test('merged cleanup retry succeeds when the branch was already deleted', async () => {
  const h = lifecycle({ decision: 'accepted', deletionFailure: true });
  await h.run();
  h.push(null);
  h.failures.length = 0;
  await h.run({ dispatch: true });
  assert.deepEqual(h.failures, []);
  assert.ok(!h.labels.has('cleanup pending'));
  assert.equal(h.writes.length, 0);
});

for (const dispatch of [false, true]) {
test(`merged cleanup without a saved record uses the merge parent for ${dispatch ? 'dispatch' : 'a later approval event'}`, async () => {
  const h = lifecycle({ decision: 'accepted' });
  await h.run();
  h.comments.splice(h.comments.findIndex(comment => comment.body.startsWith('<!-- nzik-cleanup-state ')), 1);
  h.writes.length = 0;
  h.push(concurrent);
  await h.run({ dispatch, eventHead: concurrent });
  assert.equal(h.head(), concurrent);
  assert.deepEqual(h.writes, []);
  assert.match(h.failures.at(-1), /cleanup remains pending/);
  assert.ok(h.labels.has('cleanup pending'));
  const record = h.comments.find(comment => comment.body.startsWith('<!-- nzik-cleanup-state '));
  assert.match(record.body, new RegExp(`"head":"${original}"`));
});
}

test('completed merged cleanup does not reconsider a subsequently reused branch', async () => {
  const h = lifecycle({ decision: 'accepted' });
  await h.run();
  h.writes.length = 0;
  h.push(concurrent);
  await h.run({ dispatch: true });
  assert.equal(h.head(), concurrent);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.failures, []);
  assert.ok(!h.labels.has('cleanup pending'));
});

test('a legacy refusal record is replaced using authoritative merge evidence', async () => {
  const h = lifecycle({ decision: 'accepted', deletionFailure: true });
  await h.run();
  const record = h.comments.find(comment => comment.body.startsWith('<!-- nzik-cleanup-state '));
  record.body = record.body.replace('"decision":"merged"', '"decision":"refused"');
  h.faults.deletion = false;
  h.failures.length = 0;
  await h.run({ dispatch: true });
  assert.equal(h.head(), null);
  assert.deepEqual(h.failures, []);
  assert.ok(!h.labels.has('cleanup pending'));
  assert.match(record.body, /"decision":"merged"/);
});

test('publication bookkeeping failure leaves durable cleanup that manual retry completes', async () => {
  const h = lifecycle({ decision: 'accepted' });
  h.faults.publication = true;
  await assert.rejects(h.run(), /publication bookkeeping/);
  assert.equal(h.current.merged, true);
  assert.equal(h.head(), original);
  assert.ok(h.labels.has('cleanup pending'));
  const record = h.comments.find(comment => comment.body.startsWith('<!-- nzik-cleanup-state '));
  assert.match(record.body, new RegExp(`"head":"${original}"`));
  h.faults.publication = false;
  await h.run({ dispatch: true });
  assert.equal(h.head(), null);
  assert.ok(!h.labels.has('cleanup pending'));
});

for (const creatorProfile of [false, true]) {
  for (const approvalRace of ['head', 'decision']) {
    test(`repaired ${creatorProfile ? 'creator' : 'theme'} approval stops if the ${approvalRace} changes during validation`, async () => {
      const h = lifecycle({ decision: 'accepted', approvalRace, creatorProfile });
      await h.run();
      assert.equal(h.publications.length, 0);
      assert.equal(h.writes.length, 0);
      assert.match(h.failures[0], /changed during validation/);
    });
  }
}

test('refusal reset uses a scoped App token and the existing merge base, without importing main workflows', async () => {
  const h = harness();
  assert.equal(await h.context.resetSubmissionBranch(h.current, h.cleanup), true);
  assert.equal(h.head(), ancestor);
  assert.equal(h.appCalls.length, 2);
  assert.deepEqual(JSON.parse(h.appCalls[1].options.body), { repository_ids: [fork.id], permissions: { contents: 'write' } });
  assert.ok(h.apiCalls.filter(call => call.method === 'getRef')
    .every(call => call.args.headers.authorization === 'Bearer installation-token'));
});

for (const race of ['after-read', 'before-push']) {
    test(`reset preserves new work pushed ${race}`, async () => {
      const h = harness({ race });
      const promise = h.context.resetSubmissionBranch(h.current, h.cleanup);
      await assert.rejects(promise, /New work was preserved/);
      assert.equal(h.head(), concurrent);
      assert.equal(h.statuses.length, 0);
      assert.equal(h.removed.length, 1);
    });
}

test('branch deletion uses the same explicit lease without fetching a replacement', () => {
  const h = harness();
  h.context.writeSubmissionRef(fork, branch, original, null, 'installation-token');
  assert.equal(h.head(), null);
  assert.deepEqual(h.commands.map(call => call.args[0]), ['init', 'push']);
});

test('Git credentials are masked and isolated from subprocess arguments and other secrets', async () => {
  const h = harness({ environment: { THEME_STORE_CLEANUP_TOKEN: 'legacy-token', THEME_STORE_MERGE_TOKEN: 'upstream-token' } });
  await h.context.resetSubmissionBranch(h.current, h.cleanup);
  const encoded = Buffer.from('x-access-token:installation-token').toString('base64');
  assert.ok(h.secrets.includes('installation-token'));
  assert.ok(h.secrets.includes(encoded));
  for (const call of h.commands) {
    assert.equal(call.command, 'git');
    assert.equal(call.options.env.GIT_CONFIG_VALUE_0, 'AUTHORIZATION: basic ' + encoded);
    assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(call.options.env.GIT_CONFIG_GLOBAL, path.join(call.options.cwd, 'global.config'));
    const args = JSON.stringify(call.args);
    for (const secret of ['installation-token', encoded, 'legacy-token', 'private-key', 'upstream-token']) {
      assert.ok(!args.includes(secret));
    }
    for (const name of ['THEME_STORE_CLEANUP_TOKEN', 'THEME_STORE_GITHUB_APP_PRIVATE_KEY', 'THEME_STORE_MERGE_TOKEN']) {
      assert.equal(call.options.env[name], undefined);
    }
  }
  assert.equal(h.removed.length, 1);
});

test('missing installation stops reset before any branch write', async () => {
  const h = harness({ missingInstallation: true });
  await assert.rejects(h.context.resetSubmissionBranch(h.current, h.cleanup), /N-Zik Sign In installed/);
  assert.equal(h.commands.length, 0);
  assert.equal(h.head(), original);
});

test('legacy cleanup token and upstream workflow token retain their existing roles', async () => {
  const h = harness({ environment: {
    THEME_STORE_GITHUB_APP_PRIVATE_KEY: '', THEME_STORE_CLEANUP_TOKEN: 'legacy-token', THEME_STORE_MERGE_TOKEN: 'upstream-token',
  } });
  assert.equal(await h.context.forkCleanupToken(fork), 'legacy-token');
  assert.equal(await h.context.forkCleanupToken({ ...fork, id: 1 }), 'upstream-token');
  assert.equal(h.appCalls.length, 0);
});

test('ref writes reject default branches and malformed inputs before starting Git', () => {
  const h = harness();
  for (const args of [
    [fork, 'main', original, main, 'token'],
    [{ ...fork, default_branch: branch }, branch, original, main, 'token'],
    [fork, branch, 'bad-sha', main, 'token'],
    [fork, branch, original, '--upload-pack=evil', 'token'],
    [fork, 'nzik/../main', original, main, 'token'],
    [{ ...fork, owner: { login: '-upload/pack' } }, branch, original, main, 'token'],
  ]) assert.throws(() => h.context.writeSubmissionRef(...args), /Invalid submission branch update/);
  assert.equal(h.commands.length, 0);
});

test('real Git leases protect reset, repair and deletion on a local bare remote', t => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'nzik-moderation-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), temporaryRoot);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--quiet', '--bare', remote]);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: remote, input: '', stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim();
  const tree = git('mktree');
  const initial = git('commit-tree', tree, '-m', 'Original submission');
  const base = git('commit-tree', tree, '-m', 'Base');
  const replacement = git('commit-tree', tree, '-p', initial, '-p', base, '-m', 'Repaired index');
  const newWork = git('commit-tree', tree, '-p', initial, '-m', 'New work');
  git('update-ref', 'refs/heads/main', base);
  const ref = `refs/heads/${branch}`;
  const publicUrl = `https://github.com/${fork.owner.login}/${fork.name}.git`;
  const localUrl = pathToFileURL(remote).href;
  let changeBeforePush = false;
  const context = {
    Buffer, process: { env: { PATH: process.env.PATH } }, core: { setSecret: () => {} },
    require: name => name !== 'node:child_process' ? require(name) : {
      execFileSync: (command, args, options) => {
        const localArgs = args.map(value => value === publicUrl ? localUrl : value);
        assert.ok(localArgs.every(value => !value.startsWith('https://')));
        if (args[0] === 'push' && changeBeforePush) git('update-ref', ref, newWork);
        try {
          return execFileSync(command, localArgs, options);
        } catch (error) {
          if (!changeBeforePush) t.diagnostic(`${args[0]}: ${error.stderr?.toString() ?? error.message}`);
          throw error;
        }
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(script.slice(script.indexOf('function writeSubmissionRef('), script.indexOf('async function cleanSubmissionBranch(')), context);
  for (const next of [base, replacement, null]) {
    git('update-ref', ref, initial);
    changeBeforePush = false;
    context.writeSubmissionRef(fork, branch, initial, next, 'test-token');
    if (next === null) assert.throws(() => git('rev-parse', '--verify', ref));
    else assert.equal(git('rev-parse', ref), next);
    git('update-ref', ref, initial);
    changeBeforePush = true;
    assert.throws(() => context.writeSubmissionRef(fork, branch, initial, next, 'test-token'), /whether its head moved/);
    assert.equal(git('rev-parse', ref), newWork);
  }
});

test('accepted theme waits without publication or branch writes until creator is published', async () => {
  const h = lifecycle({ decision: 'accepted', publishedCreator: false });
  await h.run();
  await h.run();
  assert.equal(h.publications.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.current.state, 'open');
  assert.ok(h.labels.has('accepted'));
  assert.equal(h.comments.length, 1, 'reruns do not duplicate waiting records');
  assert.match(h.comments[0].body, /"runId":42/);
  assert.match(h.comments[0].body, new RegExp(original));
  h.publishCreator();
  await h.run();
  assert.equal(h.publications.length, 1);
});

for (const mutation of ['synchronize', 'unlabeled', 'refused', 'ban', 'closed']) {
  test(`waiting approval cannot resume after ${mutation}`, async () => {
    const h = lifecycle({ decision: 'accepted', publishedCreator: false });
    await h.run();
    await h.run({ action: ['refused', 'ban'].includes(mutation) ? 'labeled' : mutation,
      label: mutation === 'unlabeled' ? 'accepted' : mutation });
    h.publishCreator();
    await h.run();
    assert.equal(h.publications.length, 0);
    assert.ok(h.comments.some(comment => comment.body.includes('"invalid":true')));
  });
}

test('waiting approval rejects changed head and revoked then reapplied acceptance', async () => {
  const changed = lifecycle({ decision: 'accepted', publishedCreator: false });
  await changed.run();
  changed.publishCreator();
  changed.push(concurrent);
  await changed.run();
  assert.equal(changed.publications.length, 0);
  const revoked = lifecycle({ decision: 'accepted', publishedCreator: false });
  await revoked.run();
  revoked.publishCreator();
  revoked.reapprove();
  await revoked.run();
  assert.equal(revoked.publications.length, 0);
});

function waitingResumeHarness() {
  const profile = { merged: true, user: { id: 101 }, base: { ref: 'main' } };
  const item = { number: 7, state: 'open', draft: false, user: { id: 101 }, labels: [{ name: 'accepted' }],
    head: { sha: original, ref: branch, repo: fork }, base: { ref: 'main' } };
  const state = { runId: 42, authorId: 101, repositoryId: fork.id, head: original, branch,
    approvalId: 900, invalid: false, resumed: false };
  const comment = { id: 1, user: { login: 'github-actions[bot]', type: 'Bot' },
    body: '<!-- nzik-creator-wait ' + JSON.stringify(state) + ' -->\nWaiting' };
  const comments = [comment];
  const approvals = [{ id: 900, event: 'labeled', label: { name: 'accepted' } }];
  const reruns = [];
  const blocked = [];
  const profileBytes = Buffer.from(JSON.stringify({ githubId: 101 }));
  const index = { schemaVersion: 1, creators: [{ githubId: 101,
    profileSha256: require('node:crypto').createHash('sha256').update(profileBytes).digest('hex') }] };
  const run = { event: 'pull_request_target', path: '.github/workflows/blocked-contributors.yml', status: 'completed' };
  let fail = false;
  const github = { rest: {
    issues: {
      listComments: async () => ({ data: comments }), listEvents: async () => ({ data: approvals }),
      updateComment: async args => { comment.body = args.body; },
    },
    pulls: { list: async () => ({ data: [item] }) },
    git: { getRef: async () => ({ data: { object: { sha: main } } }) },
    actions: { getWorkflowRun: async () => ({ data: run }), reRunWorkflow: async args => {
      if (fail) throw new Error('transient rerun failure');
      reruns.push(args.run_id);
    } },
  } };
  github.paginate = async (method, args) => (await method(args)).data;
  const helpers = script.slice(script.indexOf('            const waitingMarker'),
    script.indexOf('            const labelAdded'));
  const context = vm.createContext({ Buffer, require, github, isSubmission: true,
    context: { repo: { owner: 'N-Zik-Group', repo: 'N-Zik-Theme-Store' } },
    postComment: args => github.rest.issues.updateComment(args),
    readFile: async path => {
      if (path.endsWith('index.json')) return JSON.stringify(index);
      if (path.endsWith('profile.json')) return profileBytes;
      return JSON.stringify({ schemaVersion: 1, accounts: blocked });
    },
  });
  const resume = vm.runInContext(helpers + '\nresumeWaitingThemes', context);
  return { profile, item, comment, comments, approvals, reruns, blocked, index, run,
    failRerun(value) { fail = value; }, resume: () => resume(profile) };
}

test('profile merge resumes the original approved workflow exactly once', async () => {
  const h = waitingResumeHarness();
  await h.resume();
  await h.resume();
  assert.deepEqual(h.reruns, [42]);
  assert.match(h.comment.body, /"resumed":true/);
  assert.match(workflow, /types: \[.*closed/);
  assert.match(script, /if \(confirmed\?\.merged && confirmed.merged_at\) \{\s+await resumeWaitingThemes\(confirmed\);/);
});

for (const condition of ['changed head', 'changed fork', 'unrelated author', 'refused', 'ban',
  'no acceptance', 'revoked acceptance', 'invalidated', 'forged comment', 'unpublished profile', 'blocked account', 'running workflow']) {
  test(`profile merge does not resume waiting theme with ${condition}`, async () => {
    const h = waitingResumeHarness();
    if (condition === 'changed head') h.item.head.sha = concurrent;
    if (condition === 'changed fork') h.item.head.repo = { ...fork, id: 999 };
    if (condition === 'unrelated author') h.item.user.id = 202;
    if (condition === 'refused' || condition === 'ban') h.item.labels.push({ name: condition });
    if (condition === 'no acceptance') h.item.labels = [];
    if (condition === 'revoked acceptance') h.approvals.push({ id: 901, event: 'labeled', label: { name: 'accepted' } });
    if (condition === 'invalidated') h.comment.body = h.comment.body.replace('"invalid":false', '"invalid":true');
    if (condition === 'forged comment') h.comment.user = { login: 'Creator', type: 'User' };
    if (condition === 'unpublished profile') h.index.creators = [];
    if (condition === 'blocked account') h.blocked.push({ githubId: 101 });
    if (condition === 'running workflow') h.run.status = 'in_progress';
    await h.resume();
    assert.deepEqual(h.reruns, []);
  });
}

test('failed resume remains retryable without consuming the waiting approval', async () => {
  const h = waitingResumeHarness();
  h.failRerun(true);
  await assert.rejects(h.resume(), /transient rerun/);
  assert.match(h.comment.body, /"resumed":false/);
  h.failRerun(false);
  await h.resume();
  assert.deepEqual(h.reruns, [42]);
});


test('delayed profile merge confirmation resumes waiting themes before publication cleanup', async () => {
  const calls = [];
  const confirmed = { merged: true, merged_at: '2026-11-17T00:00:00Z' };
  const finish = script.slice(script.indexOf('            async function finishPublication('),
    script.indexOf('            if (current.merged)'));
  const fn = vm.runInNewContext(finish + '\nfinishPublication', {
    managedSubmission: false, context: { repo: {} }, pull: { number: 9 },
    resumeWaitingThemes: async item => { assert.equal(item, confirmed); calls.push('resume'); },
    announcePublication: async () => calls.push('announce'),
    github: { rest: { pulls: { get: async () => { calls.push('poll'); return { data: confirmed }; } } } },
    setTimeout: callback => callback(),
  });
  await fn({ merged: false });
  assert.deepEqual(calls, ['poll', 'resume', 'announce']);
});

// Exercise the complete workflow: informational writes must precede even the first check read.
for (const action of ['opened', 'reopened', 'synchronize', 'ready_for_review']) {
  for (const published of [false, true]) {
    test(`${action} labels a ${published ? 'published' : 'new'} theme immediately while CodeFactor stays pending`, async () => {
      const h = lifecycle();
      h.labels.clear();
      h.labels.add(published ? 'new theme' : 'theme update');
      const themeId = branch.slice('nzik/theme-'.length);
      h.github.rest.pulls.listFiles = async () => ({ data: [
        { filename: `catalog/themes/${themeId}/2/manifest.json`, status: 'added' }
      ] });
      h.github.rest.repos.getContent = async args => {
        assert.equal(args.ref, main, 'Classification must read the trusted base catalog');
        return { data: { content: Buffer.from(JSON.stringify({ themes:
          published && args.path.endsWith('index-v2.json') ? [{ themeId }] : []
        })).toString('base64') } };
      };
      let reads = 0;
      const expected = published ? 'theme update' : 'new theme';
      const checks = h.github.rest.checks.listForRef;
      h.github.rest.checks.listForRef = async args => {
        reads++;
        assert.ok(h.labels.has(expected), 'Type label must exist before polling checks');
        assert.ok(h.labels.has('in review'), 'Review label must exist before polling checks');
        assert.equal(h.labels.has(published ? 'new theme' : 'theme update'), false);
        return { data: [...(await checks(args)).data,
          { id: 2, name: 'CodeFactor', head_sha: args.ref, status: 'in_progress', app: { id: 3 } }] };
      };
      await h.run({ action });
      assert.ok(reads > 1, 'The moderation gate must still wait');
      assert.deepEqual([...h.labels].sort(), [expected, 'in review'].sort());
      assert.equal(h.publications.length, 0);
      assert.equal(h.writes.length, 0);
      assert.equal(h.comments.length, 0);
      assert.equal(h.current.state, 'open');
      assert.equal(h.current.locked, false);
    });
  }
}

for (const decision of ['accepted', 'refused', 'ban', 'cleanup pending']) {
  test(`immediate classification preserves ${decision} without adding in review`, async () => {
    const h = lifecycle({ decision });
    h.labels.delete('in review');
    h.github.rest.checks.listForRef = async () => ({ data: [] });
    await h.run({ action: 'opened' });
    assert.ok(h.labels.has(decision));
    assert.equal(h.labels.has('in review'), false);
    assert.equal(h.publications.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

for (const merged of [false, true]) {
  test(`immediate labels do not alter a closed ${merged ? 'merged' : 'unmerged'} PR`, async () => {
    const h = lifecycle();
    h.current.state = 'closed'; h.current.merged = merged;
    h.labels.clear();
    h.github.rest.pulls.listFiles = async () => { assert.fail('No classification on closed PRs'); };
    h.github.rest.checks.listForRef = async () => ({ data: [] });
    await h.run({ action: 'reopened' });
    assert.equal(h.labels.size, 0);
    assert.equal(h.publications.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

for (const condition of ['pending', 'missing validation', 'pending status', 'pending workflow']) {
  test(`check gate permits no moderation writes with ${condition}`, async () => {
    const h = lifecycle({ decision: 'accepted' });
    if (condition === 'pending') h.github.rest.checks.listForRef = async args => ({ data: [
      { id: 1, name: 'validate', head_sha: args.ref, status: 'in_progress', check_suite: { id: 1 } }
    ] });
    if (condition === 'missing validation') h.github.rest.checks.listForRef = async () => ({ data: [] });
    if (condition === 'pending status') h.github.rest.repos.listCommitStatusesForRef = async () => ({ data: [
      { id: 1, context: 'external', state: 'pending' }
    ] });
    if (condition === 'pending workflow') {
      const list = h.github.rest.actions.listWorkflowRunsForRepo;
      h.github.rest.actions.listWorkflowRunsForRepo = async args => ({ data: [...(await list(args)).data,
        { id: 2, workflow_id: 2, head_sha: args.head_sha, status: 'queued', path: '.github/workflows/external.yml' }] });
    }
    const before = [...h.labels];
    await h.run({ action: 'opened' });
    assert.deepEqual([...h.labels], before);
    assert.equal(h.comments.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.publications.length, 0);
    assert.equal(h.current.state, 'open');
    assert.equal(h.current.locked, false);
  });
}

for (const result of ['failure', 'cancelled', 'timed_out', 'neutral', 'skipped', 'action_required']) {
  test(`check gate blocks ${result}, reconciles success labels and deduplicates failure notification`, async () => {
    const h = lifecycle({ decision: 'accepted' });
    h.labels.add('merged'); h.labels.add('refused'); h.labels.add('ban');
    const list = h.github.rest.checks.listForRef;
    h.github.rest.checks.listForRef = async args => ({ data: [...(await list(args)).data,
      { id: 2, name: 'external', head_sha: args.ref, status: 'completed', conclusion: result,
        app: { id: 3 }, html_url: 'https://example.test/check/2' }] });
    await h.run({ action: 'opened' });
    await h.run({ action: 'opened' });
    assert.equal(h.labels.has('accepted'), false);
    assert.equal(h.labels.has('merged'), false);
    assert.equal(h.labels.has('refused'), true);
    assert.equal(h.labels.has('ban'), true);
    assert.equal(h.comments.length, 1);
    assert.match(h.comments[0].body, /@NEVARLeVrai/);
    assert.match(h.comments[0].body, /https:\/\/example.test\/check\/2/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.publications.length, 0);
    assert.equal(h.current.state, 'open');
  });
}

test('check gate ignores every own workflow suite, but another app named moderation still blocks', async () => {
  const h = lifecycle({ decision: 'accepted' });
  const list = h.github.rest.actions.listWorkflowRunsForRepo;
  h.github.rest.actions.listWorkflowRunsForRepo = async args => ({ data: [...(await list(args)).data,
    ...[2, 3].map(id => ({ id, workflow_id: 8, head_sha: args.head_sha, check_suite_id: id,
      path: '.github/workflows/blocked-contributors.yml', status: id === 2 ? 'queued' : 'completed', conclusion: 'failure' }))] });
  const checks = h.github.rest.checks.listForRef;
  h.github.rest.checks.listForRef = async args => ({ data: [...(await checks(args)).data,
    ...[2, 3].map(id => ({ id, name: 'moderation', head_sha: args.ref, status: 'completed',
      conclusion: 'failure', check_suite: { id } }))] });
  await h.run();
  assert.equal(h.publications.length, 1);
  const other = lifecycle({ decision: 'accepted' });
  const good = other.github.rest.checks.listForRef;
  other.github.rest.checks.listForRef = async args => ({ data: [...(await good(args)).data,
    { id: 9, name: 'moderation', app: { id: 9 }, head_sha: args.ref, status: 'completed', conclusion: 'failure' }] });
  await other.run();
  assert.equal(other.publications.length, 0);
  assert.match(other.comments[0].body, /moderation/);
});

test('check gate paginates all APIs and keeps latest context and check name across pages', async () => {
  const h = lifecycle({ decision: 'accepted' });
  const checks = h.github.rest.checks.listForRef;
  const methods = new Set([checks, h.github.rest.actions.listWorkflowRunsForRepo, h.github.rest.repos.listCommitStatusesForRef]);
  const paginated = new Set();
  const paginate = h.github.paginate;
  h.github.paginate = async (method, args) => {
    if (!methods.has(method)) return paginate(method, args);
    assert.equal(args.per_page, 100);
    if (method === checks) assert.equal(args.filter, 'latest');
    paginated.add(method);
    if (method === h.github.rest.repos.listCommitStatusesForRef) return [
      { id: 5, context: 'deploy', state: 'failure' }, { id: 6, context: 'deploy', state: 'success' }];
    if (method === checks) return [...await paginate(method, args),
      { id: 5, name: 'external', app: { id: 4 }, head_sha: args.ref, status: 'completed', conclusion: 'failure' },
      { id: 6, name: 'external', app: { id: 4 }, head_sha: args.ref, status: 'completed', conclusion: 'success' },
      { id: 7, name: 'unrelated', head_sha: concurrent, status: 'completed', conclusion: 'failure' }];
    return paginate(method, args);
  };
  await h.run();
  assert.equal(paginated.size, 3);
  assert.equal(h.publications.length, 1);
});

for (const race of ['head', 'approval', 'labels']) {
  test(`check gate stops ${race} change during polling`, async () => {
    const h = lifecycle({ decision: 'accepted' });
    const list = h.github.rest.checks.listForRef;
    h.github.rest.checks.listForRef = async args => {
      if (race === 'head') h.push(concurrent);
      if (race === 'approval') h.reapprove();
      if (race === 'labels') h.labels.delete('accepted');
      return list(args);
    };
    await h.run();
    assert.equal(h.publications.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.comments.length, 0);
    assert.ok(h.failures.some(message => /changed/.test(message)));
  });
}

test('check gate rechecks all checks immediately before publication', async () => {
  const h = lifecycle({ decision: 'accepted' });
  const list = h.github.rest.repos.listCommitStatusesForRef;
  let reads = 0;
  h.github.rest.repos.listCommitStatusesForRef = async args => ++reads === 1 ? list(args) : ({ data: [
    { id: 3, context: 'late check', state: 'failure', target_url: 'https://example.test/late' }] });
  await h.run();
  assert.equal(h.publications.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.labels.has('accepted'), false);
  assert.match(h.comments[0].body, /late check/);
});

test('locked failure comments restore lock and preserve truthful merged state', async () => {
  const h = lifecycle({ decision: 'accepted' });
  h.current.merged = true; h.current.state = 'closed'; h.current.locked = true;
  h.labels.add('merged');
  h.github.rest.repos.listCommitStatusesForRef = async () => ({ data: [
    { id: 3, context: 'external', state: 'error', target_url: 'https://example.test/error' }] });
  await h.run({ dispatch: true });
  assert.equal(h.comments.length, 1);
  assert.equal(h.labels.has('merged'), true);
  assert.equal(h.labels.has('accepted'), false);
  assert.equal(h.current.locked, true);
  assert.equal(h.current.merged, true);
  assert.equal(h.writes.length, 0);
});

test('publication retry writes required comments on locked PR and restores final lock', async () => {
  const h = lifecycle({ decision: 'accepted', deletionFailure: true });
  await h.run();
  assert.equal(h.current.locked, true);
  h.faults.deletion = false;
  await h.run({ dispatch: true });
  assert.equal(h.current.locked, true);
  assert.equal(h.labels.has('cleanup pending'), false);
  assert.equal(h.publications.length, 1);
});


test('cleanup retry completes saved state after branch deletion and locked report failure', async () => {
  const h = lifecycle({ decision: 'accepted' });
  const update = h.github.rest.issues.updateComment;
  let interrupt = true;
  h.github.rest.issues.updateComment = async args => {
    if (interrupt && args.body.includes('"completed":true')) {
      interrupt = false;
      throw new Error('Transient final report failure');
    }
    return update(args);
  };
  await assert.rejects(h.run(), /Transient final report failure/);
  assert.equal(h.head(), null);
  assert.equal(h.current.locked, true);
  assert.equal(h.labels.has('cleanup pending'), true);
  await h.run({ dispatch: true });
  assert.equal(h.head(), null);
  assert.equal(h.current.locked, true);
  assert.equal(h.labels.has('cleanup pending'), false);
  assert.ok(h.comments.some(comment => comment.body.includes('"completed":true')));
  assert.equal(h.publications.length, 1);
});

test('locked comment delivery restores lock even if comment creation fails', async () => {
  const helpers = script.slice(script.indexOf('            async function postComment('),
    script.indexOf('            const moderationPath'));
  const calls = [];
  const post = vm.runInNewContext(helpers + '\npostComment', {
    context: { repo: {} }, pull: { number: 7 }, setTimeout: callback => callback(), github: { rest: {
      issues: { get: async () => ({ data: { locked: true } }), unlock: async () => calls.push('unlock'), lock: async () => calls.push('lock'),
        createComment: async () => { calls.push('comment'); throw new Error('Network failure'); } }
    } }
  });
  await assert.rejects(post({ issue_number: 7, body: 'status' }), /Network failure/);
  assert.deepEqual(calls, ['unlock', 'comment', 'lock']);
});

test('check gate waits through pending checks and publishes only after every context succeeds', async () => {
  const h = lifecycle({ decision: 'accepted' });
  let reads = 0;
  h.github.rest.repos.listCommitStatusesForRef = async () => {
    ++reads;
    if (reads <= 2) {
      assert.equal(h.publications.length, 0);
      assert.equal(h.writes.length, 0);
      assert.equal(h.comments.length, 0);
      return { data: [{ id: 1, context: 'external', state: 'pending' }] };
    }
    return { data: [{ id: 2, context: 'external', state: 'success' }] };
  };
  await h.run();
  assert.ok(reads >= 4, 'Initial polling and final publication recheck must both run');
  assert.equal(h.publications.length, 1);
});


for (const permission of ['triage', 'write', 'maintain', 'admin']) {
  test(`queued old approval requires current acceptance actor to have ${permission} permission`, async () => {
    const h = lifecycle({ decision: 'accepted' });
    h.github.rest.issues.listEvents = async () => ({ data: [
      { id: 901, event: 'labeled', label: { name: 'accepted' }, actor: { login: 'NewModerator' } }
    ] });
    const checked = [];
    h.github.rest.repos.getCollaboratorPermissionLevel = async args => {
      checked.push(args.username);
      return { data: { permission: args.username === 'NewModerator' ? permission : 'write' } };
    };
    await h.run();
    assert.deepEqual(checked, ['Moderator', 'NewModerator']);
    assert.equal(h.publications.length, permission === 'triage' ? 0 : 1);
    if (permission === 'triage') {
      assert.equal(h.writes.length, 0);
      assert.equal(h.comments.length, 0);
      assert.ok(h.failures.some(message => /authorized maintainer/.test(message)));
    }
  });
}

for (const operation of ['create', 'update']) {
  test(`locked ${operation} uses issue state, retries comment-service lag and restores lock reason`, async () => {
    const helpers = script.slice(script.indexOf('            async function postComment('),
      script.indexOf('            const moderationPath'));
    const calls = [];
    let locked = true;
    let issueReads = 0;
    let lagReads = 0;
    let writes = 0;
    const write = async args => {
      calls.push(operation);
      writes++;
      if (writes === 1) throw Object.assign(new Error('Unable to create comment because issue is locked.'), { status: 403 });
      assert.equal(locked, false);
      assert.equal(args.body, 'updated status');
      if (operation === 'update') assert.equal(args.comment_id, 123);
      return { data: { id: 123 } };
    };
    const post = vm.runInNewContext(helpers + '\npostComment', {
      context: { repo: { owner: 'test', repo: 'test' } }, pull: { number: 7 }, setTimeout: callback => callback(),
      github: { rest: {
        pulls: { get: async () => { throw new Error('Pull lock snapshot must not be used'); } },
        issues: {
          get: async () => {
            issueReads++;
            if (issueReads === 1) return { data: { locked: false } }; // stale even on issues endpoint
            if (lagReads > 0) { lagReads--; return { data: { locked: true, active_lock_reason: 'spam' } }; }
            return { data: { locked, active_lock_reason: 'spam' } };
          },
          unlock: async () => { calls.push('unlock'); locked = false; lagReads = 2; },
          lock: async args => { calls.push('lock'); locked = true; assert.equal(args.lock_reason, 'spam'); },
          createComment: write, updateComment: write
        }
      } }
    });
    await post({ issue_number: 7, ...(operation === 'update' ? { comment_id: 123 } : {}), body: 'updated status' });
    assert.deepEqual(calls, [operation, 'unlock', operation, 'lock']);
    assert.ok(issueReads >= 4, 'Unlock propagation must be polled');
    assert.equal(locked, true);
  });
}

test('locked comment retries are bounded and restore lock when every write is rejected', async () => {
  const helpers = script.slice(script.indexOf('            async function postComment('),
    script.indexOf('            const moderationPath'));
  let writes = 0;
  let restored = false;
  const post = vm.runInNewContext(helpers + '\npostComment', {
    context: { repo: {} }, pull: { number: 7 }, setTimeout: callback => callback(), github: { rest: { issues: {
      get: async () => ({ data: { locked: false } }), unlock: async () => {}, lock: async () => { restored = true; },
      updateComment: async () => { writes++; throw Object.assign(new Error('Unable to create comment because issue is locked.'), { status: 403 }); }
    } } }
  });
  await assert.rejects(post({ comment_id: 123, body: 'status' }), /issue is locked/);
  assert.equal(writes, 5);
  assert.equal(restored, true);
});

test('locked cleanup updates the existing bot record even when pull lock snapshot is stale', async () => {
  const h = lifecycle({ decision: 'accepted', deletionFailure: true });
  await h.run();
  const count = h.comments.length;
  const getPull = h.github.rest.pulls.get;
  h.github.rest.pulls.get = async args => {
    const response = await getPull(args);
    response.data.locked = false;
    return response;
  };
  h.faults.deletion = false;
  await h.run({ dispatch: true });
  assert.equal(h.current.locked, true);
  assert.equal(h.comments.length, count, 'Existing cleanup comment must be patched, not duplicated');
  assert.equal(h.labels.has('cleanup pending'), false);
  assert.ok(h.comments.some(comment => comment.body.includes('"completed":true')));
});


test('classification failure cannot prevent failed-check reconciliation', async () => {
  const h = lifecycle({ decision: 'accepted' });
  h.github.rest.pulls.listFiles = async () => { throw new Error('Label API unavailable'); };
  const checks = h.github.rest.checks.listForRef;
  h.github.rest.checks.listForRef = async args => ({ data: [...(await checks(args)).data,
    { id: 2, name: 'CodeFactor', head_sha: args.ref, status: 'completed', conclusion: 'failure', app: { id: 3 } }] });
  await h.run({ action: 'opened' });
  assert.equal(h.labelFailures.length, 1);
  assert.equal(h.labels.has('accepted'), false);
  assert.match(h.comments[0].body, /CodeFactor/);
  assert.equal(h.publications.length, 0);
  assert.equal(h.writes.length, 0);
});

test('classification runs outside the serialized moderation queue and cannot skip its gate', () => {
  assert.match(workflow, /moderation:\s+needs: labels\s+#.*\s+if: always\(\) && !cancelled\(\)\s+concurrency:/);
  const labelsJob = workflow.slice(workflow.indexOf('  labels:'), workflow.indexOf('  moderation:'));
  assert.doesNotMatch(labelsJob, /concurrency:/);
  assert.match(labelsJob, /github.event.pull_request.base.sha/);
  assert.match(labelsJob, /persist-credentials: false/);
});


for (const [type, ref, filename, status] of [
  ['new creator profile', 'nzik/creator-profile-101', 'catalog/creators/101/profile.json', 'added'],
  ['update creator profile', 'nzik/creator-profile-101', 'catalog/creators/101/profile.json', 'modified'],
  ['theme review', `nzik/review-${branch.slice(11)}-2-101`, `catalog/themes/${branch.slice(11)}/2/reviews.json`, 'modified'],
  ['theme withdrawal', `nzik/withdraw-${branch.slice(11)}`, 'catalog/themes/index-v2.json', 'modified']
]) {
  test(`${type} labels precede pending validation without moderation writes`, async () => {
    const h = lifecycle();
    h.labels.clear();
    h.current.head.ref = ref;
    h.github.rest.pulls.listFiles = async () => ({ data: [{ filename, status }] });
    h.github.rest.checks.listForRef = async () => {
      assert.ok(h.labels.has(type));
      assert.ok(h.labels.has('in review'));
      return { data: [] };
    };
    await h.run({ action: 'opened' });
    assert.equal(h.labelFailures.length, 0);
    assert.deepEqual([...h.labels].sort(), [type, 'in review'].sort());
    assert.equal(h.publications.length, 0);
    assert.equal(h.writes.length, 0);
  });
}


for (const change of ['accepted', 'refused', 'ban', 'closed', 'merged', 'head']) {
  test(`classification rechecks ${change} appearing during file listing`, async () => {
    const h = lifecycle();
    h.labels.clear();
    h.github.rest.pulls.listFiles = async () => {
      if (change === 'closed' || change === 'merged') h.current.state = 'closed';
      if (change === 'merged') { h.current.merged = true; h.labels.add('merged'); }
      if (change === 'head') h.push(concurrent);
      if (['accepted', 'refused', 'ban'].includes(change)) h.labels.add(change);
      return { data: [] };
    };
    await labelSubmission({ github: h.github, context: {
      repo: {}, payload: { action: 'opened', pull_request: { number: 7 } }
    } });
    assert.equal(h.labels.has('in review'), false);
    assert.equal(h.publications.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

test('classification rechecks moderation after creating the review label definition', async () => {
  const h = lifecycle();
  h.labels.clear();
  h.github.rest.issues.createLabel = async args => {
    if (args.name === 'in review') h.labels.add('accepted');
  };
  await labelSubmission({ github: h.github, context: {
    repo: {}, payload: { action: 'opened', pull_request: { number: 7 } }
  } });
  assert.equal(h.labels.has('in review'), false);
  assert.ok(h.labels.has('accepted'));
});
