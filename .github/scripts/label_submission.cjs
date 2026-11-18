module.exports = async function ({ github, context }) {
  const pull = context.payload.pull_request;
  if (!pull || !['opened', 'reopened', 'synchronize', 'ready_for_review'].includes(context.payload.action)) return;
  const target = { ...context.repo, issue_number: pull.number };
  const { data: current } = await github.rest.pulls.get({ ...context.repo, pull_number: pull.number });
  if (current.state !== 'open' || current.merged) return;
  const authorOwnsHead = current.head.repo?.owner?.id === current.user.id;
  const isSubmission = authorOwnsHead && current.head.ref === `nzik/creator-profile-${current.user.id}`;
  const isThemeSubmission = authorOwnsHead && /^nzik\/theme-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(current.head.ref);
  const isWithdrawal = authorOwnsHead && /^nzik\/withdraw-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(current.head.ref);
  const review = authorOwnsHead && /^nzik\/review-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-([1-9]\d*)-([1-9]\d*)$/.exec(current.head.ref);
  const isReview = Boolean(review) && review[3] === String(current.user.id);
  const reviewPath = isReview ? `catalog/themes/${review[1]}/${review[2]}/reviews.json` : '';
  const managedSubmission = isSubmission || isThemeSubmission || isWithdrawal || isReview;
  const themeIndexPaths = ['catalog/themes/index.json', 'catalog/themes/index-v2.json'];
  const statusLabels = { 'in review': 'fbca04' };
  const typeLabels = {
    'new creator profile': '1d76db', 'update creator profile': '0052cc',
    'new theme': '0e8a16', 'theme update': '006b75',
    'theme withdrawal': 'd93f0b', 'theme review': '5319e7'
  };
  async function ensureLabel(name, color) {
    try { await github.rest.issues.createLabel({ ...context.repo, name, color }); }
    catch (error) { if (error.status !== 422) throw error; }
  }
  async function readThemeIndex(path, ref) {
    const { data } = await github.rest.repos.getContent({ ...context.repo, path, ref });
    return JSON.parse(Buffer.from(data.content, 'base64'));
  }
  async function applyInformationalLabels(current) {
    const files = await github.paginate(github.rest.pulls.listFiles, {
      ...context.repo, pull_number: pull.number, per_page: 100
    });
    const types = new Set();
    const themes = new Set();
    if (isWithdrawal) types.add('theme withdrawal');
    for (const file of isWithdrawal ? [] : files) {
      if (file.status === 'removed') continue;
      if (isReview && file.filename === reviewPath) {
        types.add('theme review');
        continue;
      }
      if (/^catalog\/creators\/\d+\/profile\.json$/.test(file.filename)) {
        types.add(file.status === 'added' ? 'new creator profile' : 'update creator profile');
      }
      const theme = /^catalog\/themes\/([0-9a-f-]{36})\/\d+\/[^/]+/.exec(file.filename);
      if (theme) themes.add(theme[1]);
    }
    if (themes.size) {
      const indexes = await Promise.all(themeIndexPaths.map(path => readThemeIndex(path, current.base.sha)));
      const published = new Set(indexes.flatMap(index => index.themes.map(theme => theme.themeId)));
      for (const id of themes) types.add(published.has(id) ? 'theme update' : 'new theme');
    }
    async function liveSubmission() {
      const { data: live } = await github.rest.pulls.get({ ...context.repo, pull_number: pull.number });
      return live.state === 'open' && !live.merged && live.head.sha === current.head.sha &&
        live.head.ref === current.head.ref && live.head.repo?.id === current.head.repo?.id &&
        live.base.sha === current.base.sha ? live : null;
    }
    const live = await liveSubmission();
    if (!live) return;
    const labels = new Set(live.labels.map(label => label.name));
    for (const [name, color] of Object.entries(typeLabels)) {
      if (types.has(name) && !labels.has(name)) {
        await ensureLabel(name, color);
        await github.rest.issues.addLabels({ ...target, labels: [name] });
      } else if (!types.has(name) && labels.has(name)) {
        try {
          await github.rest.issues.removeLabel({ ...target, name });
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
    }
    if (managedSubmission) {
      await ensureLabel('in review', statusLabels['in review']);
      // Classification runs alongside other moderation events; do not restore a stale review state.
      const latest = await liveSubmission();
      if (latest && !latest.labels.some(label =>
          ['in review', 'accepted', 'refused', 'ban', 'merged', 'cleanup pending'].includes(label.name))) {
        await github.rest.issues.addLabels({ ...target, labels: ['in review'] });
      }
    }
  }
  await applyInformationalLabels(current);
};
