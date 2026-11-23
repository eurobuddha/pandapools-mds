// A stand-in node that reads a command text EXACTLY as the real one does (CommandRunner.runMultiCommand:
// `new StringTokenizer(zCommand, ";")`, each piece Java-trim()med and run as its own command — quotes and JSON are
// NOT respected), so an injected second command cannot hide behind a mock that treats the text as one command.
// Every piece is run (as when each succeeds; a truncated runscript still answers status:true) and recorded in `ran`.
function pieces(text) { return String(text).split(';').map(s => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '')).filter(Boolean); }
function verb(piece) { return piece.split(/[\s:]/)[0].replace(/"/g, '').toLowerCase(); }
function standin(reply) {
  const ran = [], texts = [];
  return {
    ran, texts,
    sends: () => ran.filter(p => verb(p) === 'send'),
    cmd(q, cb) { texts.push(q); const out = pieces(q).map(p => { ran.push(p); return reply(p, verb(p)); }); if (cb) cb(out[0] || { status: false }); }
  };
}
// The node's own parameter reader for one piece (CommandRunner.splitStringJSON, the path taken without { or [):
// white space outside quotes ends a token; a `"` only toggles quoting and is dropped — there is NO backslash escape, so
// a quoted value ends at the FIRST `"` and keeps any backslash; then name:value at the first ':', LAST duplicate wins.
function params(piece) {
  const toks = []; let cur = '', quoted = false;
  for (const ch of String(piece).trim()) {
    if (ch === ' ' && !quoted) { if (cur) toks.push(cur.trim()); cur = ''; }
    else if (ch === '"') quoted = !quoted;
    else cur += ch;
  }
  if (cur) toks.push(cur.trim());
  const out = { verb: (toks.shift() || '').toLowerCase(), p: {} };
  for (const t of toks) { const i = t.indexOf(':'); if (i > 0) out.p[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
  return out;
}
module.exports = { pieces, verb, standin, params };
