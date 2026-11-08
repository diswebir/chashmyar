/* Test-only fake for scripts/create-draft-release.mjs. No network access. */
const fs = require('node:fs');
const path = process.env.CHASHMYAR_FAKE_GH_STATE;
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(path, JSON.stringify(state, null, 2));
if (args[0] !== 'release') { save(); process.exit(2); }
if (args[1] === 'view') {
  save();
  if (state.mode === 'missing') { console.error('release not found'); process.exit(1); }
  if (state.mode === 'network-error') { console.error('HTTP 503: Service unavailable'); process.exit(1); }
  console.log(JSON.stringify({ isDraft: state.mode === 'draft' }));
} else if (args[1] === 'create') {
  state.mode = 'draft'; state.created = true; save(); console.log('draft created');
} else if (args[1] === 'upload') {
  state.uploaded = true; save(); console.log('draft assets uploaded');
} else { save(); process.exit(2); }
