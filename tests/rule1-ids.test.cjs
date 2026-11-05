// RULE 1 (0.6.39): identifiers are shown WHOLE. PP.shorten, PP.tokenLabel and service.js's label fallback used
// to cut txpowids, pool addresses and token ids to 8…6 / 8… with no way back to the full value.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const base = path.join(__dirname, '..');
const ID = '0x7D39745FBD29049BE29850B55A18BF550E4D442F930F86266E34193D89042A90';

test('PP.shorten and PP.tokenLabel return the whole identifier', () => {
  const c = { console }; c.self = c; vm.createContext(c);
  for (const f of ['decimal.js', 'covenant.js', 'curve.js']) vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), c, { filename: f });
  const PP = vm.runInContext('PP', c);
  assert.equal(PP.shorten(ID), ID);
  assert.equal(PP.tokenLabel({ tok: ID }), ID);
  assert.equal(PP.tokenLabel({ tok: ID, tokName: 'MxUSD' }), 'MxUSD');
});

test('no engine or page source concatenates an ellipsis onto a cut identifier', () => {
  for (const f of ['curve.js', 'service.js', 'index.html']) {
    const s = fs.readFileSync(path.join(base, f), 'utf8');
    assert.ok(!/(substring|slice)\(\s*0\s*,\s*\d+\s*\)\)?\s*\+\s*["']…["']/.test(s), f + ' cuts a value and appends …');
  }
});
