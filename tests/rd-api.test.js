// Run: node tests/rd-api.test.js
// Tests app/src/main/assets/rd-api.js against a small fake of the Real-Debrid REST API (shapes taken from the public docs).
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../app/src/main/assets/rd-api.js'), 'utf8');

function makeEnv() {
  const calls = [];
  const db = { torrents: {}, downloads: [{ id: 'D1', filename: 'a.mkv', filesize: 100, host: 'x.com', generated: '2026-10-01T10:00:00.000Z', link: 'https://x.com/a', download: 'https://dl/a' }] };
  let tokenOk = 'GOOD', rateOnce = true, refreshed = 0;
  const j = (status, obj) => ({ status, body: obj === undefined ? '' : JSON.stringify(obj) });
  function server(method, url, headers, body) {
    calls.push(method + ' ' + url.replace('https://api.real-debrid.com', ''));
    const u = new URL(url), p = u.pathname.replace('/rest/1.0', ''), f = Object.fromEntries(new URLSearchParams(body || ''));
    if (p === '/oauth/v2/token') { refreshed++; return j(200, { access_token: 'NEW', expires_in: 3600, refresh_token: 'R2' }); }
    if ((headers.Authorization || '') !== 'Bearer ' + tokenOk) return j(401, { error: 'bad_token', error_code: 8 });
    if (p === '/user') return j(200, { id: 1, username: 'ali', email: 'a@b.c', points: 120, type: 'premium', premium: 99999, expiration: '2027-01-01T00:00:00.000Z' });
    if (p === '/unrestrict/link') {
      if (f.link.includes('bad')) return j(503, { error: 'hoster_unavailable', error_code: 17 });
      if (f.link.includes('nohost')) return j(503, { error: 'unsupported_hoster', error_code: 16 });
      return j(200, { id: 'U1', filename: 'movie.mkv', filesize: 5000, link: f.link, host: 'x.com', download: 'https://dl.real-debrid.com/d/ABC/movie.mkv', streamable: 1, alternative: [{ id: 'q1', filename: 'm720.mp4', download: 'https://dl/m720', quality: '720p', type: 'mp4' }] });
    }
    if (p === '/unrestrict/check') return f.link.includes('nohost') ? j(200, { supported: 0 }) : j(200, { host: 'x.com', filename: 'f.zip', filesize: 77, supported: 1 });
    if (p === '/torrents/addMagnet') { const id = 'T' + (Object.keys(db.torrents).length + 1); db.torrents[id] = { id, filename: 'Big Movie', hash: 'abc'.padEnd(40, '0'), bytes: 3000, progress: 0, status: 'waiting_files_selection', added: '2026-10-02T00:00:00.000Z', files: [{ id: 1, path: '/Big Movie/movie.mkv', bytes: 2900, selected: 0 }, { id: 2, path: '/Big Movie/sub/en.srt', bytes: 100, selected: 0 }], links: [] }; return j(201, { id, uri: 'x' }); }
    if (p === '/torrents/addTorrent') { return j(201, { id: 'TT', uri: 'y' }); }
    let m;
    if ((m = p.match(/^\/torrents\/info\/(.+)$/))) { const t = db.torrents[m[1]]; return t ? j(200, t) : j(404, { error: 'unknown_ressource', error_code: 7 }); }
    if ((m = p.match(/^\/torrents\/selectFiles\/(.+)$/))) { const t = db.torrents[m[1]]; const ids = f.files === 'all' ? t.files.map(x => x.id) : f.files.split(',').map(Number); t.files.forEach(x => { x.selected = ids.includes(x.id) ? 1 : 0; }); t.status = 'downloaded'; t.progress = 100; t.links = t.files.filter(x => x.selected).map((x, i) => 'https://real-debrid.com/d/L' + x.id); return j(204); }
    if ((m = p.match(/^\/torrents\/delete\/(.+)$/))) { delete db.torrents[m[1]]; return j(204); }
    if (p === '/torrents') { if (rateOnce) { rateOnce = false; return { status: 429, body: '{"error":"too_many_requests","error_code":34}' }; } const page = +u.searchParams.get('page'); return page === 1 ? j(200, Object.values(db.torrents)) : j(204); }
    if (p === '/hosts/status') return j(200, { '1fichier.com': { id: '1fichier', name: '1Fichier', supported: 1, status: 'up' }, 'down.com': { name: 'Down', status: 'down' } });
    if (p === '/traffic') return j(200, { 'rapidgator.net': { left: 90, bytes: 0, links: 0, limit: 100, type: 'links', reset: 'daily' }, 'big.com': { left: 8, limit: 10, type: 'gigabytes' } });
    if (p === '/downloads') return +u.searchParams.get('page') === 1 ? j(200, db.downloads) : j(204);
    if ((m = p.match(/^\/downloads\/delete\/(.+)$/))) { db.downloads = db.downloads.filter(x => x.id !== m[1]); return j(204); }
    return j(404, { error: 'unknown_method', error_code: 3 });
  }
  const mem = {};
  const ctx = {
    console, window: {}, setTimeout, Date, JSON, URL, URLSearchParams, Math, Object, Array, String, Number, Promise, isNaN, encodeURIComponent,
    sleep: () => Promise.resolve(),
    form: o => { const p = []; for (const k in o) for (const v of [].concat(o[k])) p.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); return p.join('&'); },
    store: { get: (k, d) => (k in mem ? JSON.parse(mem[k]) : d), set: (k, v) => { mem[k] = JSON.stringify(v); } },
    keys: { active: 'main', keys: { main: 'GOOD' } },
    saveKeys() {}, fmtSize: n => n + 'B', choose: async (t, items) => items.map((_, i) => i).filter(i => i === 0),
    http: async (m, u, h, b) => server(m, u, h || {}, b),
    _cbs: {}, _n: 0
  };
  ctx.getKey = () => ctx.keys.keys[ctx.keys.active];
  vm.createContext(ctx);
  vm.runInContext('class ADError extends Error { constructor(code,msg){ super(msg||code); this.code=code; } }', ctx);
  vm.runInContext(src, ctx);
  return { ctx, calls, db, setToken: t => { tokenOk = t; }, refreshed: () => refreshed };
}
const run = (env, code) => vm.runInContext(code, env.ctx);

(async () => {
  let n = 0; const ok = (name) => console.log('  ✔', name, ++n);
  const E = makeEnv();

  // user
  let r = await run(E, "ad('user', {}, {method:'GET'})");
  assert.equal(r.user.username, 'ali'); assert.equal(r.user.isPremium, true); assert.equal(r.user.premiumUntil, 1798761600); assert.equal(r.user.fidelityPoints, 120); ok('user');

  // unlock + alternative qualities
  r = await run(E, "ad('link/unlock', {link:'https://x.com/file'})");
  assert.equal(r.link, 'https://dl.real-debrid.com/d/ABC/movie.mkv'); assert.equal(r.id, 'U1'); assert.equal(r.filesize, 5000);
  assert.equal(r.streams[0].id, 'https://dl/m720'); assert.equal(r.streams[0].quality, '720p'); ok('link/unlock');

  // errors are mapped to the codes the UI has hints for
  await assert.rejects(() => run(E, "ad('link/unlock', {link:'https://x.com/bad'})"), e => e.code === 'LINK_HOST_UNAVAILABLE');
  await assert.rejects(() => run(E, "ad('link/unlock', {link:'https://nohost.com/x'})"), e => e.code === 'LINK_HOST_NOT_SUPPORTED'); ok('error mapping');

  // link check
  r = await run(E, "ad('link/infos', {'link[]':['https://x.com/a','https://nohost.com/b']})");
  assert.equal(r.infos[0].filename, 'f.zip'); assert.equal(r.infos[0].size, 77); assert.equal(r.infos[1].error.code, 'LINK_HOST_NOT_SUPPORTED'); ok('link/infos');

  // magnet: add (bare hash is turned into a magnet URI) -> auto select -> ready -> file tree
  r = await run(E, "ad('magnet/upload', {'magnets[]':['0123456789abcdef0123456789abcdef01234567']})");
  assert.equal(r.magnets[0].id, 'T1'); assert.equal(r.magnets[0].name, 'Big Movie');
  assert.ok(E.calls.some(c => c.startsWith('POST /rest/1.0/torrents/addMagnet')));
  r = await run(E, "ad('magnet/status', {id:'T1'}, {ver:'v4.1'})");          // first poll: waiting_files_selection -> auto "all"
  assert.equal(r.magnets.statusCode, 1);
  r = await run(E, "ad('magnet/status', {id:'T1'}, {ver:'v4.1'})");
  assert.equal(r.magnets.statusCode, 4); assert.equal(r.magnets.status, 'Ready'); assert.equal(r.magnets.size, 3000); assert.equal(r.magnets.uploadDate, 1790899200);
  r = await run(E, "ad('magnet/files', {'id[]':'T1'})");
  const tree = r.magnets[0].files; assert.equal(tree[0].n, 'Big Movie'); assert.equal(tree[0].e[0].n, 'movie.mkv'); assert.equal(tree[0].e[0].l, 'https://real-debrid.com/d/L1');
  assert.equal(tree[0].e[1].n, 'sub'); assert.equal(tree[0].e[1].e[0].n, 'en.srt'); ok('magnet flow + tree');

  // list (429 retry once, then paging stops on 204/short page)
  r = await run(E, "ad('magnet/status', {}, {ver:'v4.1'})");
  assert.equal(r.magnets.length, 1); assert.equal(r.magnets[0].statusCode, 4); ok('torrent list + 429 retry');

  // pick files by hand
  await run(E, "ad('magnet/upload', {'magnets[]':['magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']})");
  const P = { line() {}, pct() {} };
  E.ctx.P = P;
  const picked = await run(E, "rdPickFiles({id:'T2', name:'Big Movie'}, P)");
  assert.equal(picked, true); assert.equal(E.db.torrents.T2.files[0].selected, 1); assert.equal(E.db.torrents.T2.files[1].selected, 0);
  r = await run(E, "ad('magnet/files', {'id[]':'T2'})"); assert.equal(r.magnets[0].files[0].e.length, 1); ok('choose files before download');

  // unknown torrent id
  await assert.rejects(() => run(E, "ad('magnet/status', {id:'NOPE'})"), e => e.code === 'MAGNET_INVALID_ID'); ok('invalid torrent id');

  // restart = re-add hash + delete old
  const before = Object.keys(E.db.torrents).length;
  await run(E, "ad('magnet/restart', {id:'T1'})");
  assert.ok(!E.db.torrents.T1); assert.equal(Object.keys(E.db.torrents).length, before); ok('magnet/restart');
  await run(E, "ad('magnet/delete', {id:'T2'})"); assert.ok(!E.db.torrents.T2); ok('magnet/delete (204)');

  // hosts, quota, history
  r = await run(E, "ad('hosts', {}, {method:'GET'})");
  assert.equal(r.hosts['1fichier.com'].status, true); assert.equal(r.hosts['down.com'].status, false); assert.equal(r.hosts['1fichier.com'].domains[0], '1fichier.com');
  r = await run(E, "ad('user/hosts', {}, {ver:'v4.1', method:'GET'})");
  assert.equal(r.hosts['rapidgator.net'].quotaType, 'links'); assert.equal(r.hosts['big.com'].quota, 8192); assert.equal(r.hosts['big.com'].quotaType, 'traffic');
  r = await run(E, "ad('user/history', {}, {method:'GET'})");
  assert.equal(r.links[0].link, 'https://x.com/a'); assert.equal(r.links[0].size, 100); assert.equal(r.links[0].date, 1790848800);
  await run(E, "ad('user/history/delete')"); assert.equal(E.db.downloads.length, 0); ok('hosts / quota / history');

  // bad token -> readable code
  E.setToken('OTHER');
  await assert.rejects(() => run(E, "ad('user', {}, {method:'GET'})"), e => e.code === 'AUTH_BAD_APIKEY'); ok('bad token');

  // device-login token refresh on 401
  const E2 = makeEnv();
  E2.ctx.keys.keys.main = 'OLD'; E2.ctx.store.set('rd_oauth', { main: { client_id: 'c', client_secret: 's', refresh: 'R1', access: 'OLD', exp: Date.now() + 5000 } });
  E2.setToken('NEW');
  r = await run(E2, "ad('user', {}, {method:'GET'})");
  assert.equal(r.user.username, 'ali'); assert.equal(E2.refreshed(), 1); assert.equal(E2.ctx.keys.keys.main, 'NEW'); ok('oauth refresh');

  // a pasted token that differs from the stored oauth token is never replaced
  const E3 = makeEnv();
  E3.ctx.keys.keys.main = 'GOOD'; E3.ctx.store.set('rd_oauth', { main: { client_id: 'c', client_secret: 's', refresh: 'R1', access: 'STALE', exp: 0 } });
  await run(E3, "ad('user', {}, {method:'GET'})"); assert.equal(E3.refreshed(), 0); ok('pasted token kept');

  console.log('\nAll', n, 'checks passed');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
