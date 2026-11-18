// Google の各サービスを真似た最小の仮実装（検証用）
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
function makeEnv(codePath) {
  const sheets = {}; const props = {}; const events = []; const mails = []; const env = { gidSeq: 100, cache: {}, triggers: [], triggerSeq: 0, reads: { props: 0, sheets: 0, open: 0 }, formulas: [], user: 'admin@example.com', owner: 'admin@example.com', events, sheets, mails, props, now: 0 };
  // サーバー側の「今」をテストから決められるようにする（env.now が 0 なら本当の時刻）
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(env.now || Date.now()); else super(...a); }
    static now() { return env.now || Date.now(); }
  }
  const conv = (v) => {
    if (typeof v !== 'string' || v === '') return v;
    if (v[0] === "'") return env.noApos ? v : v.slice(1);
    if (v[0] === '=') { env.formulas.push(v); return '#FORMULA'; }
    if (/^\s*-?\d+(\.\d+)?\s*$/.test(v) || /^\s*\d+[eE]\d+\s*$/.test(v)) return Number(v);
    if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    return v;
  };
  const sheet = (name) => ({
    _d: [], _pivots: [], _fmt: [], _filter: null, _bands: [], _rules: [], _hidden: [], _frozen: {},
    setFrozenColumns(n) { this._frozen.cols = n; }, autoResizeColumns(a, b) { this._fmt.push(['autoResizeColumns', a, b]); }, showColumns() { this._hidden = []; },
    hideColumns(a, n) { if (env.decoFail === 'hideColumns') throw new Error('Cannot hide columns'); for (let i = 0; i < n; i++) this._hidden.push(a + i); },
    getFilter() { return this._filter; }, getBandings() { return this._bands.slice(); }, setConditionalFormatRules(r) { this._rules = r; },
    getName() { return name; }, setTabColor(c) { this._tab = c; }, setColumnWidth(c, w) { this._fmt.push(['setColumnWidth', c, w]); }, getSheetId() { return this._gid; }, getPivotTables() { return this._pivots.slice(); }, clearContents() { this._d.length = 0; }, getLastRow() { return this._d.length; }, appendRow(r) { this._d.push(r.map(conv)); }, setFrozenRows() {},
    getDataRange() { const d = this._d; return { getValues: () => { env.reads.sheets++; return d.map(r => r.slice()); } }; },
    getLastColumn() { return this._d.length ? this._d[0].length : 0; },
    getRange(r, c, nr, nc) { const d = this._d; return { getValues() { env.reads.sheets++; const out = []; for (let i = 0; i < (nr || 1); i++) { const row = d[r - 1 + i] || []; const line = []; for (let j = 0; j < (nc || 1); j++) line.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(line); } return out; }, setValue(v) { while (d.length < r) d.push([]); while (d[r - 1].length < c) d[r - 1].push(''); d[r - 1][c - 1] = conv(v); } }; },
    deleteRow(r) { this._d.splice(r - 1, 1); },
    /* まとめて行を消す。env.deleteFail で失敗させられる。行の数は、データより 5 行だけ多いことにする（空の行が少ないシート） */
    deleteRows(r, n) { if (env.deleteFail) throw new Error('Service error: Spreadsheets'); if (r < 2 || r - 1 + n > this._d.length) throw new Error('Those rows are out of bounds.'); if (this.getMaxRows() - n < 2) throw new Error('Sorry, it is not possible to delete all non-frozen rows.'); env.reads.del = (env.reads.del || 0) + 1; this._d.splice(r - 1, n); },
    getMaxRows() { return this._d.length + (this._spare === undefined ? 5 : this._spare); }, insertRowsAfter(r, n) { this._spare = (this._spare === undefined ? 5 : this._spare) + n; }
  });
  /* 範囲にまとめて書く（setValues）。1 枚ずつの sheet を作ったあとで、getRange に足す */
  const withSetValues = (sh) => { sh._gid = ++env.gidSeq; const g = sh.getRange.bind(sh); sh.getRange = (r, c, nr, nc) => { const o = g(r, c, nr, nc); o._at = { sheet: sh, r, c, nr: nr || 1, nc: nc || 1 };
    /* ピボットテーブル。作ったものは、そのシートの _pivots に入る（何を行に、何を値にしたかを覚える） */
    o.createPivotTable = (src) => { if (env.pivotFail) throw new Error('Pivot tables are not available.'); const pt = { at: [r, c], src: { name: src._at.sheet.getName(), rows: src._at.nr, cols: src._at.nc }, rowGroups: [], values: [],
      addRowGroup(n) { if (!(n >= 1 && n <= src._at.nc)) throw new Error('Column out of range'); pt.rowGroups.push(n); return {}; },
      addPivotValue(n, fn) { if (!(n >= 1 && n <= src._at.nc) || !fn) throw new Error('Invalid pivot value'); const v = { col: n, fn, name: '' }; pt.values.push(v); return { setDisplayName(x) { v.name = x; return this; } }; },
      remove() { const i = sh._pivots.indexOf(pt); if (i >= 0) sh._pivots.splice(i, 1); } }; sh._pivots.push(pt); return pt; }; o.setRichTextValues = (vals) => { env.reads.rich = (env.reads.rich || 0) + 1; if (env.decoFail === 'setRichTextValue') throw new Error('Rich text not available'); if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.'); sh._links = (sh._links || []).filter(l => !(l[1] >= c && l[1] < c + nc)); vals.forEach((rowv, i) => rowv.forEach((rt, j) => { sh._d[r - 1 + i][c - 1 + j] = rt.text; if (rt.url) sh._links.push([r + i, c + j, rt.text, rt.url]); })); return o; };
    o.createFilter = () => { if (env.decoFail === 'createFilter') throw new Error('Filter not available'); if (sh._filter) throw new Error('You can\'t create a filter in a sheet that already has a filter.'); sh._filter = { range: [r, c, nr, nc], remove() { sh._filter = null; } }; return sh._filter; };
    o.applyRowBanding = (theme) => { if (!theme) throw new Error('Banding theme required'); const b = { range: [r, c, nr, nc], remove() { const i = sh._bands.indexOf(b); if (i >= 0) sh._bands.splice(i, 1); } }; sh._bands.push(b); return b; };
    ['setFontWeight', 'setFontColor', 'setBackground', 'setVerticalAlignment', 'setNumberFormat'].forEach((mn) => { o[mn] = (v) => { sh._fmt.push([mn, v, r, c, nr || 1, nc || 1]); return o; }; });
    o.setValues = (vals) => { if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('The number of rows or columns in the data does not match the range.'); vals.forEach((row, i) => { while (sh._d.length < r + i) sh._d.push([]); const line = sh._d[r - 1 + i]; row.forEach((v, j) => { while (line.length < c + j) line.push(''); line[c - 1 + j] = conv(v); }); }); }; return o; }; return sh; };
  const makeBook = (id, name, sheets) => ({ _sheets: sheets, getId: () => id, getName: () => name, getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => { if (env.probeFail && /^_probe_/.test(String(n))) throw new Error('Service Spreadsheets failed'); const k = n || 'シート' + (Object.keys(sheets).length + 1); return (sheets[k] = withSetValues(sheet(k))); },
    getSheets: () => Object.keys(sheets).map(k => sheets[k]),
    /* シートの並べ替え（選んだシートを、左から pos 番目に動かす） */
    setActiveSheet(sh) { this._active = sh; return sh; }, moveActiveSheet(pos) { const keys = Object.keys(sheets), k = keys.filter(x => sheets[x] === this._active)[0]; if (!k) throw new Error('no active sheet'); const rest = keys.filter(x => x !== k); rest.splice(pos - 1, 0, k); const all = {}; rest.forEach(x => { all[x] = sheets[x]; }); keys.forEach(x => { delete sheets[x]; }); rest.forEach(x => { sheets[x] = all[x]; }); },
    deleteSheet: (sh) => { if (Object.keys(sheets).length <= 1) throw new Error('You can\'t remove all the sheets in a document.'); Object.keys(sheets).forEach(k => { if (sheets[k] === sh) delete sheets[k]; }); } });
  const ss = makeBook('SHEET1', 'テスト', sheets);
  env.book = ss; // 元のスプレッドシート（テストで、雛形のシートを先に入れておくときに使う）
  env.books = {}; // ドライブに作った別のスプレッドシート（id → 本）
  const ctx = {
    console, JSON, Date: FakeDate, Math, String, Number, Object, Array, isFinite, Error,
    SpreadsheetApp: { BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
      newRichTextValue: () => { const b = { text: '', url: '', setText(t) { b.text = t; return b; }, setLinkUrl(u) { b.url = u; return b; }, build() { return { text: b.text, url: b.url }; } }; return b; },
      newConditionalFormatRule: () => { const b = { o: {}, whenNumberGreaterThan(n) { b.o.gt = n; return b; }, setFontColor(c) { b.o.color = c; return b; }, setBold(v) { b.o.bold = v; return b; }, setRanges(rs) { b.o.ranges = rs.map(x => [x._at.r, x._at.c, x._at.nr, x._at.nc]); return b; }, build() { return b.o; } }; return b; },
      PivotTableSummarizeFunction: { SUM: 'SUM', COUNTA: 'COUNTA', COUNTUNIQUE: 'COUNTUNIQUE' }, __open: 0, getActiveSpreadsheet: () => { if (env.noActive === 'throw') throw new Error('no active'); return env.noActive ? null : ss; }, openById: (id) => { env.reads.open++; if (env.books[id]) { if (env.drive.some(f => f.id === id && f.trashed)) throw new Error('Document ' + id + ' is missing (perhaps it was deleted?)'); return env.books[id]; } return ss; }, flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => { env.reads.props++; return Object.assign({}, props); }, getProperty: (k) => { env.reads.props++; return props[k] || null; }, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    Session: { getActiveUser: () => ({ getEmail: () => env.user }), getEffectiveUser: () => ({ getEmail: () => env.owner }), getScriptTimeZone: () => env.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
    MailApp: { getRemainingDailyQuota: () => (env.quota === undefined ? 100 : env.quota), sendEmail(to, subject, body, options) { if (env.mailFail || (env.htmlFail && options)) throw new Error('Service invoked too many times'); mails.push({ to, subject, body, options: options || null, via: 'mailapp' }); } },
    CalendarApp: { Visibility: { PRIVATE: 'PRIVATE' }, getDefaultCalendar: () => ({ getName: () => 'cal', createEvent(title, s, e, o) { if (env.calFail) throw new Error('Invalid guest'); const id = 'ev' + events.length; const rec = { id, title, s, e, o }; events.push(rec); return { getId: () => id, setVisibility(v) { rec.visibility = v; } }; } }), getEventById: (id) => { const ev = events.filter(x => x.id === id)[0]; return ev && !ev.deleted ? { setDescription(d) { ev.o.description = d; }, setLocation(l) { ev.o.location = l || undefined; }, setTitle(t) { ev.title = t; }, setTime(a, b) { if (env.moveFail) throw new Error('cannot move'); ev.s = a; ev.e = b; ev.moved = (ev.moved || 0) + 1; }, deleteEvent() { ev.deleted = true; } } : null; } },
    /* 短いあいだだけ覚えておく場所。期限は env.now（なければ本当の時刻）で数える */
    CacheService: { getScriptCache: () => ({
      get(k) { if (env.noCache) throw new Error('Cache unavailable'); const x = env.cache[k]; if (!x) return null; if (x.until <= (env.now || Date.now())) { delete env.cache[k]; return null; } return x.v; },
      getAll(keys) { const o = {}; keys.forEach(k => { const v = this.get(k); if (v !== null) o[k] = v; }); env.reads.cache = (env.reads.cache || 0) + 1; return o; },
      put(k, v, sec) { env.reads.cachePut = (env.reads.cachePut || 0) + 1; if (env.noCache) throw new Error('Cache unavailable'); env.cache[k] = { v: String(v), until: (env.now || Date.now()) + (sec || 600) * 1000 }; },
      remove(k) { delete env.cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { base64Decode: (b64) => [...Buffer.from(String(b64), 'base64')], newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes, getContentType: () => type, getName: () => name }),
      computeHmacSha256Signature: (value, key) => [...crypto.createHmac('sha256', String(key)).update(String(value)).digest()].map(b => b > 127 ? b - 256 : b),
      base64EncodeWebSafe: (bytes) => (typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes.map(b => (b + 256) % 256))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      Charset: { UTF_8: 'UTF_8' }, base64Encode: (v, cs) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map(b => (b + 256) % 256))).toString('base64'),
      sleep: (ms) => { env.slept = (env.slept || 0) + ms; },
      getUuid: () => crypto.randomUUID(), formatDate: (d) => d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') },
    ScriptApp: { AuthMode: { FULL: 'FULL' }, AuthorizationStatus: { REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' },
      getAuthorizationInfo: () => ({ getAuthorizationStatus: () => (env.needAuth ? 'REQUIRED' : 'NOT_REQUIRED') }),
      /* 足りない承認があると、本物は承認の画面を出して実行を止める */
      requireAllScopes: () => { if (env.needAuth) { env.prompted = (env.prompted || 0) + 1; throw new Error('Authorization is required to perform that action.'); } },
      /* 時間で動く仕組み。env.triggers に置かれたものが入る。承認がまだ（env.needAuth）・失敗（env.triggerFail）なら置けない */
      getProjectTriggers: () => { if (env.needAuth) throw new Error('You do not have permission to call ScriptApp.getProjectTriggers. Required permissions: https://www.googleapis.com/auth/script.scriptapp'); return env.triggers.slice(); },
      deleteTrigger: (t) => { const i = env.triggers.indexOf(t); if (i >= 0) env.triggers.splice(i, 1); },
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => { if (env.triggerFail) throw new Error('This script has too many triggers.'); const t = { fn, minutes: n, uid: 'trg' + (++env.triggerSeq), getUniqueId() { return this.uid; }, getHandlerFunction() { return this.fn; } }; env.triggers.push(t); return t; } }) }) }),
      getService: () => ({ getUrl: () => (env.noUrl ? '' : env.url || 'https://script.google.com/a/macros/example.com/s/TEST/exec') }) },
    HtmlService: (() => {
      const out = (boot) => { const o = { setTitle(t) { o.title = t; return o; }, addMetaTag() { return o; }, boot,
        setFaviconUrl(u) { if (env.favFail || !/^https:\/\/.+\.(png|ico|gif|jpg|jpeg)$/i.test(String(u))) throw new Error('The favicon icon image type is not supported.'); o.favicon = u; return o; } /* 実機と同じく、画像を文字にした URL や拡張子のない URL は断る */ }; return o; };
      return { createHtmlOutput: () => out(''), createTemplateFromFile: () => { const t = { evaluate() { return out(t.boot); } }; return t; } };
    })()
  };
  // Gmail（本人のメールとして送る）。env.noGmail でサービスなし、env.gmailFail で API が使えない状態、env.mailFail でどちらの送り方も失敗
  // 受け取ったメールは、本物と同じように読み解いてから mails に入れる（件名や本文が正しく組まれているかも、ここで確かまる）
  const gmail = { Users: { Messages: { send(body, user) {
    if (env.needAuth) throw new Error('Request had insufficient authentication scopes.');
    if (env.gmailFail || env.mailFail) throw new Error('Gmail API has not been used in project 123 before or it is disabled.');
    if (user !== 'me' || !body || typeof body.raw !== 'string' || /[+/\s]/.test(body.raw)) throw new Error('Invalid raw');
    const raw = Buffer.from(body.raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const m = parseMime(raw);
    mails.push({ to: m.to, subject: m.subject, body: m.plain, options: m.html ? { htmlBody: m.html } : null, via: 'gmail', raw });
  } } } };
  // Sheets（まとめ読み）。本物と同じく、行の終わりの空欄・終わりの空の行は省き、日付は通し番号で返す。
  // env.noSheets でサービスなし、env.batchFail で失敗。env.reads.batch に呼んだ回数、env.batchRanges に最後に頼まれた範囲
  const serial = (v) => (v instanceof Date ? v.getTime() / 86400000 + 25569 : v);
  const colNum = (t) => t.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const sheetsApi = { Spreadsheets: { Values: { batchGet(id, o) {
    env.reads.batch = (env.reads.batch || 0) + 1; env.batchRanges = o.ranges.slice();
    if (env.batchFail) throw new Error('Google Sheets API has not been used in project 123 before or it is disabled.');
    if (id !== 'SHEET1' || o.valueRenderOption !== 'UNFORMATTED_VALUE') throw new Error('Invalid request');
    return { spreadsheetId: id, valueRanges: o.ranges.map((r) => {
      const mm = /^([^!]+)(?:!([A-Z]+)(\d+):([A-Z]+)(\d*))?$/.exec(r);
      if (!mm || !sheets[mm[1]]) throw new Error('Unable to parse range: ' + r);
      const d = sheets[mm[1]]._d; const gridRows = Math.max(1000, d.length);
      let rows;
      if (!mm[2]) rows = d.map(row => row.slice());
      else {
        const c0 = colNum(mm[2]), r0 = Number(mm[3]), c1 = colNum(mm[4]), r1 = mm[5] ? Number(mm[5]) : gridRows;
        if (r0 > gridRows) throw new Error('Range (' + r + ') exceeds grid limits. Max rows: ' + gridRows);
        rows = d.slice(r0 - 1, r1).map(row => row.slice(c0 - 1, c1));
      }
      rows = rows.map(row => { const x = row.map(v => (v === undefined || v === null ? '' : serial(v))); while (x.length && x[x.length - 1] === '') x.pop(); return x; });
      while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
      const out = { range: r, majorDimension: 'ROWS' };
      if (rows.length) out.values = rows;
      return out;
    }) };
  } } } };
  Object.defineProperty(ctx, 'Sheets', { enumerable: true, configurable: true, get: () => (env.noSheets ? undefined : sheetsApi) });
  // Calendar（予定に Meet を付ける）。サービスの側の予定の番号は、CalendarApp の番号とは別にしてある（本物でも同じとは限らない）
  // env.noCalendarApi でサービスなし、env.meetFail で失敗、env.meetPending でリンクがまだ返らない状態
  const calApi = { Events: {
    list(cal, o) { env.reads.cal = (env.reads.cal || 0) + 1; if (cal !== 'primary') throw new Error('Not Found'); const ev = events.filter(x => x.id === o.iCalUID && !x.deleted)[0]; return { items: ev ? [{ id: 'api_' + ev.id }] : [] }; },
    patch(res, cal, id, o) {
      if (env.meetRate > 0) { env.meetRate--; throw new Error('次のエラーが発生し、calendar.events.patch の呼び出しに失敗しました: Rate Limit Exceeded'); }
      if (env.meetFail) throw new Error('Invalid conference type value.');
      const ev = events.filter(x => 'api_' + x.id === id && !x.deleted)[0];
      if (!ev || cal !== 'primary') throw new Error('Not Found');
      if (!o || o.conferenceDataVersion !== 1) throw new Error('conferenceDataVersion is required');
      if (res.conferenceData === null) { delete ev.meet; return { id }; }
      const rq = res.conferenceData.createRequest;
      if (!rq || !rq.requestId || rq.conferenceSolutionKey.type !== 'hangoutsMeet') throw new Error('Invalid request');
      ev.meet = 'https://meet.google.com/abc-' + ev.id + '-xyz'; ev.meetMade = (ev.meetMade || 0) + 1;
      return env.meetPending ? { id, conferenceData: { createRequest: { requestId: rq.requestId, status: { statusCode: 'pending' } } } } : { id, hangoutLink: ev.meet };
    },
    get(cal, id) { const ev = events.filter(x => 'api_' + x.id === id && !x.deleted)[0]; if (!ev) throw new Error('Not Found'); return env.meetPending || !ev.meet ? { id } : { id, conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+81' }, { entryPointType: 'video', uri: ev.meet }] } }; }
  } };
  Object.defineProperty(ctx, 'Calendar', { enumerable: true, configurable: true, get: () => (env.noCalendarApi ? undefined : calApi) });
  // Drive（このアプリが作ったファイルだけを扱う）。env.drive に、作ったファイルとフォルダが入る
  // env.noDrive でサービスなし、env.driveFail で失敗、env.needAuth で承認がまだ
  env.drive = [];
  const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
  const driveApi = { Files: {
    create(res, blob, o) {
      if (env.needAuth) throw new Error('Request had insufficient authentication scopes.');
      if (env.driveFail) throw new Error('The user has exceeded their Drive storage quota.');
      const isFolder = res.mimeType === 'application/vnd.google-apps.folder';
      const isSheet = res.mimeType === SHEET_MIME;
      if (!isFolder && !isSheet && (!blob || !blob.bytes || !blob.bytes.length)) throw new Error('Empty file');
      if (res.parents && !env.drive.some(f => f.id === res.parents[0] && f.folder && !f.trashed)) throw new Error('File not found: parent');
      if (!isFolder && !(res.parents && res.parents.length)) throw new Error('File not found: parent');
      const f = { id: 'drv' + String(env.drive.length + 1).padStart(10, '0'), name: res.name, folder: isFolder, parents: res.parents || [], mimeType: isFolder || isSheet ? res.mimeType : blob.type, size: isFolder || isSheet ? 0 : blob.bytes.length, trashed: false };
      env.drive.push(f);
      if (isSheet) { const sh = {}; env.books[f.id] = makeBook(f.id, res.name, sh); env.books[f.id].insertSheet('シート1'); }
      return { id: f.id };
    },
    get(id) { const f = env.drive.filter(x => x.id === id)[0]; if (!f) throw new Error('File not found: ' + id); return { id: f.id, name: f.name, trashed: f.trashed, parents: f.parents.slice() }; },
    update(res, id, blob, o) {
      const f = env.drive.filter(x => x.id === id)[0]; if (!f) throw new Error('File not found: ' + id);
      if (env.driveFail) throw new Error('The user has exceeded their Drive storage quota.');
      if (res && res.trashed !== undefined) f.trashed = !!res.trashed;
      if (res && res.name !== undefined) f.name = res.name;
      if (o && o.addParents) { if (!env.drive.some(x => x.id === o.addParents && x.folder && !x.trashed)) throw new Error('File not found: parent'); const gone = String(o.removeParents || '').split(',').filter(String); f.parents = f.parents.filter(x => gone.indexOf(x) < 0).concat([o.addParents]); }
      return { id };
    },
    /* 探す。q は「name = '…' and '…' in parents and trashed = false」の形だけ読む */
    list(o) {
      if (env.listFail) throw new Error('Insufficient permissions for listing files.');
      const q = String(o && o.q || '');
      const nm = /name = '((?:[^'\\]|\\.)*)'/.exec(q), par = /'([^']+)' in parents/.exec(q);
      const name = nm ? nm[1].replace(/\\(.)/g, '$1') : null;
      return { files: env.drive.filter(f => !f.trashed && (name === null || f.name === name) && (!par || f.parents.indexOf(par[1]) >= 0)).map(f => ({ id: f.id, name: f.name })) };
    }
  } };
  Object.defineProperty(ctx, 'Drive', { enumerable: true, configurable: true, get: () => (env.noDrive ? undefined : driveApi) });
  Object.defineProperty(ctx, 'Gmail', { enumerable: true, configurable: true, get: () => (env.noGmail ? undefined : gmail) });
  vm.createContext(ctx);
  const i18nPath = require('path').join(require('path').dirname(codePath), 'I18n.gs');
  vm.runInContext((fs.existsSync(i18nPath) ? fs.readFileSync(i18nPath, 'utf8') + '\n' : '') + fs.readFileSync(codePath, 'utf8') + '\n;this.__T=function(s){return T_(s);};this.__trText=trText_;' + '\n;this.__mime=function(a,b,c,d){return mime_(a,b,c,d);};this.__mail=function(a,b,c,d){return mail_(a,b,c,d);};this.__keyOf=function(mail){var m=read_("members").filter(function(x){return String(x.email).toLowerCase()===mail;})[0];return m?keyOf_(m):"";};this.__outside=outside_;this.__reset=resetMemo_;this.__api={listArchive,archiveMonth,tidyDrive,exportBoard,setFavicon,addTaskPhoto,getTaskPhotos,removeTaskPhoto,setMode,renewKey,openSummary,reportLate,setDefaults,tick,authorize,testMail,resendInvite,joinProject,setMemberPhoto,getPhotos,saveShift,deleteShift,updateBoard,deleteBoard,updateMember,removeMember,setup,initProject,resetProject,getIcon,editTask,deleteTask,doGet,getState,addMember,createTask,assignTask,updateTask,linkTasks,unlinkTasks,setProject,addBoard,setMemberBoard,setRule,addRule,deleteRule,saveTemplate,deleteTemplate};', ctx);
  // 本物では、画面からの呼び出し 1 回ごとに新しい実行になり、覚え書きは空から始まる。ここでも呼び出しごとに空にする
  Object.keys(ctx.__api).forEach((k) => { const f = ctx.__api[k]; ctx.__api[k] = (...a) => { ctx.__reset(); return f(...a); }; });
  env.api = ctx.__api;
  env.ctxT = (x) => { ctx.__reset(); return ctx.__T(x); };
  // 時間が来たことにする: 置かれている見張りを 1 回ずつ動かす
  env.runTick = () => env.triggers.slice().map(t => env.api[t.fn]({ triggerUid: t.uid }));
  env.mime = (...x) => ctx.__mime(...x); env.mail = (...x) => { ctx.__reset(); return ctx.__mail(...x); };
  // テストの多くは「参加済みのメンバー」を前提にしている。既定では、追加したメンバーをその場で参加させ、招待のメールは数に入れない。
  // 招待そのものを確かめるテストは env.autoJoin = false にする
  env.autoJoin = true;
  const add = env.api.addMember;
  env.api.addMember = (input) => {
    const before = mails.length;
    const r = add(input);
    if (!env.autoJoin) return r;
    mails.length = before;
    const who = env.user, mail = String(input && input.email || '').toLowerCase();
    const k = ctx.__keyOf(mail);
    env.user = ctx.__outside(mail) ? '' : mail;
    try { env.api.joinProject({ key: k }); } finally { env.user = who; }
    return env.api.getState();
  };
  return env;
}
/** メールそのもの（RFC 5322 / MIME）を読み解く。テスト用の最小限。 */
function parseMime(raw) {
  if (/[^\x00-\x7f]/.test(raw)) throw new Error('メールに、変換していない文字が入っている');
  if (/(^|[^\r])\n/.test(raw)) throw new Error('改行が CRLF でない');
  const split = (text) => { const i = text.indexOf('\r\n\r\n'); return [text.slice(0, i).replace(/\r\n[ \t]+/g, ' '), text.slice(i + 4)]; };
  const headers = (text) => { const o = {}; text.split('\r\n').forEach(l => { const i = l.indexOf(':'); if (i < 1) throw new Error('見出しの行が壊れている: ' + l); o[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }); return o; };
  const word = (v) => v.replace(/\?= =\?/g, '?==?').replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g, (x, b) => Buffer.from(b, 'base64').toString('utf8'));
  const [h0, b0] = split(raw); const top = headers(h0);
  const body = (h, b) => { if (h['content-transfer-encoding'] !== 'base64' || !/charset=UTF-8/.test(h['content-type'])) throw new Error('本文の指定が違う'); if (b.split('\r\n').some(l => l.length > 76)) throw new Error('本文の 1 行が長すぎる'); return Buffer.from(b.replace(/\r\n/g, ''), 'base64').toString('utf8'); };
  const out = { to: top.to, subject: word(top.subject), plain: '', html: '', from: top.from || '', lines: h0.split('\r\n') };
  const mb = /^multipart\/alternative; boundary="([^"]+)"$/.exec(top['content-type'] || '');
  if (!mb) { out.plain = body(top, b0); return out; }
  const parts = b0.split('--' + mb[1]); if (parts[parts.length - 1].trim() !== '--') throw new Error('終わりの区切りがない');
  parts.slice(1, -1).forEach(p => { const [ph, pb] = split(p.replace(/^\r\n/, '').replace(/\r\n$/, '')); const hh = headers(ph); if (/^text\/plain/.test(hh['content-type'])) out.plain = body(hh, pb); else if (/^text\/html/.test(hh['content-type'])) out.html = body(hh, pb); });
  return out;
}
module.exports = { makeEnv };
