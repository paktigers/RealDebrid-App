/* =====================================================================================
   Real-Debrid REST API v1.0 adapter  (https://api.real-debrid.com/rest/1.0)

   The app UI was written for the AllDebrid data shapes (magnet status codes, file trees,
   unlock results ...). Instead of rewriting the whole UI, every call below returns data in
   exactly that shape, so the screens keep working unchanged.

   Loaded BEFORE the main script in index.html. It only uses helpers of the main script
   (http, form, sleep, store, keys, getKey, saveKeys, ADError ...) inside functions, i.e. at call time.
   ===================================================================================== */

const RD_BASE = 'https://api.real-debrid.com/rest/1.0';
const RD_OAUTH = 'https://api.real-debrid.com/oauth/v2';
const RD_CLIENT_ID = 'X245A4XAIBGVM';                       // public client id for open-source apps (device login)
const RD_GRANT = 'http://oauth.net/grant_type/device/1.0';

/* ---------- error mapping (Real-Debrid error_code / error text -> the codes the UI shows hints for) ---------- */
const RD_CODE = {
  1: 'MISSING_PARAMETER', 2: 'BAD_PARAMETER', 5: 'RATE_LIMIT', 6: 'LINK_ERROR', 8: 'AUTH_BAD_APIKEY',
  9: 'PERMISSION_DENIED', 10: 'AUTH_2FA', 11: 'AUTH_2FA', 12: 'AUTH_BAD_LOGIN', 13: 'LINK_PASS_PROTECTED',
  14: 'AUTH_USER_BANNED', 15: 'AUTH_NOT_ACTIVATED', 16: 'LINK_HOST_NOT_SUPPORTED', 17: 'LINK_HOST_UNAVAILABLE',
  18: 'LINK_HOST_LIMIT_REACHED', 19: 'LINK_TEMPORARY_UNAVAILABLE', 20: 'MUST_BE_PREMIUM', 21: 'LINK_TOO_MANY_DOWNLOADS',
  22: 'NO_SERVER', 23: 'TRAFFIC_EXHAUSTED', 24: 'LINK_DOWN', 25: 'SERVICE_UNAVAILABLE', 26: 'UPLOAD_TOO_BIG',
  27: 'UPLOAD_ERROR', 28: 'FILE_NOT_ALLOWED', 29: 'MAGNET_TOO_BIG', 30: 'MAGNET_INVALID_FILE', 31: 'ACTION_ALREADY_DONE',
  33: 'MAGNET_ALREADY_ACTIVE', 34: 'RATE_LIMIT', 35: 'LINK_INFRINGING', 36: 'FAIR_USAGE', 37: 'DISABLED_ENDPOINT'
};
const RD_STR = {
  bad_token: 'AUTH_BAD_APIKEY', permission_denied: 'PERMISSION_DENIED', unsupported_hoster: 'LINK_HOST_NOT_SUPPORTED',
  hoster_unavailable: 'LINK_HOST_UNAVAILABLE', hoster_limit_reached: 'LINK_HOST_LIMIT_REACHED',
  hoster_temporarily_unavailable: 'LINK_TEMPORARY_UNAVAILABLE', hoster_not_free: 'MUST_BE_PREMIUM',
  too_many_active_downloads: 'LINK_TOO_MANY_DOWNLOADS', ip_not_allowed: 'NO_SERVER', traffic_exhausted: 'TRAFFIC_EXHAUSTED',
  file_unavailable: 'LINK_DOWN', service_unavailable: 'SERVICE_UNAVAILABLE', infringing_file: 'LINK_INFRINGING',
  fair_usage_limit: 'FAIR_USAGE', disabled_endpoint: 'DISABLED_ENDPOINT', too_many_requests: 'RATE_LIMIT',
  torrent_file_invalid: 'MAGNET_INVALID_FILE', torrent_already_active: 'MAGNET_ALREADY_ACTIVE', torrent_too_big: 'MAGNET_TOO_BIG',
  unknown_resource: 'NOT_FOUND', resource_not_found: 'NOT_FOUND', account_locked: 'AUTH_USER_BANNED'
};
function rdErr(r, j) {
  const num = j && !Array.isArray(j) ? j.error_code : undefined;
  const msg = (j && !Array.isArray(j) && (j.error || j.error_description || j.message)) || ('HTTP ' + r.status);
  let code = RD_STR[String(msg).toLowerCase()] || (num !== undefined ? RD_CODE[num] : '');
  if (!code && /password/i.test(String(msg))) code = 'LINK_PASS_PROTECTED';
  if (!code && r.status === 401) code = 'AUTH_BAD_APIKEY';
  if (!code && r.status === 429) code = 'RATE_LIMIT';
  const e = new ADError(code || (num !== undefined ? 'RD_' + num : 'ERROR'), String(msg).replace(/_/g, ' '));
  e.http = r.status; e.rdCode = num;
  return e;
}

/* ---------- OAuth (device login) tokens: refreshed automatically; a pasted private API token never expires ---------- */
const rdOAuthAll = () => store.get('rd_oauth', {});
async function rdRefreshActive(force) {
  const name = keys.active, o = rdOAuthAll()[name];
  if (!o || !o.refresh || o.access !== keys.keys[name]) return false;     // not a device-login key (or the key was replaced)
  if (!force && o.exp - Date.now() > 120000) return false;
  const r = await http('POST', RD_OAUTH + '/token', { 'Content-Type': 'application/x-www-form-urlencoded' },
    form({ client_id: o.client_id, client_secret: o.client_secret, code: o.refresh, grant_type: RD_GRANT }));
  let j = null; try { j = JSON.parse(r.body); } catch (e) { return false; }
  if (r.status >= 400 || !j || !j.access_token) return false;
  keys.keys[name] = j.access_token; saveKeys();
  const all = rdOAuthAll();
  all[name] = Object.assign({}, o, { access: j.access_token, refresh: j.refresh_token || o.refresh, exp: Date.now() + (+j.expires_in || 3600) * 1000 });
  store.set('rd_oauth', all);
  return true;
}
async function rdToken() {
  if (!getKey()) throw new ADError('AUTH_MISSING_APIKEY', 'API token is not set');
  try { await rdRefreshActive(false); } catch (e) { /* use the current token */ }
  return getKey();
}

/* ---------- low level call ---------- */
let rdLast = 0;
async function rdCall(method, path, body, opt) {
  opt = opt || {};
  let tok = opt.token;
  if (tok === undefined) tok = await rdToken();
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = rdLast + 250 - Date.now();                 // Real-Debrid allows 250 requests / minute
    if (wait > 0) await sleep(wait);
    rdLast = Date.now();
    const headers = {}; let b = '';
    if (tok) headers.Authorization = 'Bearer ' + tok;
    if (body && (method === 'POST' || method === 'PUT')) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; b = form(body); }
    const r = await http(method, (opt.base || RD_BASE) + path, headers, b);
    if (r.status === 429) { await sleep(2000 + attempt * 1500); continue; }
    if (r.status === 401 && attempt === 0 && opt.token === undefined) {
      let again = false; try { again = await rdRefreshActive(true); } catch (e) {}
      if (again) { tok = getKey(); continue; }
    }
    const txt = String(r.body || '').trim();
    let j = null;
    if (txt) { try { j = JSON.parse(txt); } catch (e) { if (r.status < 400) throw new Error('Could not understand the server response (HTTP ' + r.status + ')'); } }
    if (r.status >= 400) throw rdErr(r, j);
    return j;                                               // 204 No Content -> null
  }
  throw new ADError('RATE_LIMIT', 'Too many requests');
}

/* ---------- helpers ---------- */
const rdIso = s => { const t = Date.parse(s); return isNaN(t) ? 0 : Math.floor(t / 1000); };
const rdMagnetUri = m => (/^[a-f0-9]{40}$/i.test(m) ? 'magnet:?xt=urn:btih:' + m : m);
const rdManual = new Set();                                 // torrents whose files the user wants to pick by hand

/* statusCode: 0-3 active, 4 ready, 5+ error  (the same convention the UI already uses) */
const RD_ST = {
  magnet_conversion: [0, 'Converting magnet'], waiting_files_selection: [1, 'Waiting for file selection'], queued: [1, 'Queued'],
  downloading: [2, 'Downloading'], compressing: [3, 'Compressing'], uploading: [3, 'Uploading'], downloaded: [4, 'Ready'],
  magnet_error: [5, 'Magnet error'], error: [6, 'Error'], virus: [7, 'Virus detected'], dead: [8, 'Dead torrent']
};
function rdTorrent(t) {
  const st = RD_ST[t.status] || [2, String(t.status || 'Unknown')];
  const size = +t.bytes || +t.original_bytes || 0;
  const pct = st[0] === 4 ? 100 : (+t.progress || 0);
  return {
    id: t.id, filename: t.filename || t.original_filename || t.hash || '(unknown)', hash: t.hash, size,
    downloaded: size * pct / 100, downloadSpeed: +t.speed || 0, seeders: t.seeders === null ? undefined : t.seeders,
    status: st[1], statusCode: st[0], uploadDate: rdIso(t.added), rdStatus: t.status
  };
}
const rdInfo = id => rdCall('GET', '/torrents/info/' + encodeURIComponent(id));
async function rdSelect(id, ids) {
  await rdCall('POST', '/torrents/selectFiles/' + encodeURIComponent(id), { files: ids === 'all' ? 'all' : [].concat(ids).join(',') });
}
async function rdAutoSelect(t) {
  if (t && t.status === 'waiting_files_selection' && !rdManual.has(String(t.id))) { await rdSelect(t.id, 'all'); t.status = 'queued'; }
}
/* Real-Debrid wants the files chosen BEFORE it downloads. Wait for the file list, let the user pick, then select. */
async function rdPickFiles(item, P) {
  rdManual.add(String(item.id));
  let t = null;
  for (let i = 0; i < 90; i++) {
    t = await rdInfo(item.id);
    if (t.status !== 'magnet_conversion') break;
    P.line(item.name + ' — reading magnet…', '', 'm' + item.id);
    await sleep(2000);
  }
  if (!t || t.status !== 'waiting_files_selection') return t && t.status !== 'magnet_error' && t.status !== 'dead';   // already selected / failed
  const files = (t.files || []).map(f => ({ id: f.id, label: String(f.path || '').replace(/^\//, ''), sub: fmtSize(f.bytes) }));
  const idx = files.length > 1 ? await choose('Files: ' + item.name, files) : files.map((_, i) => i);
  if (!idx || !idx.length) { P.line('Skipped: ' + item.name + ' (choose its files later in the Torrents tab)', 'warn'); return false; }
  await rdSelect(item.id, idx.map(i => files[i].id));
  rdManual.delete(String(item.id));
  return true;
}
/* torrent info -> the folder/file tree the UI expects: [{n, e:[...]}] folders, [{n, s, l}] files (l = restricted link) */
function rdTree(info) {
  const sel = (info.files || []).filter(f => f.selected === 1 || f.selected === true);
  const links = info.links || [];
  if (!sel.length || links.length !== sel.length) {
    // Real-Debrid packed several files into fewer links (archives): one entry per link
    return links.map((l, i) => ({ n: (info.filename || 'file') + (links.length > 1 ? ' (' + (i + 1) + ')' : ''), s: links.length === 1 ? (+info.bytes || 0) : 0, l }));
  }
  const root = [];
  sel.forEach((f, i) => {
    const parts = String(f.path || '').split('/').filter(Boolean);
    const name = parts.pop() || ('file' + (i + 1));
    let cur = root;
    for (const d of parts) {
      let n = cur.find(x => x.e && x.n === d);
      if (!n) { n = { n: d, e: [] }; cur.push(n); }
      cur = n.e;
    }
    cur.push({ n: name, s: +f.bytes || 0, l: links[i] });
  });
  return root;
}
async function rdPaged(path, per, maxPages) {
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const rows = await rdCall('GET', path + (path.includes('?') ? '&' : '?') + 'limit=' + per + '&page=' + p);
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < per) break;
  }
  return out;
}

/* ---------- .torrent upload (PUT /torrents/addTorrent, raw body) ---------- */
async function uploadTorrents(files) {
  if (!window.Android || !Android.putRaw) throw new Error('.torrent upload works only in the Android app');
  const tok = await rdToken(), out = [];
  for (const f of files) {
    const r = await new Promise(res => {
      const id = 'u' + (++_n); _cbs[id] = res;
      Android.putRaw(id, RD_BASE + '/torrents/addTorrent', JSON.stringify({ Authorization: 'Bearer ' + tok }), f.b64);
    });
    if (r.error) throw new Error('Network error: ' + r.error);
    let j = null; try { j = JSON.parse(r.body || 'null'); } catch (e) {}
    if (r.status >= 400 || !j || !j.id) { const e = rdErr(r, j); out.push({ file: f.name, error: { code: e.code, message: e.message } }); continue; }
    let name = f.name; try { const t = await rdInfo(j.id); name = t.filename || t.original_filename || name; } catch (e) {}
    out.push({ file: f.name, id: j.id, name, ready: false });
  }
  return out;
}

/* =====================================================================================
   ad(endpoint, body, opt): the one function the UI calls. Endpoint names are the old ones.
   ===================================================================================== */
async function ad(endpoint, body, opt) {
  body = body || {};
  switch (endpoint) {

    case 'user': {
      const u = await rdCall('GET', '/user');
      return { user: { username: u.username, email: u.email, avatar: u.avatar, isPremium: u.type === 'premium', premiumUntil: rdIso(u.expiration), premiumLeft: +u.premium || 0, fidelityPoints: u.points } };
    }

    case 'link/unlock': {
      const f = { link: body.link }; if (body.password) f.password = body.password;
      const d = await rdCall('POST', '/unrestrict/link', f);
      if (!d || !d.download) throw new ADError('LINK_ERROR', 'No download link was returned');
      const alt = Array.isArray(d.alternative) ? d.alternative : [];
      return {
        filename: d.filename, filesize: d.filesize, link: d.download, id: d.id, host: d.host, streamable: d.streamable,
        streams: alt.filter(a => a && a.download).map(a => ({ id: a.download, quality: a.quality || a.type || 'alt', ext: String((a.filename || '').split('.').pop() || a.type || ''), filesize: 0 }))
      };
    }

    case 'link/infos': {
      const infos = [];
      for (const link of [].concat(body['link[]'] || [])) {
        try {
          const f = { link }; if (body.password) f.password = body.password;
          const d = await rdCall('POST', '/unrestrict/check', f);
          if (d && d.supported === 0) infos.push({ link, error: { code: 'LINK_HOST_NOT_SUPPORTED', message: 'unsupported hoster' } });
          else infos.push({ link, filename: d.filename, size: d.filesize, host: d.host });
        } catch (e) {
          if (e.code === 'AUTH_BAD_APIKEY' || e.code === 'AUTH_MISSING_APIKEY') throw e;
          infos.push({ link, error: { code: e.code || 'ERROR', message: e.message } });
        }
      }
      return { infos };
    }

    case 'magnet/upload': {
      const out = [];
      for (const m of [].concat(body['magnets[]'] || [])) {
        try {
          const a = await rdCall('POST', '/torrents/addMagnet', { magnet: rdMagnetUri(m) });
          let name = m; try { const t = await rdInfo(a.id); name = t.filename || t.original_filename || name; } catch (e) {}
          out.push({ magnet: m, id: a.id, name, ready: false });
        } catch (e) {
          if (e.code === 'AUTH_BAD_APIKEY' || e.code === 'AUTH_MISSING_APIKEY') throw e;
          out.push({ magnet: m, error: { code: e.code || 'ERROR', message: e.message } });
        }
      }
      return { magnets: out };
    }

    case 'magnet/status': {
      if (body.id !== undefined && body.id !== '') {
        let t;
        try { t = await rdInfo(body.id); }
        catch (e) { if (e.http === 404 || e.rdCode === 7 || e.code === 'NOT_FOUND') throw new ADError('MAGNET_INVALID_ID', 'Torrent not found'); throw e; }
        await rdAutoSelect(t);
        return { magnets: rdTorrent(t) };
      }
      const rows = await rdPaged('/torrents', 100, 10);
      return { magnets: rows.map(rdTorrent) };
    }

    case 'magnet/files': {
      const out = [];
      for (const id of [].concat(body['id[]'] || [])) {
        try {
          const t = await rdInfo(id);
          if (t.status !== 'downloaded') out.push({ id, error: { code: 'MAGNET_NOT_READY', message: 'The torrent is not ready yet (' + t.status + ')' } });
          else out.push({ id, files: rdTree(t) });
        } catch (e) { out.push({ id, error: { code: e.code || 'ERROR', message: e.message } }); }
      }
      return { magnets: out };
    }

    case 'magnet/delete':
      await rdCall('DELETE', '/torrents/delete/' + encodeURIComponent(body.id));
      return {};

    case 'magnet/restart': {                       // Real-Debrid has no restart: add the same hash again, then remove the old entry
      const t = await rdInfo(body.id);
      if (!t.hash) throw new ADError('ERROR', 'This torrent has no hash');
      await rdCall('POST', '/torrents/addMagnet', { magnet: 'magnet:?xt=urn:btih:' + t.hash });
      try { await rdCall('DELETE', '/torrents/delete/' + encodeURIComponent(body.id)); } catch (e) {}
      return {};
    }

    case 'hosts': {
      const d = await rdCall('GET', '/hosts/status') || {};
      const hosts = {};
      for (const k of Object.keys(d)) { const h = d[k] || {}; hosts[k] = { name: h.name || k, domains: [k], status: h.status === 'up', type: 'host' }; }
      return { hosts, redirectors: {} };
    }

    case 'user/hosts': {                           // limited hosters: GET /traffic
      const d = await rdCall('GET', '/traffic') || {};
      const hosts = {};
      for (const k of Object.keys(d)) {
        const h = d[k] || {}, lim = +h.limit || 0, left = +h.left || 0;
        if (h.type === 'links') hosts[k] = { name: k, quota: left, quotaMax: lim, quotaType: 'links' };
        else if (h.type === 'gigabytes') hosts[k] = { name: k, quota: left * 1024, quotaMax: lim * 1024, quotaType: 'traffic' };
        else hosts[k] = { name: k, quota: left / 1048576, quotaMax: lim / 1048576, quotaType: 'traffic' };
      }
      return { hosts };
    }

    case 'user/history': {                         // Real-Debrid "Downloads" list
      const rows = await rdPaged('/downloads', 100, 5);
      return { links: rows.map(r => ({ id: r.id, filename: r.filename, size: r.filesize, host: r.host, date: rdIso(r.generated), link: r.link })) };
    }

    case 'user/history/delete': {
      const rows = await rdPaged('/downloads', 100, 5);
      for (const r of rows) { try { await rdCall('DELETE', '/downloads/delete/' + encodeURIComponent(r.id)); } catch (e) {} }
      return {};
    }

    case 'link/delayed':                           // Real-Debrid never delays a link
      throw new ADError('NOT_SUPPORTED', 'Real-Debrid does not use delayed links');

    default:
      throw new ADError('NOT_SUPPORTED', 'Unknown call: ' + endpoint);
  }
}

/* =====================================================================================
   Browser login = Real-Debrid "device" login (best for TV: type the code on your phone)
   ===================================================================================== */
async function pinLogin() {
  const r = await http('GET', RD_OAUTH + '/device/code?client_id=' + RD_CLIENT_ID + '&new_credentials=yes', {}, '');
  let p = null; try { p = JSON.parse(r.body); } catch (e) {}
  if (!p || !p.device_code || !p.user_code) throw rdErr(r, p);
  const url = p.verification_url || 'https://real-debrid.com/device';
  const tv = typeof IS_TV !== 'undefined' && IS_TV;
  let cancelled = false;
  const b = openSheet(`<h3>Code: <span style="letter-spacing:4px;font-size:1.3em">${esc(p.user_code)}</span></h3><div class="mut" style="margin-bottom:10px">On your phone or computer open <b>${esc(url.replace(/^https?:\/\//, ''))}</b>, sign in to Real-Debrid and type this code. It is detected here automatically.</div><div class="row"><button class="btn" id="pnNo">Cancel</button><button class="btn primary" id="pnOpen">Open browser</button></div><div class="mut" id="pnSt">Waiting…</div>`);
  sheetCancel = () => { cancelled = true; };
  $('#pnNo', b).onclick = cancelSheet;
  $('#pnOpen', b).onclick = () => openUrl(p.direct_verification_url || url);
  if (!tv) openUrl(p.direct_verification_url || url);
  const end = Date.now() + (+p.expires_in || 600) * 1000, every = Math.max(3, +p.interval || 5) * 1000;
  let cred = null;
  while (!cancelled && Date.now() < end) {
    await sleep(every); if (cancelled) break;
    const c = await http('GET', RD_OAUTH + '/device/credentials?client_id=' + RD_CLIENT_ID + '&code=' + encodeURIComponent(p.device_code), {}, '');
    let cj = null; try { cj = JSON.parse(c.body); } catch (e) {}
    if (c.status === 200 && cj && cj.client_id && cj.client_secret) { cred = cj; break; }   // 403 = still waiting for you
  }
  if (!cred) { if (!cancelled) { closeSheet(); toast('The code expired. Please try again.', true); } return; }
  const t = await http('POST', RD_OAUTH + '/token', { 'Content-Type': 'application/x-www-form-urlencoded' },
    form({ client_id: cred.client_id, client_secret: cred.client_secret, code: p.device_code, grant_type: RD_GRANT }));
  let tj = null; try { tj = JSON.parse(t.body); } catch (e) {}
  closeSheet();
  if (!tj || !tj.access_token) throw rdErr(t, tj);
  const n = await ask('Name for this key', { placeholder: 'e.g. main', value: Object.keys(keys.keys).length ? '' : 'main' });
  const name = (n && n.trim()) || 'key' + (Object.keys(keys.keys).length + 1);
  keys.keys[name] = tj.access_token; keys.active = name; saveKeys();
  const all = rdOAuthAll();
  all[name] = { client_id: cred.client_id, client_secret: cred.client_secret, refresh: tj.refresh_token || p.device_code, access: tj.access_token, exp: Date.now() + (+tj.expires_in || 3600) * 1000 };
  store.set('rd_oauth', all);
  toast('Logged in ✔');
}
