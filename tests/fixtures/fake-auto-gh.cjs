/* Offline fake of the GitHub CLI/REST release API. No network access. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const stateFile = process.env.CHASHMYAR_FAKE_AUTO_GH_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fields = name => args.flatMap((arg, i) => arg === name ? [args[i + 1]] : []);
const value = (name, key) => fields(name).find(x => x.startsWith(key + '='))?.slice(key.length + 1);
// A synchronous write avoids truncation when this fake is piped on CI.
const respond = data => { save(); fs.writeFileSync(1, (typeof data === 'string' ? data : JSON.stringify(data)) + '\n'); process.exit(0); };
const die = message => { save(); fs.writeFileSync(2, message + '\n'); process.exit(1); };
const method = flag('--method') || 'GET';
const endpoint = args[1] || '';
const upload = /^https:\/\/uploads\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/(\d+)\/assets\?name=([^&]+)$/.exec(endpoint);
const list = /^repos\/[^/]+\/[^/]+\/releases\?per_page=100&page=(\d+)$/.exec(endpoint);
const byId = /^repos\/[^/]+\/[^/]+\/releases\/(\d+)$/.exec(endpoint);
const byTag = /^repos\/[^/]+\/[^/]+\/releases\/tags\/(v\d+\.\d+\.\d+)$/.exec(endpoint);
const latest = /^repos\/[^/]+\/[^/]+\/releases\/latest$/.test(endpoint);
const repository = /^repos\/[^/]+\/[^/]+$/.test(endpoint);
const create = /^repos\/[^/]+\/[^/]+\/releases$/.test(endpoint) && method === 'POST';
const operation = args[0] === 'release' ? args[1]
  : upload ? 'upload' : list ? 'list' : byId ? (method === 'PATCH' ? 'publish' : 'read')
    : byTag ? 'tag-view' : latest ? 'latest' : repository ? 'repo' : create ? 'create' : 'unknown';
const named = operation === 'upload' ? `upload:${decodeURIComponent(upload[3])}` : operation;
if (state.failOnce === operation || state.failOnce === named) {
  state.failOnce = null;
  die('gh: simulated server failure (HTTP 503)');
}
const releases = () => Object.values(state.releases);
const matchingId = id => releases().find(release => release.id === Number(id));
// Real release metadata describes assets; it never embeds their file bytes.
// Keep fixture-only bytes/timing flags in state for downloads, not API output.
const publicAsset = asset => {
  const { contentBase64, _realDigest, _pendingReads, ...metadata } = asset;
  return metadata;
};
const publicRelease = release => {
  const { hiddenFromListing, ...metadata } = release;
  return { ...metadata, assets: release.assets.map(publicAsset) };
};
if (args[0] === 'api') {
  if (repository && method === 'GET') { respond({ full_name: 'example/ChashmYar' }); }
  if (list && method === 'GET') {
    const page = Number(list[1]);
    if (page < 1) die('invalid page');
    const visible = releases().filter(release => !release.hiddenFromListing);
    respond(visible.slice((page - 1) * 100, page * 100).map(publicRelease));
  }
  if (latest && method === 'GET') {
    const stale = (state.staleLatestReads || 0) > 0;
    if (stale) state.staleLatestReads--;
    const tag = stale ? state.staleLatestTag : state.latestTag;
    const release = releases().find(r => r.tag_name === tag && !r.draft && !r.prerelease);
    if (!release) die('gh: Latest release not found (HTTP 404)');
    respond(publicRelease(release));
  }
  if (byTag && method === 'GET') {
    // GitHub's by-tag REST endpoint does NOT return unpublished drafts.
    const release = releases().find(r => r.tag_name === byTag[1] && !r.draft);
    if (!release) die('gh: Not Found (HTTP 404)');
    respond(publicRelease(release));
  }
  if (create) {
    const tag = value('--raw-field', 'tag_name');
    const body = value('--raw-field', 'body');
    if (!tag || !body || value('--field', 'draft') !== 'true' || value('--field', 'prerelease') !== 'false'
        || value('--field', 'generate_release_notes') !== 'true') die('unsafe create parameters');
    if (releases().some(r => r.tag_name === tag)) die('duplicate release');
    const id = state.nextId || 1; state.nextId = id + 1;
    state.releases[tag] = {
      id, tag_name: tag, draft: true, prerelease: false, body, assets: [],
      html_url: `https://github.invalid/example/ChashmYar/releases/tag/${tag}`,
      upload_url: `https://uploads.github.com/repos/example/ChashmYar/releases/${id}/assets{?name,label}`,
    };
    respond(publicRelease(state.releases[tag]));
  }
  if (byId) {
    const release = matchingId(byId[1]);
    if (!release) die('gh: Not Found (HTTP 404)');
    if (method === 'GET') {
      const response = publicRelease(release);
      for (const asset of release.assets) {
        if (asset._pendingReads > 0 && --asset._pendingReads === 0) asset.digest = asset._realDigest;
      }
      respond(response);
    }
    if (method === 'PATCH') {
      if (!release.draft || value('--field', 'draft') !== 'false' || value('--field', 'prerelease') !== 'false'
          || value('--raw-field', 'tag_name') !== release.tag_name
          || value('--raw-field', 'make_latest') !== 'true') die('unsafe publish or Latest marker omitted');
      release.draft = false; state.latestTag = release.tag_name; respond(publicRelease(release));
    }
  }
  if (upload && method === 'POST') {
    const release = matchingId(upload[2]), name = decodeURIComponent(upload[3]), file = flag('--input');
    if (!release || !release.draft || flag('--header') !== 'Content-Type: application/octet-stream'
        || !file || path.basename(file) !== name || args.includes('--clobber')) die('unsafe asset upload');
    const bytes = fs.readFileSync(file);
    if (release.assets.some(a => a.name === name)) die('duplicate asset');
    const asset = { name, state: 'uploaded', size: bytes.length,
      digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
      contentBase64: bytes.toString('base64') };
    if (state.delayDigestOnce === name) {
      state.delayDigestOnce = null;
      asset._realDigest = asset.digest; asset.digest = null; asset._pendingReads = 1;
    }
    release.assets.push(asset);
    // Test-only race: a separate writer creates a newer tag on the bare remote
    // while this job is uploading. Do not put that tag in the local checkout.
    const injection = state.injectRemoteTag;
    if (injection && injection.onAsset === name) {
      if (!/^v\d+\.\d+\.\d+$/.test(injection.tag) || !/^[0-9a-f]{40}$/.test(injection.commit)) die('invalid test tag injection');
      const created = spawnSync('git', ['--git-dir', injection.bare, 'update-ref',
        `refs/tags/${injection.tag}`, injection.commit, '0'.repeat(40)], { encoding: 'utf8' });
      if (created.error || created.status !== 0) die('failed to inject competing remote tag');
      state.injectRemoteTag = null;
    }
    respond(publicAsset(asset));
  }
  die(`unknown fake API request: ${method} ${endpoint}`);
}
if (args[0] === 'release' && operation === 'download') {
  const tag = args[2], release = releases().find(r => r.tag_name === tag && !r.draft);
  const asset = release?.assets.find(a => a.name === flag('--pattern'));
  if (!asset) die('missing published download');
  fs.writeFileSync(path.join(flag('--dir'), asset.name), Buffer.from(asset.contentBase64, 'base64'));
  respond('fake download ok');
}
die('unknown fake gh command');
