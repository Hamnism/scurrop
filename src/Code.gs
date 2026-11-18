/**
 * Scurrop
 * Google スプレッドシートに付けた Apps Script として動かす。サーバーは不要。
 * シート: members（メンバー）/ boards（ボード）/ templates（テンプレート）/ tasks（タスク）/ links（リンク）/ rules（ルール）/ history（履歴）
 */

const SCHEMA = '15';
/** この版の番号。設定の画面に出す。README の見出しと同じにする（テストで確かめる）。 */
const VERSION = '1.0.0';
/** このツールの置き場所（設定の画面から開ける）。新しい版は、ここから受け取る。 */
const REPO_URL = 'https://github.com/Hamnism/scurrop';
const SHEETS = {
  // status: invited（招待中）/ joined（参加済み）。空は参加済み（前の版のメンバー）。key_nonce は、組織の外の人をリンクで見分けるための材料
  members: ['email', 'name', 'role', 'board', 'active', 'photo_rev', 'status', 'key_nonce', 'invited_ms', 'joined_ms', 'invite_error'],
  // メンバーの写真（小さくした画像）。重いので、15 秒おきの更新には載せず、番号（photo_rev）が変わったときだけ取りに来る
  photos: ['email', 'data'],
  boards: ['name', 'color', 'order'],
  // geo: 開始・完了のときに位置情報を記録するか（タスクごとに管理者が決める。空はオフ）
  // meet: 空 = 付けない / on = 付ける（まだリンクがない）/ wait = 作成を頼んだ（リンク待ち）/ retry = 回数の上限で作れなかった（あとでやり直す）/ https://meet.google.com/… = リンク
  // series: 繰り返しタスクの、まとまりの id（同じ繰り返しのタスクは同じ値）。event_id が wait のタスクは、カレンダーの予定をあとから作る
  tasks: ['id', 'title', 'member_email', 'start_ms', 'end_ms', 'memo', 'status',
    'started_ms', 'done_ms', 'event_id', 'created_by', 'created_ms', 'note', 'late_notified_ms', 'template_id', 'values', 'address', 'geo', 'meet', 'series'],
  // geo / meet: このテンプレートから作るタスクの初めの値（位置情報を記録、Meet を付ける）
  templates: ['id', 'name', 'board', 'minutes', 'fields', 'active', 'geo', 'meet'],
  links: ['id', 'a_task', 'b_task', 'kind', 'created_by', 'created_ms'],
  // シフト: 日付は 20261114 のような数、時刻は 0 時からの分。repeat は none（その日だけ）/ daily（毎日）/ weekly（毎週、days に曜日）。区切りは |
  shifts: ['id', 'member_email', 'date', 'start_min', 'end_min', 'repeat', 'days', 'until', 'skip', 'created_by', 'created_ms'],
  rules: ['id', 'when', 'then', 'enabled'],
  // 報告の写真。元の画像は Google ドライブ（file_id）、画面に出す小さい画像は task_thumbs に分けて置く（重いので、15 秒おきの更新には載せない）
  task_photos: ['id', 'task_id', 'field', 'email', 'time_ms', 'file_id'],
  task_thumbs: ['id', 'data'],
  history: ['time_ms', 'time', 'email', 'task_id', 'action', 'note', 'lat', 'lng', 'accuracy_m']
};
// ボードの色。テーマの 6 色（1F2E38・6965AD・4EA3DE・A5B5E2・D0CFEB・EDF0E8）の色相から作った、青〜紫のグラデーション。
// 紺とすみれは元の色のまま。明るい色は、白い文字が読めるところまで同じ色相で濃くした。暖色は入れない（画面の PALETTE と同じ）
const PALETTE = ['#1F2E38', '#2A5C8A', '#2279B6', '#5271C7', '#6965AD', '#514C94'];
// 新しいボードに色を付ける順。隣どうしが似た色にならないよう、グラデーションを飛び飛びに使う
const PALETTE_ORDER = [2, 4, 0, 3, 1, 5];
function boardColor_(n) { return PALETTE[PALETTE_ORDER[n % PALETTE_ORDER.length]]; }
const LATE_MS = 10 * 60 * 1000;
const NAME_MAX = 30; // プロジェクト名の文字数の上限
const FIELD_TYPES = ['text', 'long', 'number', 'select', 'multi', 'date', 'time', 'photo'];
const WHENS = { assign: '割り当て', edit: '変更', start: '開始', done: '完了', late: '開始の遅延', unassigned: '未割り当て' };
const THENS = { notify_admin: '管理者', notify_member: 'メンバー', notify_linked: 'リンク先のメンバー' };
const DEFAULT_RULES = [
  ['assign', 'notify_member', true],
  ['late', 'notify_member,notify_admin', true],
  ['done', 'notify_admin,notify_linked', true],
  ['start', 'notify_admin', false],
  ['unassigned', 'notify_admin', false],
  ['edit', 'notify_member', false]
];

// ---------- 言語 ----------
// 画面・メール・スプレッドシートの文言は、日本語で書いてある。ほかの言語は、対訳の表（I18n.gs の I18N）で置き換える。
// 言語は、プロジェクトを始めるときに 1 回だけ決める（あとからは変えない。メールやスプレッドシートの列名は、開く人ごとに変えられないため）。

/** このプロジェクトの言語。決めていなければ日本語。 */
function lang_() {
  const l = props_().getProperty('LANG') || 'ja';
  return l !== 'ja' && typeof I18N !== 'undefined' && I18N[l] ? l : 'ja';
}

/**
 * 文言を、決めた言語に直す（画面の側にも、同じものがある）。
 * 対訳の表に同じ文があれば、それを使う。なければ、表にある言い回しを長い順に置き換え、日付・単位・かっこの形を直す。
 * 日本語が入っていない文字は、そのまま返す。
 */
function trText_(s, dict, lang, cache) {
  if (!dict || typeof s !== 'string' || !/[ぁ-んァ-ヶ一-龥（）「」、。・：〜]/.test(s)) return s;
  if (Object.prototype.hasOwnProperty.call(dict, s)) return dict[s];
  if (cache.memo[s] !== undefined) return cache.memo[s];
  if (!cache.keys) {
    // 1 文字だけの鍵（日・月・分 など）は、そのままの文言のときだけ使う。文の中の置き換えには使わない
    cache.keys = Object.keys(dict).filter(function (k) { return k.length >= 2 && /[ぁ-んァ-ヶ一-龥]/.test(k); }).sort(function (a, b) { return b.length - a.length; });
  }
  const zh = lang === 'zh-TW';
  const JA = /[ぁ-んァ-ヶ一-龥]/;
  let out = s;
  for (let i = 0; i < cache.keys.length && JA.test(out); i++) {
    const k = cache.keys[i];
    if (out.indexOf(k) >= 0) out = out.split(k).join(dict[k]);
  }
  if (JA.test(out)) {
    (zh ? [[/(.)曜日/g, '週$1']] : [[/(\d{4})年(\d{1,2})月(\d{1,2})日?/g, '$1/$2/$3'], [/(\d{4})年(\d{1,2})月?/g, '$1/$2'], [/(\d{1,2})月(\d{1,2})日?/g, '$1/$2'], [/(\d{1,2})日/g, '$1'], [/曜日/g, ''],
      [/(\d+)\s?時間/g, '$1 h'], [/(\d+)\s?分/g, '$1 min'], [/(\d+)\s?(件|枚|通|個|人)/g, '$1'], [/(\d+)\s?回/g, '$1×'], [/約\s?/g, '~'],
      // 置き換えのあとに残った助詞（英字や数字にはさまれた 1 文字）は、空白にする
      [/([^ぁ-んァ-ヶ一-龥])[のをにはがでとも]+(?![ぁ-んァ-ヶ一-龥])/g, '$1 ']])
      .forEach(function (p) { out = out.replace(p[0], p[1]); });
  }
  if (!zh) {
    out = out.replace(/（/g, ' (').replace(/）/g, ')').replace(/「/g, '“').replace(/」/g, '”').replace(/、/g, ', ').replace(/。/g, '. ').replace(/・/g, ' · ').replace(/：/g, ': ').replace(/〜/g, '–')
      .replace(/ {2,}/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ([,.:])/g, '$1');
  }
  cache.memo[s] = out;
  return out;
}

/** サーバーの側で作る文言（メール・ファイルの名前・シートの名前）を、プロジェクトの言語に直す。 */
function T_(s) {
  const l = lang_();
  if (l === 'ja') return s;
  const m = mem_();
  if (!m.tr || m.tr.lang !== l) m.tr = { lang: l, memo: {}, keys: null };
  return trText_(s, I18N[l], l, m.tr);
}
/**
 * 利用者が入れた文字（タスク名・メモ・名前など）に付けるしるし。メールの文面を作るときに、これで包む。
 * 包んだところは、ほかの言語に直すときに触らない（タスク名の「削除」が Delete になる、といった書き換えを防ぐ）。
 * しるしは、メールを送る直前（mail_ の中の TU_）で外す。メールのほかには使わない。
 */
function U_(v) {
  const t = String(v == null ? '' : v).replace(/[\uE000\uE001]/g, '');
  return t === '' ? '' : '\uE000' + t + '\uE001';
}
/** U_ で包んだところはそのままにして、ほかをプロジェクトの言語に直す。しるしは外す。 */
function TU_(s) {
  return String(s == null ? '' : s).split(/(\uE000[^\uE001]*\uE001)/).map(function (seg, i) { return i % 2 ? seg.slice(1, -1) : T_(seg); }).join('');
}
/** 表にそのままある文言だけを直す（スプレッドシートのセルの値など。利用者が入れた文字を、勝手に置き換えないため）。 */
function X_(v) {
  const l = lang_();
  return l !== 'ja' && typeof v === 'string' && Object.prototype.hasOwnProperty.call(I18N[l], v) ? I18N[l][v] : v;
}
/** 場所ごとに訳し分ける語句（メールの件名の「割り当て」は Assigned、など）。対訳の表に「語句@場所」があれば、それを使う。 */
function TX_(s, ctx) {
  const l = lang_();
  return l !== 'ja' && Object.prototype.hasOwnProperty.call(I18N[l], s + '@' + ctx) ? I18N[l][s + '@' + ctx] : s;
}
/** 曜日の呼び名（日曜から）。 */
function wd_() { const l = lang_(); return l !== 'ja' && typeof I18N_WD !== 'undefined' && I18N_WD[l] ? I18N_WD[l] : SUM_WD; }

// ---------- 初期設定 ----------
// ふつうは Web アプリを最初に開いたときの初回ページ（initProject）で済む。setup はエディタから実行する予備の入口。

/** シートを用意し、この人を管理者として登録する。今あるデータは消さない。 */
function init_(ss, email) {
  props_().setProperty('SHEET_ID', ss.getId());
  secret_(); // 鍵の秘密は、始めるときに作っておく（あとから、2 つの実行が同時に作らないように）
  ensureSheets_();
  if (email && !read_('members').some(function (m) { return String(m.email).toLowerCase() === email.toLowerCase(); })) {
    appendObj_('members', { email: email, name: email.split('@')[0], role: 'admin', board: '', active: true, status: 'joined', joined_ms: Date.now() });
  }
}

function setup() {
  // この関数は画面からも呼べてしまうので、公開した本人以外は通さない（ほかの人が自分を管理者にできないように）
  if (!canSetup_()) throw new Error('初期設定は、このアプリをデプロイしたアカウントで実行してください。');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートの「拡張機能 → Apps Script」から開いたエディタで実行してください。');
  init_(ss, activeEmail_());
  try { noteUrl_(execUrl_()); } catch (err) { /* URL のシートを書けなくても、初期設定はできている */ }
  return '初期設定が完了しました: ' + ss.getName();
}

function isReady_() { return !!props_().getProperty('SHEET_ID'); }

/** 初回の設定ができるのは、この Web アプリを公開した本人だけ。 */
function canSetup_() {
  const a = String(activeEmail_() || '').toLowerCase();
  const o = String(ownerEmail_() || '').toLowerCase();
  return !!a && a === o;
}

function projectName_(raw) {
  const name = text_(raw, 200);
  if (!name) throw new Error('プロジェクト名を入力してください。');
  if (Array.from(name).length > NAME_MAX) throw new Error('プロジェクト名は ' + NAME_MAX + ' 文字までです。');
  return name;
}

/**
 * アイコンとファビコンの画像。画面の側で小さくした data URL だけを受け取る（PNG・JPEG・WebP）。空ならなし。
 * スクリプトのプロパティは 1 つ 9KB までなので、分けて保存する。
 */
const ICON_MAX = 60000;
const FAV_MAX = 12000;
// Scurrop のしるし（青いのぞきハム）。絵の正本は index.html の HAM。絵を変えたら `node test/ham.js` で作り直す（テストが同じ絵かを確かめる）
// HAM_FAV: ファビコン用の 48px の PNG。HAM_MAIL: メールに入れる 128px の PNG
const HAM_FAV = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAzElEQVR42u3asQ2DQAwF0NskG6RmCrZIkbkQZUrmSCagoEJCSGyQdJGLs3QWmPtG/6RfYvtJ1lFASsq53ZsvUpL1EFADgDa0GUNADUCUoVUMAQQQcFFA243ZeA9k7UsAFEA+8Hkv2Xhg9vQlIDTAIwRcBoAcAqAAUYbWQkAIgNy5dZv/8dhpa30CwgE8rt099QkIASiJ3N2SwL0HCKgB0IZ7Pl7ZeGAIgALIov0wZWPddWtK+hIABZDHe7ijon6lJKA2ABlj/leCgJMAP16z3zw3nWNUAAAAAElFTkSuQmCC';
const HAM_MAIL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAABsElEQVR42u3asQkCMRiG4WziBtZO4RYWziWWls6hE1hYCSK4gbZXiMcR7pL8eQJv7315qmBKmWe13nxUrlT6uAQAXAQAAkAACAABoFAAjNw5ECMCYEgABIAAEAACQKEAGKlzIEYAwBAACAABIAAEgAAQAAJAAAgAASAABIAA+NH2cMuq9wsovR8AAAAAAAAAAAAAAAAAAAAAAEz5gdfLM6voQGrfDwAAAAAAAAAAAAAAAAAAAAAAavqA6AEAAAAAAAAAAAAAAAAAAAAAQEsAVHcAAAAAAAAAAAAAAAAAAAAAADAEYKS+AwAAIwAgAASAABAAAmDJh4jX+/G36A8xpb8fAAAAAAAAAAAAAAAAAAAAAACWHCD6H1Jq/34AAAAAAAAAAAAAAAAAAAAAAGipsYeUufOHEAAAAAAAAAAAAAAAAAAAAAAAqOeC97tTVtGBAAAAAAAAAAAAAAAAAAAAAADAlAs4nu9ZlX7IKd3c+wEAAAAAAAAAAAAAAAAAAAAAwBDA2On9glov5R4jAmBIAASAABAAAkBdAQCk8wsGAAAAAAAAAAAAAAAAAAAAIBKAL7ZGiRahV7CJAAAAAElFTkSuQmCC';
const NAVY = '#1F2E38';
/** 画面の明るさ: light（白い背景）/ dark（黒い背景）/ auto（見ている端末の設定に合わせる）。決めていなければ light。 */
const MODES = ['light', 'dark', 'auto'];
function mode_() {
  const v = String(props_().getProperty('MODE') || '');
  return MODES.indexOf(v) >= 0 ? v : 'light';
}
// ファビコンの置き場所。Apps Script は、インターネットに公開された「.png で終わる URL」しかファビコンとして受け付けない
// （2026-11-14 実機で確認: 画像を文字にして直接渡す方法は「このファビコンの画像形式はサポートされていません」と断られた）。
// 自分で用意した画像を使うときは、公開の場所に置き、その URL をここに書く。空のあいだは、設定で選んだ絵文字を使う
/**
 * ファビコン（ブラウザのタブの絵）。Apps Script は、インターネットに公開された画像の URL しか受け付けない（画像を文字にして渡すと断られる）。
 * 開発元のサーバーに取りに行く形にはしない。Google が配っている絵文字の画像（Noto Emoji、fonts.gstatic.com）を使う。
 * 初めはハムスター。設定の画面で、ほかの絵文字に変えられる。
 */
const EMOJI_BASE = 'https://fonts.gstatic.com/s/e/notoemoji/15.0/';
const FAVICON_DEFAULT = '1f439'; // 🐹
/** 絵文字の番号（16 進の文字コードを「_」でつないだもの。例: 1f439、1f468_200d_1f4bb）。 */
const EMOJI_RE = /^[0-9a-f]{2,6}(_[0-9a-f]{2,6}){0,7}$/;
function faviconCode_() {
  const v = String(props_().getProperty('FAVICON_EMOJI') || '');
  return EMOJI_RE.test(v) ? v : FAVICON_DEFAULT;
}
/** ファビコンの URL。スクリプトのプロパティ FAVICON_URL に https の .png か .ico の URL があれば、そちらを使う（自分で画像を置いた人のため）。 */
function faviconUrl_() {
  const v = String(props_().getProperty('FAVICON_URL') || '');
  if (/^https:\/\/[^\s"'<>]+\.(png|ico)$/i.test(v)) return v;
  return EMOJI_BASE + faviconCode_() + '/72.png';
}
const CHUNK = 8000;

function image_(raw, max, label) {
  const v = String(raw == null ? '' : raw);
  if (!v) return '';
  if (v.length > max || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw new Error(label + 'の画像を読み込めませんでした。');
  return v;
}

function setBig_(key, value) {
  const p = props_();
  const old = Number(p.getProperty(key + '_N')) || 0;
  const n = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < n; i++) p.setProperty(key + '_' + i, value.slice(i * CHUNK, (i + 1) * CHUNK));
  for (let i = n; i < old; i++) p.deleteProperty(key + '_' + i);
  p.setProperty(key + '_N', String(n));
}

function getBig_(key) {
  const p = props_();
  const n = Number(p.getProperty(key + '_N')) || 0;
  let out = '';
  for (let i = 0; i < n; i++) out += p.getProperty(key + '_' + i) || '';
  return out;
}

/** 名前・アイコン・ファビコンをまとめて保存する。アイコンが変わるたびに番号（rev）を進め、画面はそれを見て取り直す。 */
/** ボードに出す時間帯（何時から何時まで）。なければ 8〜18 時。タスクがはみ出す日は、その分だけ広がる。 */
function hours_() {
  const a = Number(props_().getProperty('DAY_START')), b = Number(props_().getProperty('DAY_END'));
  return props_().getProperty('DAY_END') && a >= 0 && b > a && b <= 24 ? [a, b] : [8, 18];
}

function saveProject_(name, icon) {
  const was = props_().getProperty('PROJECT_NAME') || '';
  props_().setProperty('PROJECT_NAME', name);
  if (was && was !== name) renameDrive_(name);
  setBig_('PROJECT_ICON', icon);
  setBig_('PROJECT_FAV', ''); // ファビコンは Scurrop のしるしで決まっている。前の版で保存した分は消す
  props_().setProperty('PROJECT_ICON_REV', String(Date.now()));
}

/** アイコンの画像を返す。15 秒おきの更新には載せず、番号が変わったときだけ画面が取りに来る。 */
function getIcon(key) {
  if (!isReady_()) return { rev: '', data: '' };
  try { if (me_(key).role === 'guest') return { rev: '', data: '' }; } catch (err) { return { rev: '', data: '' }; }
  return { rev: props_().getProperty('PROJECT_ICON_REV') || '', data: getBig_('PROJECT_ICON') };
}

/** 初回ページから呼ぶ。プロジェクト名（必須）とアイコン（任意）を受け取り、シートを用意して始める。 */
function initProject(input) {
  const name = projectName_(input && input.name);
  const icon = image_(input && input.icon, ICON_MAX, 'アイコン');
  withLock_(function () {
    if (isReady_()) throw new Error('設定済みです。ページを再読み込みしてください。');
    if (!canSetup_()) throw new Error('初期設定は、このアプリをデプロイしたアカウントで実行してください。');
    // Web アプリからスプレッドシートを取れるかは実機での確認待ち。取れないときは setup に案内する
    let ss = null;
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
    if (!ss) throw new Error('スプレッドシートが見つかりません。Apps Script のエディタで setup を実行してください。');
    init_(ss, activeEmail_());
    saveProject_(name, icon);
    // 言語は、ここで 1 回だけ決める
    const lang = String(input && input.lang || 'ja');
    if (lang !== 'ja' && typeof I18N !== 'undefined' && I18N[lang]) props_().setProperty('LANG', lang); else props_().deleteProperty('LANG');
    try { noteUrl_(execUrl_()); } catch (err) { /* URL のシートを書けなくても、開始はできている */ }
  });
  return getState();
}

/**
 * プロジェクトを最初の状態に戻す。できるのは、このアプリを公開した本人（管理者）だけ。
 * このアプリのシートをデータごと消し、初回ページに戻る。カレンダーに作った予定は残る。
 */
function resetProject() {
  const me = me_();
  requireAdmin_(me);
  if (!canSetup_()) throw new Error('リセットは、このアプリをデプロイしたアカウントで実行してください。');
  withLock_(function () {
    const ss = book_();
    const mine = Object.keys(SHEETS).map(function (n) { return ss.getSheetByName(n); }).filter(Boolean)
      .concat(ss.getSheets().filter(function (sh) { const n = sh.getName(); return n === SUM_LIST || n === SUM_VIEW || SUM_OLD.indexOf(n) >= 0 || /^report_\d{4}-\d{2}$/.test(n); }));
    if (ss.getSheets().length <= mine.length) ss.insertSheet(); // シートが 0 枚にはできないので、空のシートを 1 枚残す
    mine.forEach(function (sh) { ss.deleteSheet(sh); });
    membersChanged_();
    forget_();
    touchAll_();
    try { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); }); } catch (err) { /* 承認がまだなら、見張りは置かれていない */ }
    const p = props_();
    setBig_('PROJECT_ICON', '');
    setBig_('PROJECT_FAV', '');
    ['SHEET_ID', 'SCHEMA', 'PROJECT_NAME', 'PROJECT_ICON', 'PROJECT_ICON_N', 'PROJECT_FAV_N', 'PROJECT_ICON_REV', 'DAY_START', 'DAY_END', 'TEXT_MODE', 'KEY_SECRET', 'LANG', 'CAL_INVITE', 'RULES_REV', 'FOLDERS', 'SUM_FILE', 'MAIL_VIA', 'MAIL_WHY', 'HIST_N', 'TICK_ID', 'TICK_WHY', 'TICK_LAST', 'TICK_SET', 'APP_URL', 'THEME', 'MODE', 'DEFAULT_GEO', 'DEFAULT_MEET', 'PHOTO_FOLDER', 'FAVICON_EMOJI'].forEach(function (k) { p.deleteProperty(k); });
  });
  return getState();
}

/** 足りないシートと列を足す。今あるデータは消さない。 */
function ensureSheets_() {
  const ss = book_();
  let rulesNew = false;
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      try { sh.setTabColor(TAB_COLORS.data); } catch (err) { /* 色を付けられなくても続ける */ }
      if (name === 'rules') rulesNew = true;
    }
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
    } else {
      const head = sh.getDataRange().getValues()[0];
      SHEETS[name].forEach(function (col) {
        if (head.indexOf(col) < 0) {
          head.push(col);
          sh.getRange(1, head.length).setValue(col);
        }
      });
    }
  });
  forget_(); // シートや列を足したので、覚え書きは捨てる
  touchAll_();
  if (rulesNew || read_('rules').length === 0) {
    const sh = ss.getSheetByName('rules');
    DEFAULT_RULES.forEach(function (r) { sh.appendRow([id_(), r[0], r[1], r[2]].map(cell_)); });
    forget_('rules');
  } else {
    // 前の版から使っているプロジェクトに、1 回だけ足す
    const rev = Number(props_().getProperty('RULES_REV')) || 1;
    const sh = ss.getSheetByName('rules');
    const have = read_('rules');
    if (rev < 2) {
      // 割り当てたらメンバーに知らせる／完了したら管理者に知らせる
      if (!have.some(function (r) { return String(r.when) === 'assign'; })) sh.appendRow([id_(), 'assign', 'notify_member', true].map(cell_));
      if (!have.some(function (r) { return String(r.when) === 'done' && String(r.then).indexOf('notify_admin') >= 0; })) sh.appendRow([id_(), 'done', 'notify_admin', true].map(cell_));
    }
    // 時間・場所などを変えたらメンバーに知らせる（初めはオフ）
    if (rev < 3 && !have.some(function (r) { return String(r.when) === 'edit'; })) sh.appendRow([id_(), 'edit', 'notify_member', false].map(cell_));
    forget_('rules');
  }
  props_().setProperty('RULES_REV', '3');
  // メンバーに書かれているボード名を、ボードの一覧にそろえる
  const known = {};
  read_('boards').forEach(function (b) { known[String(b.name)] = true; });
  let n = Object.keys(known).length;
  read_('members').forEach(function (m) {
    const b = String(m.board || '');
    if (b && !known[b]) {
      ss.getSheetByName('boards').appendRow([b, boardColor_(n), n + 1].map(cell_));
      known[b] = true;
      n++;
    }
  });
  forget_('boards');
  props_().setProperty('SCHEMA', SCHEMA);
}

// ---------- 画面 ----------

function doGet(e) {
  const q = (e && e.parameter) || {};
  const task = String(q.task || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40);
  const key = String(q.k || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 80);
  // 登録されていない人には、プロジェクトの名前もアイコンも出さない
  let known = false;
  try { known = isReady_() && (gate_(key), preload_(STATE_SHEETS), me_(key).role !== 'guest'); } catch (err) { known = false; }
  // 最初の状態を、ページと一緒に返す。これまでは、ページが出たあとにもう 1 回取りに来ていた（1 往復ぶん遅かった）。
  // だれか分からない人には返さない（getState が断る）。失敗しても、ページは返す（画面の側が取りに来る）
  let first = null;
  try { first = getState({ key: key }); } catch (err) { first = null; }
  const icon = known ? getIcon(key) : { rev: '', data: '' };
  // ファビコンは、ページを返すときにサーバー側でしか決められない。受け付けられなければ Apps Script の既定のままで、
  // 理由を設定の「状態」に出す。?fav=0 を付けると試さない（うまく開けないときの逃げ道）
  const favUrl = faviconUrl_();
  let fav = '', favNote = 'なし';
  if (q.fav !== '0' && favUrl) {
    try { HtmlService.createHtmlOutput('').setFaviconUrl(favUrl); fav = favUrl; favNote = 'ok'; } catch (err) { favNote = String(err && err.message ? err.message : err).slice(0, 120); }
  }
  const t = HtmlService.createTemplateFromFile('index');
  // この文字はページの <script> の中にそのまま入る。「<」を含むと script を閉じられてしまうので、< に置き換える
  try { const u = url_(); if (u && props_().getProperty('APP_URL') !== u) props_().setProperty('APP_URL', u); } catch (err) { /* 覚えられなくても、ページは出す */ }
  // デプロイした本人が、まだ書いていない URL で開いたら、スプレッドシートの「URL」のシートに書く
  try { const x = execUrl_(); const l = x ? urlList_() : []; if (x && !(l.length && l[0].u === x) && canSetup_()) noteUrl_(x); } catch (err) { /* 書けなくても、ページは出す */ }
  t.boot = JSON.stringify({ task: task, key: key, icon: icon.data, iconRev: icon.rev, fav: favNote, self: url_(), mode: known ? mode_() : 'light', debug: String(q.debug || '') === '1' && !!(first && first.me), state: first,
    // 言語。始める前（初回ページ）は、選べるように全部の対訳を渡す。始めたあとは、決めた言語の分だけ
    lang: lang_(), dict: lang_() === 'ja' ? null : I18N[lang_()], wd: wd_(),
    langs: !isReady_() && typeof I18N_NAMES !== 'undefined' ? I18N_NAMES : null, dicts: !isReady_() && typeof I18N !== 'undefined' ? I18N : null, wds: !isReady_() && typeof I18N_WD !== 'undefined' ? I18N_WD : null }).replace(/</g, '\\u003c');
  const out = t.evaluate()
    .setTitle(known ? 'Scurrop | ' + (props_().getProperty('PROJECT_NAME') || book_().getName()) : 'Scurrop')
    // 画面の幅は、端末の幅に固定する。つまんで拡大したり、入力のときに勝手に拡大したりしないようにする
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  if (fav) out.setFaviconUrl(fav);
  return out;
}

// ---------- 読み書きの土台 ----------

/** 新しい ID。数字だけの ID は、スプレッドシートが数として読み替えてしまう（先頭の 0 が消える、など）ので、必ず文字で始める。 */
function id_() { return 'k' + Utilities.getUuid().replace(/-/g, '').slice(0, 7); }

/**
 * スプレッドシートに書く文字が、式や数・日付として読み替えられないようにする。
 * 「=」で始まる文字は式として動いてしまう（メンバーが入れたメモが、シートの中で式になる）。先頭に ' を付けると、文字のまま入る。
 * ' の扱いは実機でしか確かめられないので、最初に 1 回、試し書きで確かめる（textMode_）。
 * 式として動く始まり方（= や、+ - @ のあとに英字やかっこが続くもの）には、確かめた結果に関わらず必ず付ける。数や日付に読み替えられるだけのものは、' が効く環境でだけ付ける。
 */
/** 式として動いてしまう始まり方（= で始まる、または + - @ のあとに関数やセルの名前が続く。「-5」のようなただの数は含めない）。これだけは、' の扱いを確かめられなくても、必ず ' を付ける（付けすぎて ' が見えるほうが、式が動くよりよい）。 */
const FORMULA = /^=|^[+\-@].*[A-Za-z(]/;
const RISKY = /^[=+\-@']|^\s*[\d.,]+\s*%?\s*$|^\s*\d+[eE][+\-]?\d+\s*$|^\s*\d{1,4}[\/\-.:]\d{1,2}|^(true|false)$/i;
function cell_(v) {
  if (typeof v !== 'string' || v === '' || !RISKY.test(v)) return v;
  return FORMULA.test(v) || textMode_() === 'apos' ? "'" + v : v;
}
function textMode_() {
  let m = props_().getProperty('TEXT_MODE');
  if (!m) {
    // 確かめられなかったとき（空が返る）は、覚えない。次の機会にもう一度確かめる。それまでは ' を付ける側に倒す
    m = probeText_();
    if (m) props_().setProperty('TEXT_MODE', m);
  }
  return m || 'apos';
}
function probeText_() {
  try {
    const ss = book_();
    const sh = ss.insertSheet('_probe_' + Date.now());
    try {
      sh.getRange(1, 1).setValue("'=1+1");
      sh.appendRow(["'007"]);
      SpreadsheetApp.flush();
      const v = sh.getDataRange().getValues();
      return v[0][0] === '=1+1' && v[1][0] === '007' ? 'apos' : 'none';
    } finally {
      ss.deleteSheet(sh);
      forget_();
    }
  } catch (err) {
    return '';
  }
}

/**
 * 1 回の実行の中だけの覚え書き。設定やシートは、読みに行くたびに 0.1〜0.3 秒かかる。同じものを何度も読まないよう、
 * 一度読んだらここに置いておく。書き込んだら、そのシートの分は捨てる（forget_）。
 * ロックを取ったときは全部捨てて読み直す（その間に、ほかの人が書き換えているかもしれないため）。
 */
let MEMO = null;
function mem_() {
  if (!MEMO) MEMO = { meetLimited: false, gate: '', secret: '', fromTick: false, props: null, book: null, sheets: {}, rows: {}, head: {}, tail: {}, touched: {}, batchWhy: '', active: null, owner: null, url: null };
  return MEMO;
}
function resetMemo_() { MEMO = null; CLOCK = {}; }

/**
 * どこに時間がかかったかの記録（この 1 回の実行のなかだけ）。画面のいちばん下に出して、遅いところを探すために使う。
 * 推測で直さず、実機の数字を見てから直す。
 */
let CLOCK = {};
function clock_(label, fn) {
  const t0 = Date.now();
  try {
    return fn();
  } finally {
    const c = CLOCK[label] || (CLOCK[label] = { n: 0, ms: 0 });
    c.n++;
    c.ms += Date.now() - t0;
  }
}
/** 記録を「名前:回数:ミリ秒」の並びにする。数字だけで、中身は入らない。 */
function clockText_() {
  return Object.keys(CLOCK).map(function (k) { return k + ':' + CLOCK[k].n + ':' + CLOCK[k].ms; }).join(' ');
}
/** そのシートに書き込んだあとに呼ぶ。名前を省くと、全部のシートの分を捨てる。 */
function forget_(name) {
  const m = mem_();
  if (name) { delete m.rows[name]; delete m.head[name]; delete m.sheets[name]; delete m.tail[name]; } else { m.rows = {}; m.head = {}; m.sheets = {}; m.tail = {}; }
}

/** スクリプトのプロパティ。最初にまとめて 1 回だけ読み、あとは手元の写しを見る。書くときは写しと本物の両方に書く。 */
function props_() {
  const m = mem_();
  if (!m.props) {
    const real = PropertiesService.getScriptProperties();
    const all = clock_('props', function () { return real.getProperties(); });
    m.props = {
      getProperty: function (k) { return all[k] === undefined || all[k] === null ? null : all[k]; },
      setProperty: function (k, v) { all[k] = String(v); real.setProperty(k, String(v)); },
      deleteProperty: function (k) { delete all[k]; real.deleteProperty(k); }
    };
  }
  return m.props;
}
function activeEmail_() {
  const m = mem_();
  if (m.active === null) m.active = clock_('user', function () { return String(Session.getActiveUser().getEmail() || ''); });
  return m.active;
}
function ownerEmail_() {
  const m = mem_();
  if (m.owner === null) m.owner = clock_('user', function () { return String(Session.getEffectiveUser().getEmail() || ''); });
  return m.owner;
}

function book_() {
  const m = mem_();
  if (!m.book) {
    const id = props_().getProperty('SHEET_ID');
    if (!id) throw new Error('初期設定が未完了です。Apps Script のエディタで setup を実行してください。');
    m.book = clock_('open', function () { return SpreadsheetApp.openById(id); });
  }
  return m.book;
}
function sheet_(name) {
  const m = mem_();
  // ここを通ったシートは、この実行のなかで書き換えているかもしれない。まとめ読み（preload_）の対象から外す
  m.touched[name] = true;
  delete m.tail[name];
  if (m.sheets[name] === undefined) { const b = book_(); m.sheets[name] = clock_('sheet', function () { return b.getSheetByName(name) || null; }); }
  return m.sheets[name];
}
/** シートの見出し（1 行目）。 */
function head_(name) {
  const m = mem_();
  if (!m.head[name]) {
    const sh = sheet_(name);
    m.head[name] = clock_('read', function () { const cols = sh.getLastColumn(); return cols ? sh.getRange(1, 1, 1, cols).getValues()[0] : []; });
  }
  return m.head[name];
}

function read_(name) {
  const m = mem_();
  if (!m.rows[name]) {
    const sh = sheet_(name);
    if (!sh) throw new Error('シート ' + name + ' がありません。setup を実行してください。');
    const values = clock_('read', function () { return sh.getDataRange().getValues(); });
    const head = values[0] || [];
    m.head[name] = head;
    const out = [];
    for (let r = 1; r < values.length; r++) {
      const o = { _row: r + 1 };
      for (let c = 0; c < head.length; c++) o[head[c]] = values[r][c];
      out.push(o);
    }
    m.rows[name] = out;
  }
  return m.rows[name].slice();
}

/** シートの最後の max 行だけを読む（履歴のように、増え続けるシートを毎回ぜんぶ読まないため）。 */
function readTail_(name, max) {
  const kept = mem_().tail[name];
  if (kept) return kept.slice(-max);
  const sh = sheet_(name);
  if (!sh) return [];
  const last = clock_('read', function () { return sh.getLastRow(); });
  if (last < 2) return [];
  const head = head_(name);
  const from = Math.max(2, last - max + 1);
  const values = clock_('read', function () { return sh.getRange(from, 1, last - from + 1, head.length).getValues(); });
  return values.map(function (row, i) {
    const o = { _row: from + i };
    for (let c = 0; c < head.length; c++) o[head[c]] = row[c];
    return o;
  });
}

/** 1 行を消す。 */
function deleteRow_(name, row) {
  sheet_(name).deleteRow(row);
  forget_(name);
}

/** シートがまだ無い場合は空を返す（古い版から更新した直後のため）。 */
function readOpt_(name) {
  if (mem_().rows[name]) return read_(name);
  return sheet_(name) ? read_(name) : [];
}

const HISTORY_TAIL = 600;
/** 列の番号（1 始まり）を A, B, …, AA の形にする。 */
function colName_(n) {
  let out = '';
  while (n > 0) { out = String.fromCharCode(65 + (n - 1) % 26) + out; n = Math.floor((n - 1) / 26); }
  return out;
}
/** 値の並び（1 行目が見出し）を、read_ と同じ形の行にする。行の終わりの空欄は省かれて届くので、補う。 */
function rowsOf_(head, values, firstRow) {
  return values.map(function (row, i) {
    const o = { _row: firstRow + i };
    for (let c = 0; c < head.length; c++) o[head[c]] = row[c] === undefined || row[c] === null ? '' : row[c];
    return o;
  });
}

/**
 * シートをまとめて 1 回の呼び出しで読み、覚え書きに置く。
 * 2026-11-14 の実機の計測: シートを 1 枚読むのに約 0.33 秒かかり、9〜10 回で 3 秒を超えていた（処理 3.3〜4.2 秒のほとんど）。
 * Sheets のサービスなら、何枚でも 1 回で済む。使えないとき・失敗したときは、これまでどおり 1 枚ずつ読む（動きは同じ、遅いだけ）。
 * この実行のなかで触った（書き換えたかもしれない）シートは対象にしない。書いた直後の読み直しは、これまでの読み方で確実に読む。
 * 履歴は増え続けるので、最後の数百行だけを読む。何行目から読むかは、覚えておいた行数（HIST_N）から決める。
 * 行数が実際とずれていても、読む範囲の始まりが少しずれるだけで、読んだ結果から直す。
 */
function preload_(names) {
  const m = mem_();
  const p = props_();
  const id = p.getProperty('SHEET_ID');
  if (!id || typeof Sheets === 'undefined') { if (id) m.batchWhy = 'Sheets  サービスが有効になっていません'; return false; }
  const want = names.filter(function (n) { return !m.touched[n] && !(n === 'history' ? m.tail[n] : m.rows[n]); });
  if (!want.length) return true;
  const ranges = [];
  const plan = [];
  const stored = Number(p.getProperty('HIST_N')) || 0;
  const from = Math.max(2, stored - HISTORY_TAIL + 1);
  want.forEach(function (n) {
    if (n === 'history') {
      const end = colName_(SHEETS.history.length);
      ranges.push('history!A1:' + end + '1'); plan.push('head');
      ranges.push('history!A' + from + ':' + end); plan.push('tail');
    } else {
      ranges.push(n); plan.push(n);
    }
  });
  let got = null;
  try {
    got = clock_('batch', function () {
      return Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', majorDimension: 'ROWS' });
    }).valueRanges;
    if (!got || got.length !== ranges.length) throw new Error('取得件数が一致しません');
  } catch (err) {
    m.batchWhy = String(err && err.message ? err.message : err).slice(0, 200);
    // 覚えていた行数が大きすぎて範囲がシートの外に出た、ということもある。次は数え直す
    if (stored && want.indexOf('history') >= 0) { try { p.deleteProperty('HIST_N'); } catch (e2) { /* 次の回に任せる */ } }
    return false;
  }
  let hhead = null;
  plan.forEach(function (what, i) {
    const values = got[i].values || [];
    if (what === 'head') { hhead = values[0] || []; return; }
    if (what === 'tail') {
      if (!values.length && from > 2) {
        // 覚えていた行数より、実際の行が少ない（手で消した、など）。今回はこれまでの読み方に任せ、次は数え直す
        try { p.deleteProperty('HIST_N'); } catch (e3) { /* 次の回に任せる */ }
        return;
      }
      m.head.history = hhead || [];
      m.tail.history = rowsOf_(m.head.history, values, from);
      const last = from + values.length - 1;
      if (last !== stored && (!stored || Math.abs(last - stored) >= 100)) { try { p.setProperty('HIST_N', String(last)); } catch (e4) { /* 次の回に任せる */ } }
      return;
    }
    const head = values[0] || [];
    m.head[what] = head;
    m.rows[what] = rowsOf_(head, values.slice(1), 2);
  });
  return true;
}
/** この実行のなかでは、まとめ読みを使わない（シートや列を作り直したあとなど）。 */
function touchAll_() { const m = mem_(); Object.keys(SHEETS).forEach(function (n) { m.touched[n] = true; }); m.tail = {}; }
const STATE_SHEETS = ['members', 'boards', 'templates', 'tasks', 'links', 'shifts', 'rules', 'history', 'task_photos'];

/** 1行のうち、名前で指定した列だけを書き換える。列の位置はシートの見出しから探す。 */
function setCells_(name, row, values) {
  const sh = sheet_(name);
  const head = head_(name);
  Object.keys(values).forEach(function (col) {
    const c = head.indexOf(col);
    if (c < 0) throw new Error('シート ' + name + ' に列 ' + col + ' がありません。');
    sh.getRange(row, c + 1).setValue(cell_(values[col]));
  });
  delete mem_().rows[name];
  if (name === 'members') membersChanged_();
}

/** 見出しの順に合わせて1行を足す。 */
function appendObj_(name, obj) {
  const sh = sheet_(name);
  const head = head_(name);
  const line = head.map(function (col) { return obj[col] === undefined ? '' : cell_(obj[col]); });
  clock_('write', function () { sh.appendRow(line); });
  delete mem_().rows[name];
  if (name === 'members') membersChanged_();
}

/** 見出しの順に合わせて、何行かをまとめて足す（1 回の書き込み）。 */
function appendObjs_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const head = head_(name);
  const lines = objs.map(function (obj) { return head.map(function (col) { return obj[col] === undefined ? '' : cell_(obj[col]); }); });
  clock_('write', function () { sh.getRange(sh.getLastRow() + 1, 1, lines.length, head.length).setValues(lines); });
  delete mem_().rows[name];
}

/** このプロジェクトのタイムゾーン（Apps Script のプロジェクトの設定）。画面は、見ている端末の時刻ではなく、これで日付と時刻を出す。 */
function tz_() { try { return String(Session.getScriptTimeZone() || ''); } catch (err) { return ''; } }

function hm_(ms) {
  return Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'H:mm');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  clock_('lock', function () { lock.waitLock(10000); });
  // ロックを待つあいだに、ほかの人が書き換えているかもしれない。覚え書きを捨てて、ここから読み直す
  const m = mem_();
  m.props = null; m.book = null; m.secret = '';
  forget_();
  try {
    return fn();
  } finally {
    clock_('write', function () { SpreadsheetApp.flush(); });
    lock.releaseLock();
  }
}

function isOn_(v) { return v === true || String(v).toLowerCase() === 'true'; }
function isActive_(m) { return m.email && m.active !== false && String(m.active).toLowerCase() !== 'false'; }

/** 参加済みのメンバーか（招待中は含めない）。 */
function isJoined_(m) { return isActive_(m) && String(m.status || '') !== 'invited'; }

/**
 * 「組織の外の人」か。この Web アプリは、公開した人と同じ組織の人についてだけ、開いた人のメールアドレスが分かる。
 * それ以外の人（別の組織、個人の Gmail）は、招待のメールに入れたリンクの鍵で見分ける。
 */
// だれでも取れるメールのドメイン。ここのアドレスは、同じドメインでも「同じ組織」ではない（Google Workspace にはできない）。
// 公開した人が Gmail 以外のアドレスで Google アカウントを作っている場合（yahoo.co.jp など）に、同じドメインの人を組織の中と見誤らないため
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.co.jp', 'yahoo.com', 'ymail.com', 'outlook.com', 'outlook.jp', 'hotmail.com', 'hotmail.co.jp', 'live.com', 'live.jp', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'docomo.ne.jp', 'ezweb.ne.jp', 'au.com', 'softbank.ne.jp', 'i.softbank.jp', 'nifty.com', 'qq.com', '163.com', 'naver.com'];
function outside_(email) {
  const owner = String(ownerEmail_() || '').toLowerCase();
  const mail = String(email || '').toLowerCase();
  if (mail === owner) return false;
  const org = owner.split('@')[1] || '';
  return !org || mail.split('@')[1] !== org || FREE_MAIL.indexOf(org) >= 0;
}

/** リンクの鍵を作るための秘密。スクリプトのプロパティにだけ置く（スプレッドシートには書かない）。 */
function secret_() {
  const m = mem_();
  if (m.secret) return m.secret;
  let v = props_().getProperty('KEY_SECRET');
  // 手元の写しは、この実行の初めに読んだもの。そのあとに、ほかの実行が作っているかもしれないので、作る前に本物を見る
  // （2 つの実行が別々の秘密を作ると、先に送った招待のリンクが使えなくなる）
  if (!v) { try { v = PropertiesService.getScriptProperties().getProperty('KEY_SECRET') || ''; } catch (err) { v = ''; } }
  if (!v) {
    v = Utilities.getUuid() + Utilities.getUuid();
    props_().setProperty('KEY_SECRET', v);
  }
  return (m.secret = v);
}

/** メンバーの鍵。シートにある key_nonce と、プロパティの秘密から作る。シートを見られる人でも、秘密がなければ鍵は作れない。 */
function keyOf_(m) {
  const nonce = String(m.key_nonce || '');
  if (!nonce) return '';
  const mac = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(m.email).toLowerCase() + '|' + nonce, secret_()));
  return nonce + '.' + mac.replace(/=+$/, '').slice(0, 32);
}

/** 鍵からメンバーを探す。鍵が使えるのは、組織の外の人だけ（組織の中の人は、アカウントで見分ける）。 */
function memberByKey_(rows, key) {
  const k = String(key || '');
  const nonce = k.split('.')[0];
  if (!nonce || k.split('.').length !== 2) return null;
  const m = rows.filter(function (x) { return isActive_(x) && String(x.key_nonce || '') === nonce; })[0];
  if (!m || keyOf_(m) !== k || !outside_(m.email)) return null;
  return m;
}

/**
 * いま操作している人。まず Google アカウント（同じ組織の人）で探し、見つからなければリンクの鍵で探す。
 * role: admin / member / invited（招待中）/ guest（登録なし）。via: account / key
 */
const NO_ACCOUNT = 'アカウントを確認できません。招待メールのリンクからアクセスしてください。';
/** 鍵の形（番号.しるし）。形が違うものは、シートを読む前に断る。 */
const KEY_RE = /^[A-Za-z0-9]{4,40}\.[A-Za-z0-9_-]{32}$/;
/** 鍵の番号の一覧を覚えておく長さ（秒）。シートを手で直したときは、この時間のうちに追いつく。 */
const NONCES_TTL = 600;

/**
 * いま使える鍵の番号（key_nonce）の一覧。「,番号,番号,」の形で、短いあいだ覚えておく。
 * 覚えていなければ、メンバーのシートを 1 回読んで作る。メンバーのシートに書いたときは、捨てて作り直す（membersChanged_）。
 */
function nonces_() {
  const c = CacheService.getScriptCache();
  let v = c.get('nonces');
  if (!v) {
    v = ',' + read_('members').filter(function (x) { return isActive_(x) && x.key_nonce; }).map(function (x) { return String(x.key_nonce); }).join(',') + ',';
    c.put('nonces', v, NONCES_TTL);
  }
  return v;
}
/** メンバーのシートに書いたあとに呼ぶ。覚えていた鍵の番号の一覧を捨てる（次に鍵で来た人のときに、作り直す）。 */
function membersChanged_() {
  try { CacheService.getScriptCache().remove('nonces'); } catch (err) { /* 捨てられなくても、NONCES_TTL で作り直される */ }
}

/**
 * 入口の見張り。Web アプリの URL は、知っていれば誰でも開ける。だれか分からない人のために、シートを読まない。
 * - Google アカウントで来た人（同じ組織）は、これまでどおり
 * - アカウントも鍵もない人、鍵の形が違う人は、何も読まずに断る
 * - 鍵の番号が、覚えている一覧にない人も、何も読まずに断る。でたらめな鍵を何度送られても、シートは読まないし、
 *   本物の鍵を持っている人が締め出されることもない（前の版は、知らない鍵の回数を全員まとめて数えていたので、
 *   でたらめな鍵を送り続けるだけで、ほかの人が入れなくなった）
 * - 覚えておく場所が使えないときは、これまでどおり、シートを読んで確かめる
 */
function gate_(key) {
  if (activeEmail_()) return;
  const k = String(key || '');
  if (!k || !KEY_RE.test(k)) throw new Error(NO_ACCOUNT);
  const m = mem_();
  if (m.gate === k) return; // この実行のなかで、もう確かめた
  let list = null;
  try { list = nonces_(); } catch (err) { list = null; }
  if (list !== null && list.indexOf(',' + k.split('.')[0] + ',') < 0) throw new Error(NO_ACCOUNT);
  m.gate = k;
}

function me_(key) {
  const email = String(activeEmail_() || '');
  gate_(key);
  const rows = read_('members');
  let m = email ? rows.filter(function (x) { return String(x.email).toLowerCase() === email.toLowerCase() && isActive_(x); })[0] : null;
  let via = 'account';
  if (!m && key) {
    m = memberByKey_(rows, text_(key, 80));
    if (m) via = 'key';
  }
  if (!m && !email) throw new Error(NO_ACCOUNT);
  if (!m) return { email: email, name: email.split('@')[0], role: 'guest', via: 'account', board: '' };
  return { email: String(m.email), name: String(m.name), role: String(m.status || '') === 'invited' ? 'invited' : String(m.role), via: via, board: String(m.board || '') };
}

/**
 * 組織の外の人に渡す URL。Workspace の Web アプリの URL は「/a/macros/組織のドメイン/s/…」の形で、
 * その組織のアカウントでないと「ファイルを開くことができません」になる（2026-11-14 実機で確認）。
 * 外の人には、組織の名前が入らない「/macros/s/…」の形で渡す。
 */
function outsideUrl_() {
  return url_().replace(/\/a\/macros\/[^\/]+\//, '/macros/');
}

/** そのメンバーに送るタスクのリンク。組織の外の人には、本人の鍵を付ける。 */
function linkFor_(taskId, email) {
  const url = url_();
  if (!url) return '';
  let k = '';
  if (email && outside_(email)) {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === String(email).toLowerCase() && isActive_(x); })[0];
    k = m ? keyOf_(m) : '';
  }
  return (k ? outsideUrl_() : url) + '?task=' + taskId + (k ? '&k=' + k : '');
}

/** 管理者として操作できる人か（Google アカウントで見分けられた管理者）。 */
function isAdmin_(me) { return me.role === 'admin' && me.via === 'account'; }
/** 参加しているメンバーか（登録のない人・招待中の人・外した人は含めない）。 */
function isMember_(me) { return me.role === 'member' || me.role === 'admin'; }

function requireAdmin_(me) {
  // 管理者は、Google アカウントで見分けられた人だけ（リンクの鍵では管理者になれない）
  if (me.role !== 'admin' || me.via !== 'account') throw new Error('この操作は管理者のみ実行できます。');
}

function text_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

// ---------- URL のシートと、シートの並び ----------
const URL_SHEET = 'URL';
const GUIDE_SHEETS = ['Install', '導入手順'];   // 雛形に入っている導入手順のシート。あれば、URL のシートの次に並べる
const TAB_COLORS = { url: '#1E8E3E', guide: '#2279B6', data: '#9AA0A6' };
const URL_NOTES = ['URLの確認方法: Apps Scriptの「デプロイ」→「デプロイを管理」で、ウェブアプリのURLをコピーできます。',
  'デプロイしたアカウントでウェブアプリを開くと、このシートのURLが最新のものに更新されます。',
  '「新しいデプロイ」を行うと、URLが変わります。コードを更新する場合は、「デプロイを管理」で既存のデプロイを編集してください。'];

/** この Web アプリの、ほかの人に渡せる URL（…/exec）。エディタから動かしたときの確認用の URL（…/dev）は渡せないので、空にする。 */
function execUrl_() { const u = String(url_() || ''); return /\/exec$/.test(u) ? u : ''; }

/** これまでに書いた URL（新しい順）。 */
function urlList_() {
  try { const v = JSON.parse(props_().getProperty('URL_LIST') || '[]'); return Array.isArray(v) ? v : []; } catch (err) { return []; }
}

/**
 * Web アプリの URL を、スプレッドシートのいちばん左のシート「URL」に書く。
 * デプロイの画面を閉じたあとで URL が分からなくなっても、スプレッドシートを開けば分かるようにする。
 * デプロイを増やすと URL も増えるので、いちばん新しく開いたものを上に、前のものを下に残す。
 * 言語を決める前（権限の承認のとき）は、英語と日本語を並べて書く。u が空なら、確認方法だけを書く。
 */
function noteUrl_(u) {
  let ss = null;
  try { ss = isReady_() ? book_() : SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
  if (!ss) return;
  let list = urlList_();
  if (u && !(list.length && list[0].u === u)) {
    list = [{ u: u, t: Date.now() }].concat(list.filter(function (x) { return x.u !== u; })).slice(0, 6);
    props_().setProperty('URL_LIST', JSON.stringify(list));
  }
  const ready = isReady_();
  const en = typeof I18N !== 'undefined' && I18N.en ? I18N.en : {};
  const lines = function (ja) { return ready ? [T_(ja)] : [en[ja] || ja, ja]; };
  const label = function (ja) { return ready ? T_(ja) : (en[ja] ? en[ja] + ' / ' : '') + ja; };
  const when = function (t) { return Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); };
  const rows = [['Scurrop', '']];
  rows.push([label('ウェブアプリのURL'), list.length ? list[0].u : lines('（ウェブアプリを開くと、ここに記録されます）').join(' / ')]);
  if (list.length) rows.push([label('記録日時'), when(list[0].t)]);
  rows.push(['', '']);
  URL_NOTES.forEach(function (n) { lines(n).forEach(function (line) { rows.push([line, '']); }); });
  if (list.length > 1) {
    rows.push(['', '']);
    rows.push([label('以前のURL'), '']);
    list.slice(1).forEach(function (x) { rows.push([when(x.t), x.u]); });
  }
  const sh = ss.getSheetByName(URL_SHEET) || ss.insertSheet(URL_SHEET);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  try {
    sh.getRange(1, 1, 1, 1).setFontWeight('bold');
    sh.getRange(2, 1, 1, 2).setFontWeight('bold');
    sh.setColumnWidth(1, 240); sh.setColumnWidth(2, 640);
  } catch (err) { /* 見た目を整えられなくても、URL は書けている */ }
  arrangeSheets_(ss);
}

/** シートの並びと、タブの色。左から、URL（緑）、導入手順（青）、データのシート（灰色）。 */
function arrangeSheets_(ss) {
  const order = function () { return ss.getSheets().map(function (s) { return s.getName(); }); };
  let pos = 1;
  [URL_SHEET].concat(GUIDE_SHEETS).forEach(function (name, i) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    try { sh.setTabColor(i === 0 ? TAB_COLORS.url : TAB_COLORS.guide); } catch (err) { /* 色を付けられなくても続ける */ }
    try { if (order().indexOf(name) + 1 !== pos) { ss.setActiveSheet(sh); ss.moveActiveSheet(pos); } } catch (err) { /* 並べ替えられなくても続ける */ }
    pos++;
  });
  Object.keys(SHEETS).forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh) { try { sh.setTabColor(TAB_COLORS.data); } catch (err) { /* 色を付けられなくても続ける */ } }
  });
}

function url_() {
  const m = mem_();
  if (m.url === null) {
    // 見張り（時間で動く実行）のなかでは、この Web アプリの URL を正しく取れるとは限らない。ページを開いたときに覚えておいた URL を使う
    const kept = m.fromTick ? String(props_().getProperty('APP_URL') || '') : '';
    m.url = kept || clock_('url', function () { try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; } });
  }
  return m.url;
}

function logHistory_(email, taskId, action, note, geo) {
  const now = new Date();
  delete mem_().rows.history;
  sheet_('history').appendRow([
    now.getTime(), now, cell_(email), cell_(taskId), action, cell_(text_(note, 500)),
    geo && typeof geo.lat === 'number' && isFinite(geo.lat) ? geo.lat : '',
    geo && typeof geo.lng === 'number' && isFinite(geo.lng) ? geo.lng : '',
    geo && typeof geo.acc === 'number' && isFinite(geo.acc) ? Math.round(geo.acc) : ''
  ]);
}

function parseJson_(v, fallback) {
  try {
    const o = JSON.parse(String(v || ''));
    return o == null ? fallback : o;
  } catch (err) {
    return fallback;
  }
}

function pubTemplate_(t) {
  const fields = parseJson_(t.fields, []);
  return {
    id: String(t.id), name: String(t.name), board: String(t.board || ''), minutes: Number(t.minutes) || 60,
    geo: isOn_(t.geo), meet: isOn_(t.meet),
    fields: (Array.isArray(fields) ? fields : []).map(function (f) {
      // フィールドは、メンバーが完了を報告するときに入れるもの。前の版の「管理者が入れる」指定は読み替える
      const o = {}; Object.keys(f).forEach(function (k) { o[k] = f[k]; }); o.by = 'member'; return o;
    })
  };
}

/** テンプレートを id で引ける形にする。消した（無効にした）ものも含む。古いタスクの表示に要るため。 */
function templateMap_() {
  const map = {};
  readOpt_('templates').forEach(function (t) { if (t.id) map[String(t.id)] = pubTemplate_(t); });
  return map;
}

/**
 * フィールドの値を、種類に合わせて確かめて整える。
 * by: 'admin'（タスクを作るときに入れる）か 'member'（完了のときに入れる）。strict が true なら必須を確かめる。
 */
function cleanValues_(fields, raw, by, strict) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  fields.forEach(function (f) {
    if (f.by !== by) return;
    if (f.type === 'photo') return; // 写真は、値ではなく task_photos に入る（必須の確かめは、完了のときに別にやる）
    let v = src[f.key];
    let val = '';
    if (f.type === 'number') {
      if (v !== '' && v != null) {
        const n = Number(v);
        if (!isFinite(n)) throw new Error('「' + f.label + '」は数値で入力してください。');
        val = n;
      }
    } else if (f.type === 'select') {
      v = text_(v, 60);
      if (v && (f.options || []).indexOf(v) < 0) throw new Error('「' + f.label + '」の選択が正しくありません。');
      val = v;
    } else if (f.type === 'multi') {
      const arr = (Array.isArray(v) ? v : []).map(function (x) { return text_(x, 60); }).filter(String);
      if (arr.some(function (x) { return (f.options || []).indexOf(x) < 0; })) throw new Error('「' + f.label + '」の選択が正しくありません。');
      val = arr;
    } else if (f.type === 'date') {
      v = text_(v, 10);
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('「' + f.label + '」の日付が正しくありません。');
      val = v;
    } else if (f.type === 'time') {
      v = text_(v, 5);
      if (v && !/^\d{1,2}:\d{2}$/.test(v)) throw new Error('「' + f.label + '」の時刻が正しくありません。');
      val = v;
    } else {
      val = text_(v, f.type === 'long' ? 1000 : 200);
    }
    const empty = val === '' || (Array.isArray(val) && !val.length);
    if (strict && f.required && empty) throw new Error('「' + f.label + '」を入力してください。');
    if (!empty) out[f.key] = val;
  });
  return out;
}

/** タスクを作るときに管理者が書くメモ。改行は残す。 */
function memo_(v) {
  return String(v == null ? '' : v).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 500);
}
/** 前の版では「場所」だった。古い行はその値をメモとして読む。 */
function memoOf_(t) { return String(t.memo || t.place || ''); }

function pubTask_(t, tpls) {
  const tpl = t.template_id && tpls ? tpls[String(t.template_id)] : null;
  return {
    fields: tpl ? tpl.fields : [], values: parseJson_(t.values, {}),
    id: String(t.id), title: String(t.title), member: String(t.member_email || ''),
    start: Number(t.start_ms), end: Number(t.end_ms), memo: memoOf_(t), address: String(t.address || ''),
    status: String(t.status), started: Number(t.started_ms) || 0, done: Number(t.done_ms) || 0,
    hasEvent: !!t.event_id && String(t.event_id) !== EVENT_WAIT, eventWait: String(t.event_id) === EVENT_WAIT, series: String(t.series || ''), note: String(t.note || ''), geo: isOn_(t.geo), meet: wantsMeet_(t), meetUrl: meetUrl_(t),
    templateId: tpl ? String(t.template_id) : '', template: tpl ? String(tpl.name || '') : ''
  };
}

/** 履歴の 1 行から、記録された場所を取り出す。なければ null。数でないものは場所として扱わない。 */
function geoOf_(h) {
  if (h.lat === '' || h.lng === '' || h.lat === undefined || h.lng === undefined) return null;
  const lat = Number(h.lat), lng = Number(h.lng), acc = Number(h.accuracy_m);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: lat, lng: lng, acc: isFinite(acc) && acc > 0 ? Math.round(acc) : 0 };
}

/** その日の 0 時から 24 時まで。day は 'YYYY-MM-DD'。なければ今日。 */
function dayRange_(day) {
  const d = new Date();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (m) d.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  // 次の日の 0 時。24 時間を足すのではなく、日付を 1 つ進める（夏時間の切り替えの日は、1 日が 23 時間や 25 時間になる）
  return [d.getTime(), new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()];
}

function findTask_(id) {
  return read_('tasks').filter(function (x) { return String(x.id) === id; })[0];
}

// ---------- 画面から呼ぶもの ----------

/** その日（なければ今日）の状態をまとめて返す。画面は15秒おきにこれを呼ぶ。 */
function getState(opts) {
  const t0 = Date.now();
  if (!isReady_()) {
    // まだ始まっていない: 初回ページを出すための最小限だけ返す
    return { setup: true, canSetup: canSetup_(), nameMax: NAME_MAX, me: { email: String(activeEmail_() || ''), role: 'guest' }, now: Date.now(), tookMs: 0 };
  }
  gate_(opts && opts.key); // だれか分からない人のためには、ここから先（シートの読み込み）に進まない
  if (props_().getProperty('SCHEMA') !== SCHEMA) withLock_(ensureSheets_);
  preload_(STATE_SHEETS);
  const me = me_(opts && opts.key);
  const admin = me.role === 'admin' && me.via === 'account';
  const day = dayRange_(opts && opts.day);
  if (me.role === 'guest' || me.role === 'invited') {
    // 登録されていない人: 「登録されていません」を出すのに要るものだけ返す（ボード名もプロジェクト名も返さない）
    return {
      // 招待中の人には、参加するかを決めるのに要るもの（プロジェクト名と、入る予定のボード）だけ足す
      me: me, invite: me.role === 'invited' ? { project: props_().getProperty('PROJECT_NAME') || book_().getName(), board: me.board } : null,
      project: { name: '', iconRev: '', hours: [8, 18], mode: me.role === 'invited' ? mode_() : 'light' }, nameMax: NAME_MAX, canSetup: false, members: [], boards: [], templates: [], tasks: [], links: [],
      shifts: [], shiftUsers: [], week: null, rules: [], history: [], url: '', dayStart: day[0], dayEnd: day[1], tz: tz_(), today: true, now: Date.now(), tookMs: Date.now() - t0, clock: clockText_()
    };
  }
  const today = dayRange_()[0] === day[0];
  let allTasks = read_('tasks');
  if (admin && fireLate_(allTasks)) allTasks = read_('tasks');
  if (admin && fillEvents_(allTasks)) allTasks = read_('tasks');
  if (admin && fillMeet_(allTasks.filter(function (t) { return t.id && Number(t.end_ms) >= day[0] && Number(t.start_ms) < day[1]; }))) allTasks = read_('tasks');
  const memberRows = read_('members');
  let members = memberRows.filter(isJoined_)
    .map(function (m) { return { email: String(m.email), name: String(m.name), role: String(m.role), board: String(m.board || ''), photoRev: String(m.photo_rev || ''), outside: outside_(m.email), link: admin && outside_(m.email) ? inviteLink_(m) : '' }; });
  const invited = admin ? memberRows.filter(function (m) { return isActive_(m) && !isJoined_(m); })
    .map(function (m) { return { email: String(m.email), name: String(m.name), board: String(m.board || ''), invitedMs: Number(m.invited_ms) || 0, outside: outside_(m.email), error: String(m.invite_error || ''), link: inviteLink_(m) }; }) : [];
  let tasks = allTasks.filter(function (t) { return t.id && Number(t.end_ms) >= day[0] && Number(t.start_ms) < day[1]; });
  let shiftRows = readOpt_('shifts').filter(function (x) { return x.id; });
  if (!admin) {
    tasks = tasks.filter(function (t) { return t.member_email === me.email; });
    shiftRows = shiftRows.filter(function (x) { return String(x.member_email) === me.email; });
    members = members.filter(function (m) { return m.email === me.email; });
  }
  // 週・月の表示: その日を含む週（月曜から 7 日）か、その月（1 日から月末）
  const span = opts && opts.span === 'month' ? 'month' : (opts && (opts.week || opts.span === 'week')) ? 'week' : '';
  let first = new Date(day[0]);
  let count = 7;
  if (span === 'month') {
    count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first = new Date(first.getFullYear(), first.getMonth(), 1);
  } else if (span) {
    first.setDate(first.getDate() - (first.getDay() + 6) % 7);
  }
  // タスクの一覧を週・月で見るとき（管理者）: その期間のタスクを、報告の中身ごと渡す
  let list = null;
  if (admin && span && opts && opts.list) {
    const r0 = first.getTime(), r1 = new Date(first.getFullYear(), first.getMonth(), first.getDate() + count).getTime();
    list = allTasks.filter(function (t) { return t.id && Number(t.end_ms) >= r0 && Number(t.start_ms) < r1; });
  }
  const ids = {};
  tasks.forEach(function (t) { ids[t.id] = true; });
  if (list) list.forEach(function (t) { ids[t.id] = true; });
  const photoCount = {};
  readOpt_('task_photos').forEach(function (ph) { if (ph.id && ids[ph.task_id]) photoCount[String(ph.task_id)] = (photoCount[String(ph.task_id)] || 0) + 1; });
  const tail = readTail_('history', 600);
  // 管理者には、報告された場所（開始・完了のとき）を渡す。メンバーには「位置あり」とだけ渡す（これまでどおり）
  const spots = {};
  if (admin) {
    tail.forEach(function (h) {
      const a = String(h.action);
      if (!ids[h.task_id] || (a !== 'start' && a !== 'done')) return;
      const k = String(h.task_id);
      (spots[k] || (spots[k] = {}))[a] = { time: Number(h.time_ms), geo: geoOf_(h), miss: /位置: 取得(できず|失敗)/.test(String(h.note || '')) };
    });
  }
  const history = tail
    .filter(function (h) { return ids[h.task_id] || (admin && Number(h.time_ms) >= day[0] && Number(h.time_ms) < day[1]); })
    .slice(-60).reverse()
    .map(function (h) {
      return {
        time: Number(h.time_ms), email: String(h.email), task: String(h.task_id), action: String(h.action),
        note: String(h.note || ''), hasGeo: h.lat !== '' && h.lng !== '', geo: admin ? geoOf_(h) : null
      };
    });
  const boards = readOpt_('boards').filter(function (b) { return b.name; })
    .sort(function (a, b) { return Number(a.order) - Number(b.order); })
    .map(function (b) { return { name: String(b.name), color: String(b.color || boardColor_(0)) }; });
  // 日ごとのタスクとシフトの要約
  let week = null;
  if (span) {
    week = [];
    for (let i = 0; i < count; i++) {
      const a = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i).getTime();
      const b = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i + 1).getTime();
      week.push({
        dayStart: a,
        tasks: allTasks.filter(function (t) { return t.id && Number(t.end_ms) >= a && Number(t.start_ms) < b && (admin || t.member_email === me.email); })
          .map(function (t) { return { id: String(t.id), title: String(t.title), member: String(t.member_email || ''), start: Number(t.start_ms), end: Number(t.end_ms), status: String(t.status) }; }),
        shifts: shiftsOn_(a, shiftRows)
      });
    }
  }
  const tpls = templateMap_();
  const pub = function (t) { const x = pubTask_(t, tpls); x.spots = admin ? (spots[x.id] || null) : null; x.photos = photoCount[x.id] || 0; return x; };
  const templates = admin ? readOpt_('templates').filter(function (t) { return t.id && t.active !== false && String(t.active).toLowerCase() !== 'false'; }).map(pubTemplate_) : [];
  const rules = admin ? readOpt_('rules').filter(function (r) { return r.id; }).map(function (r) {
    return { id: String(r.id), when: String(r.when), then: String(r.then).split(',').map(function (s) { return s.trim(); }).filter(String), enabled: isOn_(r.enabled) };
  }) : [];
  return {
    me: me, project: { name: props_().getProperty('PROJECT_NAME') || book_().getName(), iconRev: props_().getProperty('PROJECT_ICON_REV') || '', hours: hours_(), mode: mode_() }, version: admin ? VERSION : '', folderUrl: admin ? folderUrl_() : '', repoUrl: admin ? REPO_URL : '', favicon: admin ? { code: faviconCode_(), base: EMOJI_BASE } : null, sheetUrl: admin ? sheetUrl_() : '', defaults: { geo: props_().getProperty('DEFAULT_GEO') === 'true', meet: props_().getProperty('DEFAULT_MEET') === 'true', invite: admin && inviteOn_() }, nameMax: NAME_MAX, canSetup: admin && canSetup_(),
    members: members, invited: invited, boards: boards, templates: templates,
    tasks: tasks.map(pub), list: list ? list.map(pub) : null, links: linksFor_(ids, allTasks),
    shifts: shiftsOn_(day[0], shiftRows), shiftUsers: shiftUsers_(shiftRows), week: week, span: span,
    textMode: admin ? (props_().getProperty('TEXT_MODE') || '') : '', mailLeft: admin && props_().getProperty('MAIL_VIA') !== 'gmail' ? mailLeft_() : -1, mailVia: admin ? (props_().getProperty('MAIL_VIA') || '') : '', readWhy: admin ? mem_().batchWhy : '', tick: admin ? tickState_() : null, mailWhy: admin ? (props_().getProperty('MAIL_WHY') || '') : '',
    rules: rules, history: history, url: url_(), dayStart: day[0], dayEnd: day[1], tz: tz_(), today: today, now: Date.now(), tookMs: Date.now() - t0, clock: clockText_()
  };
}

/** 見えているタスクに触れるリンクを返す。相手のタスクは要約だけを付ける（メンバーには相手のタスクが見えないため）。 */
function linksFor_(ids, allTasks) {
  const rows = readOpt_('links').filter(function (l) { return l.id && (ids[l.a_task] || ids[l.b_task]); });
  if (!rows.length) return [];
  const byId = {};
  allTasks.forEach(function (t) { byId[t.id] = t; });
  const names = {};
  const boards = {};
  read_('members').forEach(function (m) { names[String(m.email)] = String(m.name); boards[String(m.email)] = String(m.board || ''); });
  const info = function (t) {
    return {
      id: String(t.id), title: String(t.title), start: Number(t.start_ms), end: Number(t.end_ms),
      status: String(t.status), member: t.member_email ? (names[t.member_email] || String(t.member_email)) : '未割り当て',
      board: t.member_email ? (boards[t.member_email] || '') : ''
    };
  };
  return rows.filter(function (l) { return byId[l.a_task] && byId[l.b_task]; }).map(function (l) {
    return { id: String(l.id), a: String(l.a_task), b: String(l.b_task), kind: String(l.kind || ''), aInfo: info(byId[l.a_task]), bInfo: info(byId[l.b_task]) };
  });
}

/** プロジェクト名を変える（管理者）。 */
function setProject(input) {
  const me = me_();
  requireAdmin_(me);
  const name = projectName_(input && input.name);
  const icon = image_(input && input.icon, ICON_MAX, 'アイコン');
  const hours = input && input.hours;
  if (hours !== undefined) {
    const a = Number(hours && hours[0]), b = Number(hours && hours[1]);
    if (!(a === Math.floor(a) && b === Math.floor(b) && a >= 0 && b <= 24 && b > a)) throw new Error('表示する時間を確認してください。');
  }
  withLock_(function () {
    saveProject_(name, icon);
    if (hours !== undefined) { props_().setProperty('DAY_START', String(Number(hours[0]))); props_().setProperty('DAY_END', String(Number(hours[1]))); }
  });
  return getState();
}

/** ファビコンの絵文字を変える（管理者）。code は絵文字の番号（例: 1f439）。次にページを開いたときから変わる。 */
function setFavicon(code) {
  const me = me_();
  requireAdmin_(me);
  const v = String(code == null ? '' : code).toLowerCase();
  if (!EMOJI_RE.test(v)) throw new Error('絵文字を 1 つ選択してください。');
  withLock_(function () {
    if (v === FAVICON_DEFAULT) props_().deleteProperty('FAVICON_EMOJI'); else props_().setProperty('FAVICON_EMOJI', v);
  });
  return getState();
}

/** 画面の明るさ（ライト／ダーク／端末に合わせる）を変える（管理者）。全員の画面に効く。 */
function setMode(mode) {
  const me = me_();
  requireAdmin_(me);
  const v = String(mode == null ? '' : mode);
  if (MODES.indexOf(v) < 0) throw new Error('表示モードの指定が正しくありません。');
  withLock_(function () {
    if (v === 'light') props_().deleteProperty('MODE'); else props_().setProperty('MODE', v);
  });
  return getState();
}

/** タスクを追加するときの初めの値を決める（管理者）。「位置情報を記録」と「Meet を付ける」。 */
function setDefaults(input) {
  const me = me_();
  requireAdmin_(me);
  withLock_(function () {
    if (input && typeof input.geo === 'boolean') {
      if (input.geo) props_().setProperty('DEFAULT_GEO', 'true'); else props_().deleteProperty('DEFAULT_GEO');
    }
    if (input && typeof input.meet === 'boolean') {
      if (input.meet) props_().setProperty('DEFAULT_MEET', 'true'); else props_().deleteProperty('DEFAULT_MEET');
    }
    // カレンダーの招待メール。初めはオフ（割り当ての知らせは、Scurrop のメールで送る）
    if (input && typeof input.invite === 'boolean' && input.invite !== inviteOn_()) {
      if (input.invite) props_().setProperty('CAL_INVITE', 'true'); else props_().deleteProperty('CAL_INVITE');
      logHistory_(me.email, '', 'setting', 'カレンダーの招待メールを' + (input.invite ? 'オン' : 'オフ'), null);
    }
  });
  return getState();
}

/** ボードを追加する（管理者）。 */
function addBoard(input) {
  const me = me_();
  requireAdmin_(me);
  const name = text_(input && input.name, 40);
  const color = text_(input && input.color, 7);
  if (!name) throw new Error('ボード名を入力してください。');
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error('色の指定が正しくありません。');
  withLock_(function () {
    const boards = read_('boards');
    if (boards.some(function (b) { return String(b.name) === name; })) throw new Error('同じ名前のボードがあります。');
    appendObj_('boards', { name: name, color: color, order: boards.length + 1 });
  });
  return getState();
}

// ---------- シフト ----------
// シフトは見え方のためのもの。シフトが無くてもタスクは登録できる（縛りにしない）。

function ymd_(ms) { const d = new Date(ms); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function ymdOf_(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? ymd_(d.getTime()) : 0;
}
function ymdText_(n) { const v = Number(n) || 0; return v ? Math.floor(v / 10000) + '-' + ('0' + Math.floor(v / 100) % 100).slice(-2) + '-' + ('0' + v % 100).slice(-2) : ''; }
function minOf_(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  return m && Number(m[1]) <= 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : -1;
}
function bar_(v) { return String(v == null ? '' : v).split('|').filter(String); }

/** その日に当たるシフトを、時刻つきで返す。 */
function shiftsOn_(dayStart, rows) {
  const n = ymd_(dayStart);
  const wd = String(new Date(dayStart).getDay());
  return rows.filter(function (x) {
    const date = Number(x.date), until = Number(x.until) || 0, rep = String(x.repeat || 'none');
    if (bar_(x.skip).indexOf(String(n)) >= 0) return false;
    if (rep === 'none') return date === n;
    if (n < date || (until && n > until)) return false;
    return rep === 'daily' || bar_(x.days).indexOf(wd) >= 0;
  }).map(function (x) {
    // その日の時計の時刻で決める（0 時に分を足すと、夏時間の切り替えの日に 1 時間ずれる）
    const at = function (min) { const d = new Date(dayStart); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Number(min) || 0).getTime(); };
    return {
      id: String(x.id), member: String(x.member_email), start: at(x.start_min), end: at(x.end_min),
      repeat: String(x.repeat || 'none'), date: ymdText_(x.date), days: bar_(x.days).map(Number), until: ymdText_(x.until)
    };
  });
}

/** シフトを 1 つでも持っているメンバー。この人たちだけ、シフトの外を「オフ」として見せる。 */
function shiftUsers_(rows) {
  const seen = {};
  rows.forEach(function (x) { seen[String(x.member_email)] = true; });
  return Object.keys(seen);
}

/**
 * シフトを登録する・変える（管理者）。
 * repeat: none（その日だけ）/ daily（その日から毎日）/ weekly（その日から毎週、days の曜日）。until は繰り返しの終了日（任意）。
 */
function saveShift(input) {
  const me = me_();
  requireAdmin_(me);
  const id = text_(input && input.id, 40);
  const member = text_(input && input.member, 120).toLowerCase();
  const date = ymdOf_(input && input.date);
  const start = minOf_(input && input.start), end = minOf_(input && input.end);
  const repeat = ['none', 'daily', 'weekly'].indexOf(input && input.repeat) >= 0 ? input.repeat : 'none';
  const until = repeat === 'none' ? 0 : ymdOf_(input && input.until);
  let days = repeat === 'weekly' ? (Array.isArray(input && input.days) ? input.days : []).map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && d === Math.floor(d) && a.indexOf(d) === i; }).sort() : [];
  if (!date) throw new Error('日付を確認してください。');
  if (start < 0 || end < 0 || end <= start || end > 1440) throw new Error('開始と終了の時刻を確認してください。');
  if (repeat === 'weekly' && !days.length) throw new Error('曜日を選択してください。');
  if (repeat !== 'none' && input && input.until && !until) throw new Error('終了日を確認してください。');
  if (until && until < date) throw new Error('終了日は、開始日以降にしてください。');
  withLock_(function () {
    if (!read_('members').some(function (m) { return m.email === member && isJoined_(m); })) throw new Error('このメンバーは登録されていません。');
    const cells = { member_email: member, date: date, start_min: start, end_min: end, repeat: repeat, days: days.join('|'), until: until || '' };
    if (id) {
      const row = read_('shifts').filter(function (x) { return String(x.id) === id; })[0];
      if (!row) throw new Error('シフトが見つかりません。');
      setCells_('shifts', row._row, cells);
    } else {
      cells.id = id_(); cells.skip = ''; cells.created_by = me.email; cells.created_ms = Date.now();
      appendObj_('shifts', cells);
    }
  });
  return getState();
}

/** シフトを消す（管理者）。繰り返しのシフトで day（YYYY-MM-DD）を渡すと、その日だけ外す。 */
function deleteShift(id, day) {
  const me = me_();
  requireAdmin_(me);
  const sid = text_(id, 40);
  const one = ymdOf_(day);
  withLock_(function () {
    const row = read_('shifts').filter(function (x) { return String(x.id) === sid; })[0];
    if (!row) throw new Error('シフトが見つかりません。');
    if (one && String(row.repeat || 'none') !== 'none') {
      const skip = bar_(row.skip);
      if (skip.indexOf(String(one)) < 0) skip.push(String(one));
      setCells_('shifts', row._row, { skip: skip.join('|') });
    } else {
      deleteRow_('shifts', row._row);
    }
  });
  return getState();
}

/** ボードの名前と色を変える（管理者）。名前を変えたら、メンバーとテンプレートに書いてあるボード名も直す。 */
function updateBoard(oldName, input) {
  const me = me_();
  requireAdmin_(me);
  const old = text_(oldName, 40);
  const name = text_(input && input.name, 40);
  const color = text_(input && input.color, 7);
  if (!name) throw new Error('ボード名を入力してください。');
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) throw new Error('色の指定が正しくありません。');
  withLock_(function () {
    const boards = read_('boards');
    const b = boards.filter(function (x) { return String(x.name) === old; })[0];
    if (!b) throw new Error('ボードが見つかりません。');
    if (name !== old && boards.some(function (x) { return String(x.name) === name; })) throw new Error('同じ名前のボードがあります。');
    setCells_('boards', b._row, { name: name, color: color });
    if (name !== old) moveBoard_(old, name);
  });
  return getState();
}

/** ボードを消す（管理者）。そのボードのメンバーとテンプレートは「デフォルト」（ボードなし）に移る。メンバーやタスクは消えない。 */
function deleteBoard(name) {
  const me = me_();
  requireAdmin_(me);
  const old = text_(name, 40);
  withLock_(function () {
    const b = read_('boards').filter(function (x) { return String(x.name) === old; })[0];
    if (!b) throw new Error('ボードが見つかりません。');
    deleteRow_('boards', b._row);
    moveBoard_(old, '');
  });
  return getState();
}

function moveBoard_(from, to) {
  read_('members').forEach(function (m) { if (String(m.board || '') === from) setCells_('members', m._row, { board: to }); });
  readOpt_('templates').forEach(function (t) { if (t.id && String(t.board || '') === from) setCells_('templates', t._row, { board: to }); });
}

/** メンバーを追加する（管理者）。 */
function addMember(input) {
  const me = me_();
  requireAdmin_(me);
  const email = text_(input && input.email, 120).toLowerCase();
  const name = text_(input && input.name, 60);
  const board = text_(input && input.board, 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません。');
  if (!name) throw new Error('表示名を入力してください。');
  withLock_(function () {
    const old = read_('members').filter(function (m) { return String(m.email).toLowerCase() === email; })[0];
    if (old && isActive_(old)) throw new Error('このメールアドレスは登録済みです。');
    if (board && !read_('boards').some(function (b) { return String(b.name) === board; })) {
      appendObj_('boards', { name: board, color: boardColor_(read_('boards').length), order: read_('boards').length + 1 });
    }
    // 最初は「招待中」。本人が招待のメールから参加すると、ボードに出て、タスクを割り当てられるようになる
    const cells = { name: name, role: 'member', board: board, active: true, status: 'invited', key_nonce: 'n' + Utilities.getUuid().replace(/-/g, '').slice(0, 15), invited_ms: Date.now(), joined_ms: '' };
    // 前に外したメンバーなら、同じ行を戻す
    if (old) setCells_('members', old._row, cells);
    else { cells.email = email; appendObj_('members', cells); }
  });
  MAIL_FALLBACK = false;
  const problem = sendInvite_(email, me);
  const state = getState();
  state.notice = problem || (MAIL_FALLBACK ? FALLBACK_NOTE : '');
  return state;
}

/** 招待のリンク。組織の中の人は Google アカウントで見分けるので、鍵は付けない。組織の外の人には、本人だけの鍵を付ける。 */
function inviteLink_(m) {
  const url = url_();
  if (!url) return '';
  return outside_(m.email) ? outsideUrl_() + '?k=' + keyOf_(m) : url;
}

/**
 * メールが届くかを確かめる（管理者）。自分あてに、文字だけの短いメールを 1 通送る。
 * 招待のメールが届かないときに、「この Web アプリからのメール自体が届かない」のか「外のアドレスにだけ届かない」のかを分けるため。
 */
function testMail() {
  const me = me_();
  requireAdmin_(me);
  const out = { to: me.email, ok: false, error: '', left: mailLeft_(), via: '', why: '' };
  try {
    out.via = mail_(me.email, 'Scurrop | メールの確認', 'このメールは、Scurrop からのメール送信を確認するためのテストです。\n' + new Date().toString());
    out.ok = true;
    out.left = mailLeft_();
  } catch (err) {
    out.error = String(err && err.message ? err.message : err);
  }
  out.why = props_().getProperty('MAIL_WHY') || '';
  return out;
}

/** 招待のメールを送った結果を残す。メンバーの行（invite_error）と履歴の両方に書くので、届かないときに原因を追える。 */
function noteInvite_(email, me, problem) {
  try {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === email && isActive_(x); })[0];
    if (m) setCells_('members', m._row, { invite_error: problem });
    logHistory_(me.email, '', 'invite', email + (problem ? ' への送信に失敗（' + problem + '）' : ' に送信'), null);
  } catch (err) { /* 結果を残せなくても、登録は止めない */ }
}

/** 招待のメールを送る。「Scurrop | プロジェクト名 のボードに参加しますか？」。問題があれば文字で返す。 */
function sendInvite_(email, me) {
  let problem = '';
  try {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === email && isActive_(x); })[0];
    const url = url_();
    if (!m) throw new Error('メンバーが見つかりません');
    if (!url) throw new Error('この Web アプリの URL を取得できません');
    const project = U_(props_().getProperty('PROJECT_NAME') || book_().getName());
    // 組織の中の人は Google アカウントで見分けるので、鍵は付けない。組織の外の人には、本人だけの鍵を付ける
    const link = inviteLink_(m);
    const subject = 'Scurrop | ' + project + ' のボードに参加しますか？';
    const plain = [U_(me.name) + ' さんから、Scurrop のボード「' + project + '」への招待が届いています。', '', '参加する：', link].join('\n');
    // HTML が読めるメールには、ボタンを出す。読めないメールには上の文字だけが出る。画像は付けない
    mail_(email, subject, plain, inviteHtml_(project, U_(me.name), link));
  } catch (err) {
    problem = '招待メールを送信できませんでした: ' + String(err && err.message ? err.message : err);
  }
  noteInvite_(email, me, problem);
  return problem;
}

function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// メールの文字の大きさ。画面と同じ段階（xs 注記 / sm 本文 / md 強調 / lg 見出し）。メールは変数を使えないので、ここで決めて使い回す
const MAIL_FS = { xs: 'font-size:12px;line-height:16px;', sm: 'font-size:14px;line-height:22px;', md: 'font-size:16px;line-height:24px;', lg: 'font-size:20px;line-height:28px;' };
const MAIL_FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Noto Sans JP',sans-serif;";

/**
 * Scurrop から送るメールの外枠（招待も、お知らせも同じ見た目にする）。
 * メールの中では使える書き方が限られるので、表と行内の指定だけで組む。画像は付けない。名前などは必ず esc_ を通す。
 * project を渡すと、上に「Scurrop | プロジェクト名」と出す。rows は <tr>…</tr> の並び。
 */
function mailShell_(project, rows) {
  return '<div style="margin:0;padding:24px 16px;background:#FFFFFF;' + MAIL_FONT + 'color:#1D1D1F">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:480px;border:1px solid #E5E5EA;border-radius:16px">' +
    '<tr><td style="padding:24px 24px 0 24px;' + MAIL_FONT + '' + MAIL_FS.md + 'font-weight:700;color:' + NAVY + '">Scurrop' +
    (project ? '<span style="font-weight:400;color:#6E6E73"> | ' + esc_(project) + '</span>' : '') + '</td></tr>' +
    rows + '</table></div>';
}
/** メールのボタンと、ボタンが開けないときのリンク。 */
function mailButton_(label, link) {
  return '<tr><td style="padding:0 24px 24px 24px"><a href="' + esc_(link) + '" style="display:inline-block;padding:12px 24px;border-radius:12px;background:' + NAVY + ';color:#FFFFFF;' + MAIL_FONT + '' + MAIL_FS.md + 'font-weight:700;text-decoration:none">' + esc_(label) + '</a></td></tr>' +
    '<tr><td style="padding:0 24px 24px 24px;' + MAIL_FONT + '' + MAIL_FS.xs + 'color:#6E6E73;word-break:break-all">ボタンで開けない場合、下記URLからアクセスしてください。<br><a href="' + esc_(link) + '" style="color:#6E6E73">' + esc_(link) + '</a></td></tr>';
}

/** 招待のメールの HTML。 */
function inviteHtml_(project, by, link) {
  return mailShell_('',
    '<tr><td style="padding:24px 24px 8px 24px;' + MAIL_FONT + '' + MAIL_FS.lg + 'font-weight:700;color:#1D1D1F">' + esc_(project) + ' のボードに参加しますか？</td></tr>' +
    '<tr><td style="padding:0 24px 24px 24px;' + MAIL_FONT + '' + MAIL_FS.sm + 'color:#6E6E73">' + esc_(by) + ' さんからの招待です。</td></tr>' +
    mailButton_('参加する', link));
}

/**
 * お知らせのメールの HTML（ルールの通知、リンクの通知）。
 * o: { label（何のお知らせか）, late（遅延なら true。印を赤にする）, title（タスク名）, sub（時間とメンバー）, rows（[見出し, 中身] の並び）, link（タスクを開くリンク） }
 */
function noticeHtml_(o) {
  const cell = function (pad, style, html) { return '<tr><td style="padding:' + pad + ';' + MAIL_FONT + style + '">' + html + '</td></tr>'; };
  const lines = function (text) { return esc_(text).replace(/\r?\n/g, '<br>'); };
  let rows = cell('24px 24px 0 24px', '', '<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:' + (o.late ? '#FF3B30' : NAVY) + ';color:#FFFFFF;' + MAIL_FONT + '' + MAIL_FS.xs + 'font-weight:700">' + esc_(o.label) + '</span>') +
    cell('12px 24px 4px 24px', '' + MAIL_FS.lg + 'font-weight:700;color:#1D1D1F', esc_(o.title)) +
    cell('0 24px 24px 24px', '' + MAIL_FS.sm + 'color:#6E6E73', esc_(o.sub));
  (o.rows || []).forEach(function (r) {
    if (!r[1]) return;
    rows += cell('0 24px 4px 24px', '' + MAIL_FS.xs + 'color:#6E6E73', esc_(r[0])) +
      cell('0 24px 16px 24px', '' + MAIL_FS.sm + 'color:#1D1D1F;overflow-wrap:anywhere', lines(r[1]));
  });
  if ((o.rows || []).some(function (r) { return r[1]; })) rows += cell('0 24px 8px 24px', 'font-size:0;line-height:0', '&nbsp;');
  if (o.link) rows += mailButton_('タスクを開く', o.link);
  return mailShell_(o.project, rows);
}

function mailLeft_() { return clock_('mail', function () { try { return MailApp.getRemainingDailyQuota(); } catch (err) { return -1; } }); }

/**
 * メールを送る。入口はここだけ。
 * まず Gmail から「本人が送ったメール」として送る（送信済みにも残る）。それができないときだけ、予備の送り方（MailApp）で送る。
 * 2026-11-14: MailApp で自動で送ったメールは、同じ文面・同じリンクでも、受け取る側の Gmail に「Message rejected」で拒否された
 * （手で送ると届く）。送り方の違いが原因だったので、本人のメールとして送る。
 * 返すのは、どちらで送ったか（'gmail' か 'mailapp'）。どちらでも送れなければ、理由をつけて止める。
 */
function mail_(to, subject, plain, html) {
  to = String(to || '').trim();
  if (!/^[^\s<>,;:"'()\\]+@[A-Za-z0-9.-]+$/.test(to)) throw new Error('アドレスが正しくありません');
  // メールは、プロジェクトの言語で送る
  // 利用者が入れた文字（U_ で包んだところ）は、直さない
  subject = TU_(subject); plain = TU_(plain); if (html) html = TU_(html);
  let why = '';
  try {
    if (typeof Gmail === 'undefined') throw new Error('Gmail  サービスが有効になっていません');
    Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime_(to, subject, plain, html)) }, 'me');
    noteMail_('gmail', '');
    return 'gmail';
  } catch (err) {
    why = needsAuth_() ? '承認が必要です（エディタで authorize を実行）' : String(err && err.message ? err.message : err).slice(0, 200);
  }
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('本日のメール送信数が上限に達しました');
  if (html) {
    // HTML つきで送れなかったら、文字だけで送り直す
    try { MailApp.sendEmail(to, subject, plain, { htmlBody: html }); } catch (err) { MailApp.sendEmail(to, subject, plain); }
  } else {
    MailApp.sendEmail(to, subject, plain);
  }
  noteMail_('mailapp', why);
  MAIL_FALLBACK = true;
  return 'mailapp';
}

/** この実行のなかで、予備の送り方に落ちたか。招待を送った人に、その場で知らせるため。 */
let MAIL_FALLBACK = false;
const FALLBACK_NOTE = 'Gmail で送信できなかったため、予備の方法で送信しました。届かない場合があります。';

/** その権限（省くと「Gmail で送る」）の承認がまだか。分からなければ false。 */
function needsAuth_(scope) {
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, [scope || 'https://www.googleapis.com/auth/gmail.send']);
    return info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;
  } catch (err) { return false; }
}

/** どちらの送り方で送れたかを覚えておく（管理画面のいちばん下に出す）。変わったときだけ書く。 */
function noteMail_(via, why) {
  try {
    const p = props_();
    if (p.getProperty('MAIL_VIA') !== via) p.setProperty('MAIL_VIA', via);
    if ((p.getProperty('MAIL_WHY') || '') !== why) { if (why) p.setProperty('MAIL_WHY', why); else p.deleteProperty('MAIL_WHY'); }
  } catch (err) { /* 覚えられなくても、メールは送れている */ }
}

function b64_(text) { return Utilities.base64Encode(String(text), Utilities.Charset.UTF_8); }

/** メールの見出し（件名）に日本語を入れるための書き方。1 行が長くならないよう、10 文字ずつに分ける。改行は入れさせない。 */
function mimeWord_(text) {
  const t = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const chars = Array.from(t);
  const out = [];
  for (let i = 0; i < chars.length; i += 10) out.push('=?UTF-8?B?' + b64_(chars.slice(i, i + 10).join('')) + '?=');
  return out.join('\r\n ');
}

/** 送るメールそのもの（文字だけ、または文字と HTML の両方）。送り主は書かない（Gmail が本人のアドレスを入れる）。 */
function mime_(to, subject, plain, html) {
  const part = function (type, text) {
    return ['Content-Type: ' + type + '; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      b64_(text).replace(/(.{76})/g, '$1\r\n')].join('\r\n');
  };
  const head = ['To: ' + to, 'Subject: ' + mimeWord_(subject), 'MIME-Version: 1.0'];
  if (!html) return head.concat([part('text/plain', plain)]).join('\r\n');
  const b = 'scurrop_' + Utilities.getUuid().replace(/-/g, '');
  return head.concat(['Content-Type: multipart/alternative; boundary="' + b + '"', '',
    '--' + b, part('text/plain', plain), '--' + b, part('text/html', html), '--' + b + '--', '']).join('\r\n');
}

/**
 * 権限を足したあとの承認のための入口。スクリプトのエディタでこれを選んで実行する（公開した本人だけ）。
 * 足りない承認があれば、承認の画面が出て、そこで止まる。承認したあとにもう一度実行すると、
 * Gmail から自分あてに 1 通送って、結果を実行ログに出す（予備の送り方は使わない）。
 * 何もしない関数では承認の画面が出ない（Apps Script は、足りない承認を自分からは求めない）ので、requireAllScopes で求める。
 */
function authorize() {
  if (!canSetup_()) throw new Error('デプロイしたアカウントのみ実行できます。');
  if (ScriptApp.requireAllScopes) ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  const me = ownerEmail_();
  let line = '';
  try {
    if (typeof Gmail === 'undefined') throw new Error('Gmail  サービスが有効になっていません（エディタの左の「サービス」で Gmail API を追加）');
    Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(mime_(me, 'Scurrop | メールの確認', 'Gmail から送信できています。\n' + new Date().toString())) }, 'me');
    noteMail_('gmail', '');
    line = 'ok: Gmail から ' + me + ' に送信しました';
  } catch (err) {
    line = 'Gmail で送信できません: ' + String(err && err.message ? err.message : err);
  }
  let watch = '';
  try { watch = isReady_() ? syncTick_(true) : ''; } catch (err) { watch = String(err && err.message ? err.message : err); }
  if (isReady_() && (watch || wantsTick_())) line += ' / 監視: ' + (watch || 'ok（' + TICK_MINUTES + ' 分間隔）');
  try { noteUrl_(execUrl_()); } catch (err) { /* URL のシートを書けなくても、承認はできている */ }
  console.log(line);
  return line;
}

/** 招待を送り直す（管理者）。鍵を作り直すので、前のメールのリンクは使えなくなる。 */
function resendInvite(email) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  withLock_(function () {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    if (isJoined_(m)) throw new Error('このメンバーは参加済みです。');
    setCells_('members', m._row, { key_nonce: 'n' + Utilities.getUuid().replace(/-/g, '').slice(0, 15), invited_ms: Date.now() });
  });
  MAIL_FALLBACK = false;
  const problem = sendInvite_(mail, me);
  const state = getState();
  state.notice = problem || (MAIL_FALLBACK ? FALLBACK_NOTE : '');
  return state;
}

/**
 * 組織の外のメンバーのリンク（鍵）を作り直す（管理者）。リンクが人に渡ってしまったときに使う。
 * いまのリンクは使えなくなり、新しいリンクを本人にメールで送る。
 */
function renewKey(email) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  let name = '';
  withLock_(function () {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    if (!outside_(mail)) throw new Error('同じ組織のメンバーは Google アカウントで認証するため、リンクの再発行は不要です。');
    if (!isJoined_(m)) throw new Error('招待中のメンバーには、招待を再送してください。');
    setCells_('members', m._row, { key_nonce: 'n' + Utilities.getUuid().replace(/-/g, '').slice(0, 15) });
    logHistory_(me.email, '', 'member', mail + ' のリンクを再発行', null);
    name = String(m.name);
  });
  let problem = '';
  MAIL_FALLBACK = false;
  try {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    const link = inviteLink_(m);
    const project = U_(props_().getProperty('PROJECT_NAME') || '');
    const subject = 'Scurrop | ' + project + ' のリンクが再発行されました';
    mail_(mail, subject, ['従来のリンクは無効になりました。今後は下記のリンクからアクセスしてください。', '', link].join('\n'),
      mailShell_(project,
        '<tr><td style="padding:24px 24px 8px 24px;' + MAIL_FONT + '' + MAIL_FS.lg + 'font-weight:700;color:#1D1D1F">リンクが再発行されました</td></tr>' +
        '<tr><td style="padding:0 24px 24px 24px;' + MAIL_FONT + '' + MAIL_FS.sm + 'color:#6E6E73">従来のリンクは無効になりました。今後は下記のボタンからアクセスしてください。</td></tr>' +
        mailButton_('Scurrop を開く', link)));
  } catch (err) {
    problem = '新しいリンクをメールで送信できませんでした: ' + String(err && err.message ? err.message : err);
  }
  const state = getState();
  state.notice = problem || (MAIL_FALLBACK ? FALLBACK_NOTE : '');
  return state;
}

/** 招待された本人が参加する。表示名はここで直せる。 */
function joinProject(input) {
  const key = input && input.key;
  const me = me_(key);
  if (me.role === 'guest') throw new Error('招待が見つかりません。招待メールのリンクからアクセスしてください。');
  if (me.role === 'invited') {
    const name = text_(input && input.name, 60) || me.name;
    withLock_(function () {
      const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === me.email.toLowerCase() && isActive_(x); })[0];
      if (!m) throw new Error('招待が見つかりません。');
      setCells_('members', m._row, { status: 'joined', name: name, joined_ms: Date.now() });
      logHistory_(me.email, '', 'member', '参加', null);
    });
  }
  return getState({ key: key });
}

/** メンバーのボードを変える（管理者）。 */
function setMemberBoard(email, board) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  const name = text_(board, 40);
  withLock_(function () {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail; })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    if (name && !read_('boards').some(function (b) { return String(b.name) === name; })) throw new Error('ボードが見つかりません。');
    setCells_('members', m._row, { board: name });
  });
  return getState();
}

const PHOTO_MAX = 24000;

/** メンバーの写真を決める・消す（管理者）。画面の側で 128px に小さくした画像だけを受け取る。空を渡すと消す。 */
function setMemberPhoto(email, data) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  const img = image_(data, PHOTO_MAX, '写真');
  withLock_(function () {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    const row = read_('photos').filter(function (x) { return String(x.email).toLowerCase() === mail; })[0];
    if (row) setCells_('photos', row._row, { data: img });
    else if (img) appendObj_('photos', { email: mail, data: img });
    setCells_('members', m._row, { photo_rev: img ? String(Date.now()) : '' });
  });
  return getState();
}

/** 写真を返す。管理者は誰の分でも、メンバーは自分の分だけ。 */
function getPhotos(emails, key) {
  const me = me_(key);
  const want = {};
  (Array.isArray(emails) ? emails : []).slice(0, 200).forEach(function (e) { want[String(e).toLowerCase()] = true; });
  const out = {};
  readOpt_('photos').forEach(function (x) {
    const mail = String(x.email).toLowerCase();
    if (!want[mail] || !x.data) return;
    if (!isAdmin_(me) && (!isMember_(me) || mail !== me.email.toLowerCase())) return;
    out[mail] = String(x.data);
  });
  return out;
}

/** メンバーの表示名・ロール・ボードを変える（管理者）。管理者が 1 人もいなくなる変更はできない。 */
function updateMember(email, input) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  const name = text_(input && input.name, 60);
  const role = input && input.role === 'admin' ? 'admin' : 'member';
  const board = text_(input && input.board, 40);
  if (!name) throw new Error('表示名を入力してください。');
  withLock_(function () {
    const rows = read_('members');
    const m = rows.filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    if (board && !read_('boards').some(function (b) { return String(b.name) === board; })) throw new Error('ボードが見つかりません。');
    const others = rows.filter(function (x) { return isActive_(x) && String(x.role) === 'admin' && String(x.email).toLowerCase() !== mail; }).length;
    if (String(m.role) === 'admin' && role !== 'admin' && !others) throw new Error('管理者が不在になります。');
    if (role === 'admin' && outside_(mail)) throw new Error('管理者に設定できるのは、同じ組織のアカウントのみです。');
    setCells_('members', m._row, { name: name, role: role, board: board });
    // だれが、だれの何を変えたかを残す（ロールの変更は、とくに）
    const what = [];
    if (String(m.role) !== role) what.push('ロール（' + (role === 'admin' ? '管理者' : 'メンバー') + '）');
    if (String(m.name) !== name) what.push('表示名');
    if (String(m.board || '') !== board) what.push('ボード');
    if (what.length) logHistory_(me.email, '', 'member', mail + ' の' + what.join('・') + 'を変更', null);
  });
  return getState();
}

/**
 * メンバーを外す（管理者）。行は残して無効にする。
 * その人の、まだ終わっていないこれからのタスクは未割り当てに戻し、カレンダーの予定を消す。
 */
function removeMember(email) {
  const me = me_();
  requireAdmin_(me);
  const mail = text_(email, 120).toLowerCase();
  if (mail === me.email.toLowerCase()) throw new Error('自分自身は削除できません。');
  let touched = [];
  withLock_(function () {
    const m = read_('members').filter(function (x) { return String(x.email).toLowerCase() === mail && isActive_(x); })[0];
    if (!m) throw new Error('メンバーが見つかりません。');
    setCells_('members', m._row, { active: false });
    logHistory_(me.email, '', 'member', mail + (isJoined_(m) ? ' をメンバーから削除' : ' の招待を取り消し'), null);
    const now = Date.now();
    read_('tasks').forEach(function (t) {
      if (String(t.member_email).toLowerCase() !== mail || String(t.status) === 'done' || Number(t.end_ms) < now) return;
      removeEvent_(t.event_id);
      setCells_('tasks', t._row, { member_email: '', event_id: '' });
      logHistory_(me.email, String(t.id), 'edit', 'メンバーの削除により未割り当て', null);
      touched.push(String(t.id));
    });
  });
  const seen = {};
  touched.forEach(function (id) { linkedIds_(id).forEach(function (o) { if (!seen[o]) { seen[o] = true; syncEvent_(o); } }); });
  return getState();
}

/** タスクを作る（管理者）。メンバーを指定すると、その人のカレンダーに予定を入れる。 */
function createTask(input) {
  const me = me_();
  requireAdmin_(me);
  const title = text_(input && input.title, 80);
  const memo = memo_(input && input.memo);
  const address = text_(input && input.address, 200);
  const member = text_(input && input.member, 120).toLowerCase();
  const start = Number(input && input.start);
  const end = Number(input && input.end);
  if (!title) throw new Error('タスク名を入力してください。');
  if (!isFinite(start) || !isFinite(end) || end <= start) throw new Error('開始と終了の時刻を確認してください。');
  if (end - start > 24 * 60 * 60 * 1000) throw new Error('1つのタスクは24時間以内にしてください。');
  const rep = repeatOf_(input, start);
  let calendar = '';
  let meetError = '';
  let meetLater = false;
  let id = '';
  const templateId = text_(input && input.templateId, 40);
  if (templateId && !templateMap_()[templateId]) throw new Error('テンプレートが見つかりません。');
  withLock_(function () {
    if (member && !read_('members').some(function (m) { return m.email === member && isJoined_(m); })) {
      throw new Error('このメンバーは登録されていません。');
    }
    const series = rep ? id_() : '';
    const now = Date.now();
    const rows = (rep ? rep.starts : [start]).map(function (st, n) {
      const row = {
        id: id_(), title: title, member_email: member, start_ms: st, end_ms: st + (end - start), memo: memo, address: address, status: 'planned',
        event_id: '', created_by: me.email, created_ms: now, template_id: templateId, values: '',
        geo: !!(input && input.geo === true), meet: input && input.meet === true ? 'on' : '', series: series
      };
      if (!member) return row;
      if (n > 0) { row.event_id = EVENT_WAIT; return row; } // 2 つ目からは、カレンダーの予定をあとから作る（まとめて作ると、長く待たせるため）
      // 繰り返しのタスクは、カレンダーからの招待メールを 1 つずつ送らない（「割り当て」の知らせ 1 通にまとめる）
      const made = makeEvent_(row.id, title, row.start_ms, row.end_ms, memo, member, address, !!rep);
      row.event_id = made.id;
      calendar = made.error;
      if (row.meet && made.id) { const mt = addMeet_(made.id); row.meet = mt.cell; meetError = mt.error; if (mt.later) meetLater = true; }
      return row;
    });
    id = rows[0].id;
    appendObjs_('tasks', rows);
    logHistory_(me.email, id, 'create', [calendar ? 'カレンダー登録に失敗: ' + calendar : (member ? 'カレンダーに登録' : '未割り当て'), rep ? '繰り返し: ' + rep.text : ''].filter(String).join('・'), null);
  });
  const first = findTask_(id);
  if (!member) runRules_('unassigned', first);
  else runRules_('assign', first, { by: me.email, series: rep ? rep.text : '' });
  const state = getState();
  state.calendarError = calendar;
  state.notice = [meetNote_(meetError) || meetLaterNote_(state, meetLater), rep ? rep.starts.length + ' 件のタスクを作成しました（' + rep.text + '）' : ''].filter(String).join(' / ');
  return state;
}

const EVENT_WAIT = 'wait';      // カレンダーの予定を、あとから作るしるし
const REPEAT_MAX = 60;          // 1 回の繰り返しで作るタスクの数の上限
const REPEAT_DAYS = 92;         // 繰り返しの終わりの日は、始まりの日から約 3 か月まで
const EVENTS_PER_FILL = 4;      // 1 回の更新で、あとから作る予定の数

/**
 * 繰り返しの指定を確かめて、作るタスクの開始の時刻を並べる。繰り返しなしなら null。
 * シフトと同じ要領: daily（その日から毎日）/ weekly（その日から毎週、days の曜日）。until（終わりの日）は必須。
 * タスクは 1 つずつ別のもの（開始・完了・報告があるため）なので、終わりの日までの分を先に作る。
 */
function repeatOf_(input, start) {
  const repeat = input && (input.repeat === 'daily' || input.repeat === 'weekly') ? input.repeat : '';
  if (!repeat) return null;
  const d0 = new Date(start);
  const first = ymd_(start);
  const until = ymdOf_(input.until);
  const days = repeat === 'weekly' ? (Array.isArray(input.days) ? input.days : []).map(Number).filter(function (d, i, a) { return d >= 0 && d <= 6 && d === Math.floor(d) && a.indexOf(d) === i; }).sort() : [];
  if (repeat === 'weekly' && !days.length) throw new Error('曜日を選択してください。');
  if (!until) throw new Error('繰り返しの終了日を入力してください。');
  if (until < first) throw new Error('終了日は、開始日以降にしてください。');
  const starts = [];
  for (let n = 0; n <= REPEAT_DAYS; n++) {
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n, d0.getHours(), d0.getMinutes());
    if (ymd_(d.getTime()) > until) break;
    if (n === REPEAT_DAYS) throw new Error('繰り返しの終了日は、開始日から 3 か月以内にしてください。');
    if (repeat === 'weekly' && days.indexOf(d.getDay()) < 0) continue;
    starts.push(d.getTime());
    if (starts.length > REPEAT_MAX) throw new Error('1 回の繰り返しで作成できるタスクは最大 ' + REPEAT_MAX + ' 件です。終了日を早めてください。');
  }
  if (!starts.length) throw new Error('終了日までに該当する日がありません。');
  const end = new Date(starts[starts.length - 1]);
  return { starts: starts, text: (repeat === 'daily' ? '毎日' : '毎週 ' + days.map(function (d) { return wd_()[d]; }).join('・')) + '、' + (end.getMonth() + 1) + '/' + end.getDate() + ' まで（' + starts.length + ' 件）' };
}

/**
 * あとから作ることにしたカレンダーの予定（繰り返しのタスクの 2 つ目から）を、開始の早い順に少しずつ作る。
 * 管理者が画面を開いているあいだと、見張り（5 分おき）で進む。1 つでも作ったら true。
 */
function fillEvents_(tasks) {
  const todo = tasks.filter(function (t) { return t.id && String(t.event_id) === EVENT_WAIT && t.member_email && String(t.status) !== 'done'; })
    .sort(function (a, b) { return Number(a.start_ms) - Number(b.start_ms); }).slice(0, EVENTS_PER_FILL);
  let made = 0;
  todo.forEach(function (t) {
    const ev = makeEvent_(String(t.id), String(t.title), Number(t.start_ms), Number(t.end_ms), memoOf_(t), String(t.member_email), String(t.address || ''), true);
    if (!ev.id) return; // 作れなかったら、そのまま（次の機会にもう一度）
    let kept = false;
    withLock_(function () {
      const now = findTask_(String(t.id));
      // 作っているあいだに消された・ほかの人に変わった・時間が変わったタスクには付けない
      if (!now || String(now.event_id) !== EVENT_WAIT || String(now.member_email) !== String(t.member_email) || Number(now.start_ms) !== Number(t.start_ms)) return;
      const cells = { event_id: ev.id };
      if (String(now.meet) === 'on') { const mt = addMeet_(ev.id); cells.meet = mt.cell; }
      setCells_('tasks', now._row, cells);
      kept = true;
    });
    if (kept) made++; else removeEvent_(ev.id);
  });
  return made > 0;
}

/** 未割り当てのタスクにメンバーを割り当てる（管理者）。同時に押しても先の1人だけ通る。 */
function assignTask(id, email) {
  const me = me_();
  requireAdmin_(me);
  const taskId = text_(id, 40);
  const member = text_(email, 120).toLowerCase();
  let calendar = '';
  let meetError = '';
  let meetLater = false;
  withLock_(function () {
    const t = findTask_(taskId);
    if (!t) throw new Error('タスクが見つかりません。');
    if (t.member_email) throw new Error('このタスクはすでに割り当て済みです。');
    if (!read_('members').some(function (m) { return m.email === member && isJoined_(m); })) {
      throw new Error('このメンバーは登録されていません。');
    }
    const made = makeEvent_(taskId, String(t.title), Number(t.start_ms), Number(t.end_ms), memoOf_(t), member, String(t.address || ''));
    calendar = made.error;
    const cells = { member_email: member, event_id: made.id };
    // Meet を付けることになっているタスクなら、できた予定に付ける
    if (wantsMeet_(t) && made.id) { const mt = addMeet_(made.id); cells.meet = mt.cell; meetError = mt.error; if (mt.later) meetLater = true; }
    setCells_('tasks', t._row, cells);
    logHistory_(me.email, taskId, 'assign', member + (calendar ? '（カレンダー登録に失敗: ' + calendar + '）' : ''), null);
  });
  runRules_('assign', findTask_(taskId), { by: me.email });
  const state = getState();
  state.calendarError = calendar;
  state.notice = meetNote_(meetError) || meetLaterNote_(state, meetLater);
  return state;
}

/** 今ある予定の名前・時間・場所を直す。直せたら true（予定が見つからない・直せないときは false で、作り直しに回る）。 */
function moveEvent_(eventId, title, start, end, address) {
  if (!eventId || String(eventId) === EVENT_WAIT) return false;
  try {
    const ev = CalendarApp.getEventById(String(eventId));
    if (!ev) return false;
    ev.setTitle(title);
    ev.setTime(new Date(start), new Date(end));
    ev.setLocation(address || '');
    return true;
  } catch (err) {
    return false;
  }
}

function removeEvent_(eventId) {
  if (!eventId || String(eventId) === EVENT_WAIT) return;
  try {
    const ev = CalendarApp.getEventById(String(eventId));
    if (ev) ev.deleteEvent();
  } catch (err) { /* 予定が先に消されていても、タスクの操作は止めない */ }
}

/** このタスクとリンクしている相手のタスクの id。 */
function linkedIds_(taskId) {
  return readOpt_('links').filter(function (l) { return l.id && (String(l.a_task) === taskId || String(l.b_task) === taskId); })
    .map(function (l) { return String(l.a_task) === taskId ? String(l.b_task) : String(l.a_task); });
}

/**
 * タスクを変える（管理者）。名前・時間・メモ・メンバー。
 * 予定に関わるところが変わったら、カレンダーの予定を作り直す（前のメンバーには取り消し、新しいメンバーには招待が届く）。
 */
function editTask(id, input) {
  const me = me_();
  requireAdmin_(me);
  const taskId = text_(id, 40);
  const title = text_(input && input.title, 80);
  const memo = memo_(input && input.memo);
  const address = text_(input && input.address, 200);
  const member = text_(input && input.member, 120).toLowerCase();
  const start = Number(input && input.start);
  const end = Number(input && input.end);
  if (!title) throw new Error('タスク名を入力してください。');
  if (!isFinite(start) || !isFinite(end) || end <= start) throw new Error('開始と終了の時刻を確認してください。');
  if (end - start > 24 * 60 * 60 * 1000) throw new Error('1つのタスクは24時間以内にしてください。');
  let calendar = '';
  let freed = false;
  let moved = false;
  let edited = '';
  let meetError = '';
  let meetLater = false;
  withLock_(function () {
    const t = findTask_(taskId);
    if (!t) throw new Error('タスクが見つかりません。');
    if (String(t.status) === 'done') throw new Error('完了したタスクは変更できません。');
    if (member && !read_('members').some(function (m) { return m.email === member && isJoined_(m); })) {
      throw new Error('このメンバーは登録されていません。');
    }
    const cells = { title: title, memo: memo, address: address, member_email: member, start_ms: start, end_ms: end };
    const was = String(t.member_email || '');
    const what = [];
    if (title !== String(t.title)) what.push('タスク名');
    if (start !== Number(t.start_ms) || end !== Number(t.end_ms)) what.push('時間 ' + hm_(start) + '–' + hm_(end));
    if (memo !== memoOf_(t)) what.push('メモ');
    if (address !== String(t.address || '')) what.push('住所');
    if (member !== was) what.push('メンバー');
    // メンバーが同じなら、予定はそのまま直す（ドラッグで動かすたびに、取り消しと招待のメールが届かないように）。
    // メンバーが変わるときだけ作り直す（前の人には取り消し、新しい人には招待が届く）
    if (what.length && !(member === was && member && moveEvent_(t.event_id, title, start, end, address))) {
      removeEvent_(t.event_id);
      cells.event_id = '';
      if (member) {
        const made = makeEvent_(taskId, title, start, end, memo, member, address);
        cells.event_id = made.id;
        calendar = made.error;
      }
    }
    if (start !== Number(t.start_ms)) cells.late_notified_ms = '';
    // 位置情報の記録は、はっきり指定されたときだけ変える（ドラッグで動かしたときなどは、そのまま）
    if (input && typeof input.geo === 'boolean' && input.geo !== isOn_(t.geo)) {
      cells.geo = input.geo;
      what.push('位置情報の記録を' + (input.geo ? 'オン' : 'オフ'));
    }
    // Meet。指定がなければ、いまの設定のまま。予定を作り直したときは、新しい予定に付け直す（リンクは予定ごとに新しく作る）
    const hadMeet = wantsMeet_(t);
    const wantMeet = input && typeof input.meet === 'boolean' ? input.meet : hadMeet;
    const remade = cells.event_id !== undefined;
    const eventNow = remade ? cells.event_id : String(t.event_id || '');
    if (!wantMeet) {
      if (hadMeet) { cells.meet = ''; if (!remade && t.event_id) dropMeet_(String(t.event_id)); what.push('Meet をオフ'); }
    } else {
      if (!eventNow) cells.meet = 'on';
      else if (remade || !meetUrl_(t)) { const mt = addMeet_(eventNow); cells.meet = mt.cell; meetError = mt.error; if (mt.later) meetLater = true; }
      if (!hadMeet) what.push('Meet をオン');
    }
    setCells_('tasks', t._row, cells);
    freed = !member && !!was;
    moved = !!member && member !== was;
    // 同じ人のまま、名前・時間・メモ・住所が変わった: 「変更」の知らせに書く中身
    if (member && member === was) edited = what.filter(function (w) { return /^(タスク名|時間|メモ|住所)/.test(w); }).join('・');
    logHistory_(me.email, taskId, 'edit', what.join('・') + (calendar ? '（カレンダー登録に失敗: ' + calendar + '）' : ''), null);
  });
  const problems = [taskId].concat(linkedIds_(taskId)).map(syncEvent_).filter(String);
  if (freed) runRules_('unassigned', findTask_(taskId));
  if (moved) runRules_('assign', findTask_(taskId), { by: me.email });
  if (edited) runRules_('edit', findTask_(taskId), { by: me.email, change: edited });
  const state = getState();
  state.calendarError = calendar;
  state.notice = problems.concat([meetNote_(meetError) || meetLaterNote_(state, meetLater)]).filter(String).join(' / ');
  return state;
}

/**
 * タスクを消す（管理者）。カレンダーの予定とリンクも消す。履歴には残る。
 * rest が true なら、同じ繰り返しの、これより後のタスクのうち、まだ始めていないものも消す。
 */
function deleteTask(id, rest) {
  const me = me_();
  requireAdmin_(me);
  const taskId = text_(id, 40);
  let others = [];
  const events = [];
  let more = 0;
  withLock_(function () {
    const t = findTask_(taskId);
    if (!t) throw new Error('タスクが見つかりません。');
    const gone = [t];
    if (rest === true && t.series) {
      read_('tasks').forEach(function (x) {
        if (x.id && String(x.id) !== taskId && String(x.series) === String(t.series) && Number(x.start_ms) > Number(t.start_ms) && String(x.status) === 'planned') gone.push(x);
      });
    }
    more = gone.length - 1;
    const ids = {};
    gone.forEach(function (x) { ids[String(x.id)] = true; events.push(x.event_id); });
    const links = readOpt_('links').filter(function (l) { return ids[String(l.a_task)] || ids[String(l.b_task)]; });
    links.forEach(function (l) { [String(l.a_task), String(l.b_task)].forEach(function (o) { if (!ids[o] && others.indexOf(o) < 0) others.push(o); }); });
    links.sort(function (a, b) { return b._row - a._row; }) // 下の行から消す（行番号がずれないように）
      .forEach(function (l) { deleteRow_('links', l._row); });
    dropPhotos_(readOpt_('task_photos').filter(function (ph) { return ids[String(ph.task_id)]; }));
    gone.sort(function (a, b) { return b._row - a._row; }).forEach(function (x) { deleteRow_('tasks', x._row); });
    logHistory_(me.email, taskId, 'delete', String(t.title) + ' ' + hm_(Number(t.start_ms)) + '–' + hm_(Number(t.end_ms)) + (more ? '（以降の繰り返しタスク ' + more + ' 件も）' : ''), null);
  });
  // カレンダーの予定は、シートを書き終えてから消す（数が多いと時間がかかるので、ほかの人の操作を待たせない）
  events.forEach(removeEvent_);
  const problems = others.map(syncEvent_).filter(String);
  const state = getState();
  state.notice = problems.concat(more ? ['以降の繰り返しタスク ' + more + ' 件も削除しました'] : []).join(' / ');
  return state;
}

/** タスクを開始・完了にする（本人か管理者）。 */
/**
 * 遅延を連絡する（担当のメンバー本人）。「約 N 分遅れます」を履歴に残し、管理者にメールで知らせる。
 * 連絡があったタスクには、自動の遅延の知らせ（見張り）を重ねて出さない。
 */
function reportLate(id, input) {
  const key = input && input.key;
  const me = me_(key);
  const taskId = text_(id, 40);
  const minutes = Math.round(Number(input && input.minutes));
  const note = text_(input && input.note, 200);
  if (!(minutes >= 1 && minutes <= 480)) throw new Error('遅延時間を選択してください。');
  let task = null;
  withLock_(function () {
    const t = findTask_(taskId);
    if (!t) throw new Error('タスクが見つかりません。');
    if (!isMember_(me) || t.member_email !== me.email) throw new Error('このタスクの担当ではありません。');
    if (t.status !== 'planned') throw new Error('このタスクはすでに開始されています。');
    const now = Date.now();
    // 続けて何度も送れないようにする（管理者へのメールが増えすぎないように）
    const recent = readTail_('history', 200).some(function (h) {
      return String(h.task_id) === taskId && String(h.action) === 'late' && String(h.email) === me.email && now - Number(h.time_ms) < 60000;
    });
    if (recent) throw new Error('連絡は送信済みです。しばらくしてから再度送信してください。');
    setCells_('tasks', t._row, { late_notified_ms: now });
    logHistory_(me.email, taskId, 'late', '約 ' + minutes + ' 分の遅延' + (note ? ' / ' + note : ''), null);
    task = t;
  });
  // 管理者に知らせる。メールが送れなくても、連絡そのもの（履歴）は残っている
  let failed = '';
  try {
    const members = read_('members').filter(isActive_);
    const who = U_((members.filter(function (m) { return String(m.email) === me.email; })[0] || {}).name || me.email);
    const span = hm_(Number(task.start_ms)) + '–' + hm_(Number(task.end_ms));
    const title = U_(String(task.title));
    const subject = '遅延の連絡: ' + title + ' ' + span + '（' + who + '）';
    const url = url_();
    const project = U_(props_().getProperty('PROJECT_NAME') || '');
    members.filter(function (m) { return String(m.role) === 'admin' && isJoined_(m); }).forEach(function (m) {
      try {
        const link = url ? linkFor_(taskId, String(m.email)) : '';
        mail_(String(m.email), subject, [subject, '約 ' + minutes + ' 分遅れます', note ? 'メモ: ' + U_(note) : '', link ? 'タスクを開く: ' + link : ''].filter(String).join('\n'),
          noticeHtml_({ project: project, label: '遅延の連絡', late: true, title: title, sub: span + ' · ' + who,
            rows: [['連絡', '約 ' + minutes + ' 分遅れます'], ['メモ', U_(note)]], link: link }));
      } catch (err) { failed = String(err && err.message ? err.message : err); }
    });
  } catch (err) { failed = String(err && err.message ? err.message : err); }
  const state = getState({ key: key });
  state.notice = failed ? '連絡は記録しましたが、管理者へのメールを送信できませんでした: ' + failed : '';
  return state;
}

function updateTask(id, action, extra) {
  const key = extra && extra.key;
  const me = me_(key);
  const taskId = text_(id, 40);
  if (action !== 'start' && action !== 'done') throw new Error('この操作はできません。');
  withLock_(function () {
    const t = findTask_(taskId);
    if (!t) throw new Error('タスクが見つかりません。');
    // 管理者は、Google アカウントで見分けられた人だけ。それ以外は、参加しているメンバーで、そのタスクの担当の本人だけ
    // （外したメンバー・招待中の人は、前のタスクに名前が残っていても操作できない）
    if (!isAdmin_(me) && (!isMember_(me) || t.member_email !== me.email)) throw new Error('このタスクの担当ではありません。');
    const now = Date.now();
    const cells = {};
    if (action === 'start') {
      if (t.status !== 'planned') throw new Error('このタスクはすでに開始されています。');
      cells.status = 'active';
      cells.started_ms = now;
    } else {
      if (t.status === 'done') throw new Error('このタスクはすでに完了しています。');
      if (t.template_id) {
        const tpl = templateMap_()[String(t.template_id)];
        if (tpl) {
          // 必須の確認は、担当のメンバー本人が完了するときだけ。管理者は空のままでも完了にできる
          const mine = cleanValues_(tpl.fields, extra && extra.values, 'member', t.member_email === me.email);
          if (t.member_email === me.email) {
            const have = {};
            readOpt_('task_photos').forEach(function (ph) { if (String(ph.task_id) === taskId) have[String(ph.field)] = true; });
            tpl.fields.forEach(function (f) { if (f.type === 'photo' && f.required && !have[f.key]) throw new Error('「' + f.label + '」の写真を添付してください。'); });
          }
          const merged = parseJson_(t.values, {});
          Object.keys(mine).forEach(function (k) { merged[k] = mine[k]; });
          cells.values = JSON.stringify(merged);
        }
      }
      cells.status = 'done';
      if (!t.started_ms) cells.started_ms = now;
      cells.done_ms = now;
    }
    const memo = text_(extra && extra.note, 300);
    if (memo) cells.note = memo;
    setCells_('tasks', t._row, cells);
    // 位置情報は、そのタスクで「記録する」になっているときだけ残す。オフのタスクでは、送られてきても捨てる。
    // 残すのは、担当の本人が押したときだけ（管理者が代わりに開始・完了にしたときの位置は、担当の人のものではない）
    const wantGeo = isOn_(t.geo) && String(t.member_email) === String(me.email);
    const geo = wantGeo && extra && extra.geo ? extra.geo : null;
    const geoNote = wantGeo && extra && extra.geoError ? '位置: 取得失敗（' + text_(extra.geoError, 120) + '）' : '';
    logHistory_(me.email, taskId, action, [memo, geoNote].filter(String).join(' / '), geo);
  });
  runRules_(action, findTask_(taskId), { by: me.email });
  return getState({ key: key });
}

// ---------- テンプレート ----------

/** テンプレート（タスクの型）を作る・直す（管理者）。 */
function saveTemplate(input) {
  const me = me_();
  requireAdmin_(me);
  const id = text_(input && input.id, 40);
  const name = text_(input && input.name, 40);
  const board = text_(input && input.board, 40);
  const minutes = Math.round(Number(input && input.minutes) || 60);
  if (!name) throw new Error('テンプレート名を入力してください。');
  if (minutes < 5 || minutes > 1440) throw new Error('所要時間は 5 分〜24 時間の範囲で入力してください。');
  const rawFields = input && Array.isArray(input.fields) ? input.fields : [];
  if (rawFields.length > 20) throw new Error('フィールドは最大 20 個です。');
  const seen = {};
  const fields = rawFields.map(function (f) {
    const label = text_(f && f.label, 30);
    const type = text_(f && f.type, 10);
    if (!label) throw new Error('フィールド名を入力してください。');
    if (FIELD_TYPES.indexOf(type) < 0) throw new Error('「' + label + '」の種類が正しくありません。');
    let key = text_(f && f.key, 12).replace(/[^A-Za-z0-9]/g, '');
    if (!key || seen[key]) key = 'f' + Utilities.getUuid().replace(/-/g, '').slice(0, 7);
    seen[key] = true;
    const out = { key: key, label: label, type: type, by: 'member', required: !!(f && f.required) };
    if (type === 'select' || type === 'multi') {
      const opts = (f && Array.isArray(f.options) ? f.options : []).map(function (o) { return text_(o, 30); }).filter(String).slice(0, 20);
      if (!opts.length) throw new Error('「' + label + '」の選択肢を入力してください。');
      out.options = opts;
    }
    return out;
  });
  withLock_(function () {
    const rows = read_('templates');
    if (board && !read_('boards').some(function (b) { return String(b.name) === board; })) throw new Error('ボードが見つかりません。');
    if (rows.some(function (t) { return String(t.name) === name && String(t.id) !== id && t.active !== false && String(t.active).toLowerCase() !== 'false'; })) {
      throw new Error('同じ名前のテンプレートがあります。');
    }
    const cells = { name: name, board: board, minutes: minutes, fields: JSON.stringify(fields), active: true,
      geo: !!(input && input.geo === true), meet: !!(input && input.meet === true) };
    if (id) {
      const row = rows.filter(function (t) { return String(t.id) === id; })[0];
      if (!row) throw new Error('テンプレートが見つかりません。');
      setCells_('templates', row._row, cells);
    } else {
      cells.id = id_();
      appendObj_('templates', cells);
    }
  });
  return getState();
}

/** テンプレートを消す（管理者）。これまでのタスクの表示のために、行は残して無効にする。 */
function deleteTemplate(id) {
  const me = me_();
  requireAdmin_(me);
  const tid = text_(id, 40);
  withLock_(function () {
    const row = read_('templates').filter(function (t) { return String(t.id) === tid; })[0];
    if (!row) throw new Error('テンプレートが見つかりません。');
    setCells_('templates', row._row, { active: false });
  });
  return getState();
}

// ---------- リンク ----------

/** 2つのタスクをリンクする（管理者）。両方の予定の説明にリンクを書き、希望があればメールで知らせる。 */
function linkTasks(aId, bId, kind, notify) {
  const me = me_();
  requireAdmin_(me);
  const a = text_(aId, 40), b = text_(bId, 40), k = text_(kind, 20);
  if (!a || !b || a === b) throw new Error('別のタスクを選択してください。');
  let ta, tb;
  withLock_(function () {
    ta = findTask_(a);
    tb = findTask_(b);
    if (!ta || !tb) throw new Error('タスクが見つかりません。');
    const dup = read_('links').some(function (l) {
      return (String(l.a_task) === a && String(l.b_task) === b) || (String(l.a_task) === b && String(l.b_task) === a);
    });
    if (dup) throw new Error('この2つのタスクはすでにリンクされています。');
    appendObj_('links', { id: id_(), a_task: a, b_task: b, kind: k, created_by: me.email, created_ms: Date.now() });
    logHistory_(me.email, a, 'link', (k ? k + ' ' : '') + String(tb.title) + ' ' + hm_(Number(tb.start_ms)) + '–' + hm_(Number(tb.end_ms)), null);
    logHistory_(me.email, b, 'link', (k ? k + ' ' : '') + String(ta.title) + ' ' + hm_(Number(ta.start_ms)) + '–' + hm_(Number(ta.end_ms)), null);
  });
  const problems = [syncEvent_(a), syncEvent_(b)].filter(String);
  if (notify) {
    const mail = notifyLink_(ta, tb, k);
    if (mail) problems.push(mail);
  }
  const state = getState();
  state.notice = problems.join(' / ');
  return state;
}

/** リンクを外す（管理者）。 */
function unlinkTasks(linkId) {
  const me = me_();
  requireAdmin_(me);
  const id = text_(linkId, 40);
  let a = '', b = '';
  withLock_(function () {
    const l = read_('links').filter(function (x) { return String(x.id) === id; })[0];
    if (!l) throw new Error('リンクが見つかりません。');
    a = String(l.a_task); b = String(l.b_task);
    deleteRow_('links', l._row);
    logHistory_(me.email, a, 'unlink', '', null);
    logHistory_(me.email, b, 'unlink', '', null);
  });
  const problems = [syncEvent_(a), syncEvent_(b)].filter(String);
  const state = getState();
  state.notice = problems.join(' / ');
  return state;
}

function notifyLink_(ta, tb, kind) {
  try {
    const url = url_();
    const line = function (t) { return U_(String(t.title)) + ' ' + hm_(Number(t.start_ms)) + '–' + hm_(Number(t.end_ms)); };
    const project = U_(props_().getProperty('PROJECT_NAME') || '');
    const span = function (t) { return hm_(Number(t.start_ms)) + '–' + hm_(Number(t.end_ms)); };
    kind = U_(kind);
    const send = function (mine, other) {
      if (!mine.member_email) return;
      const link = url ? linkFor_(mine.id, mine.member_email) : '';
      mail_(String(mine.member_email),
        'タスクがリンクされました: ' + line(mine),
        ['あなたのタスク: ' + line(mine),
          'リンク先' + (kind ? '（' + kind + '）' : '') + ': ' + line(other),
          link ? 'タスクを開く: ' + link : ''].filter(String).join('\n'),
        noticeHtml_({ project: project, label: 'リンク', title: U_(String(mine.title)), sub: span(mine),
          rows: [['リンク先', line(other)], ['メモ', kind]], link: link }));
    };
    send(ta, tb);
    if (String(tb.member_email) !== String(ta.member_email)) send(tb, ta);
    return '';
  } catch (err) {
    return 'メールを送信できませんでした: ' + String(err && err.message ? err.message : err);
  }
}

// ---------- ルール ----------

/** ルールのオン・オフを切り替える（管理者）。 */
function setRule(id, enabled) {
  const me = me_();
  requireAdmin_(me);
  const ruleId = text_(id, 40);
  let late = false;
  withLock_(function () {
    const r = read_('rules').filter(function (x) { return String(x.id) === ruleId; })[0];
    if (!r) throw new Error('通知が見つかりません。');
    setCells_('rules', r._row, { enabled: !!enabled });
    logHistory_(me.email, '', 'setting', '通知「' + (WHENS[String(r.when)] || String(r.when)) + '」を' + (enabled ? 'オン' : 'オフ'), null);
    late = String(r.when) === 'late' && !!enabled;
  });
  return withTickNote_(getState(), late);
}

/** 遅延のルールをオンにしたのに見張りを置けなかったら、その場で知らせる。 */
function withTickNote_(state, late) {
  if (late && state.tick && state.tick.want && !state.tick.on) state.notice = '遅延の通知は、現在、画面を開いている間のみ動作します（' + state.tick.why + '）';
  return state;
}

/** ルールを追加する（管理者）。 */
function addRule(input) {
  const me = me_();
  requireAdmin_(me);
  const when = text_(input && input.when, 20);
  const then = (input && input.then && input.then.length ? input.then : []).map(function (s) { return text_(s, 30); });
  if (!WHENS[when]) throw new Error('通知の条件を選択してください。');
  if (!then.length || then.some(function (a) { return !THENS[a]; })) throw new Error('通知先を選択してください。');
  withLock_(function () {
    appendObj_('rules', { id: id_(), when: when, then: then.join(','), enabled: true });
    logHistory_(me.email, '', 'setting', '通知「' + WHENS[when] + '」を追加', null);
  });
  return withTickNote_(getState(), when === 'late');
}

/** ルールを消す（管理者）。 */
function deleteRule(id) {
  const me = me_();
  requireAdmin_(me);
  const ruleId = text_(id, 40);
  withLock_(function () {
    const r = read_('rules').filter(function (x) { return String(x.id) === ruleId; })[0];
    if (!r) throw new Error('通知が見つかりません。');
    deleteRow_('rules', r._row);
    logHistory_(me.email, '', 'setting', '通知「' + (WHENS[String(r.when)] || String(r.when)) + '」を削除', null);
  });
  return getState();
}

/**
 * きっかけに合うルールを動かす。動作は「誰かにメールで知らせる」。
 * メールが失敗しても、元の操作（開始・完了など）は止めない。結果は履歴に残す。
 */
function runRules_(when, t, o) {
  try {
    if (!t) return;
    const by = o && o.by ? String(o.by) : '';
    const rules = readOpt_('rules').filter(function (r) { return String(r.when) === when && isOn_(r.enabled); });
    if (!rules.length) return;
    const members = read_('members').filter(isActive_);
    const names = {};
    members.forEach(function (m) { names[String(m.email)] = String(m.name); });
    const taskOf = {};
    const add = function (email, taskId) { if (email && !taskOf[email]) taskOf[email] = taskId; };
    rules.forEach(function (r) {
      String(r.then).split(',').forEach(function (a) {
        const act = a.trim();
        if (act === 'notify_member') add(String(t.member_email || ''), String(t.id));
        if (act === 'notify_admin') members.forEach(function (m) { if (String(m.role) === 'admin') add(String(m.email), String(t.id)); });
        if (act === 'notify_linked') {
          const tasks = read_('tasks');
          readOpt_('links').forEach(function (l) {
            const otherId = String(l.a_task) === String(t.id) ? String(l.b_task) : String(l.b_task) === String(t.id) ? String(l.a_task) : '';
            const o = otherId && tasks.filter(function (x) { return String(x.id) === otherId; })[0];
            if (o && o.member_email) add(String(o.member_email), String(o.id));
          });
        }
      });
    });
    // その操作をした本人には送らない（自分で割り当てた・自分で完了にした、の知らせは要らない）
    const to = Object.keys(taskOf).filter(function (email) { return email !== by; });
    if (!to.length) return;
    const url = url_();
    const who = t.member_email ? U_(names[t.member_email] || String(t.member_email)) : '未割り当て';
    const span = whenText_(t);
    const what = TX_(WHENS[when], 'mail');
    const title = U_(String(t.title));
    const subject = what + ': ' + title + ' ' + span + '（' + who + '）';
    // メールに添える行: 繰り返しの内容、住所、メモ。完了のときは、報告の中身も
    const rows = [['変更内容', o && o.change ? o.change : ''], ['繰り返し', o && o.series ? o.series : ''], ['住所', U_(String(t.address || ''))], ['メモ', U_(memoOf_(t))]].concat(when === 'done' ? reportRows_(t) : []);
    let failed = '';
    const project = U_(props_().getProperty('PROJECT_NAME') || '');
    to.forEach(function (email) {
      try {
        const link = url ? linkFor_(taskOf[email], email) : '';
        mail_(email, subject, [subject].concat(rows.filter(function (r) { return r[1]; }).map(function (r) { return r[0] + ': ' + r[1]; }),
          [link ? 'タスクを開く: ' + link : '']).filter(String).join('\n'),
          noticeHtml_({ project: project, label: what, late: when === 'late', title: title,
            sub: span + ' · ' + who, rows: rows, link: link }));
      } catch (err) {
        failed = String(err && err.message ? err.message : err);
      }
    });
    logHistory_('rule', String(t.id), 'rule',
      WHENS[when] + ' → ' + to.map(function (e) { return names[e] || e; }).join('・') + (failed ? '（メール送信に失敗: ' + failed + '）' : ''), null);
  } catch (err) {
    try { logHistory_('rule', t ? String(t.id) : '', 'rule', '通知の実行に失敗: ' + String(err && err.message ? err.message : err), null); } catch (e2) { /* 履歴も書けない場合はあきらめる */ }
  }
}

/** メールに書く日時。今日でなければ、日付と曜日を付ける（割り当ては、先の日のタスクのことが多い）。 */
function whenText_(t) {
  const a = Number(t.start_ms), d = new Date(a);
  const day = dayRange_();
  return (a >= day[0] && a < day[1] ? '' : (d.getMonth() + 1) + '/' + d.getDate() + '（' + wd_()[d.getDay()] + '） ') + hm_(a) + '–' + hm_(Number(t.end_ms));
}

/** 完了の知らせに添える、報告の中身（実際の時刻・稼働時間・報告メモ・フィールドの値・写真の枚数）。 */
function reportRows_(t) {
  const rows = [];
  const a = Number(t.started_ms) || 0, b = Number(t.done_ms) || 0;
  if (a && b) rows.push(['稼働', hm_(a) + '–' + hm_(b) + '（' + Math.max(0, Math.round((b - a) / 60000)) + ' 分）']);
  rows.push(['報告メモ', U_(String(t.note || ''))]);
  const tpl = t.template_id ? templateMap_()[String(t.template_id)] : null;
  const values = parseJson_(t.values, {});
  if (tpl) tpl.fields.forEach(function (f) {
    if (f.type === 'photo') return;
    const v = values[f.key];
    rows.push([U_(String(f.label)), U_(v == null ? '' : Array.isArray(v) ? v.join('・') : String(v))]);
  });
  const photos = readOpt_('task_photos').filter(function (ph) { return ph.id && String(ph.task_id) === String(t.id); }).length;
  if (photos) rows.push(['写真', photos + ' 枚']);
  return rows;
}

/** 開始が遅れているタスクを見つけて、1回だけルールを動かす。動かしたら true。 */
function fireLate_(allTasks) {
  const now = Date.now();
  const day = dayRange_();
  const late = allTasks.filter(function (t) {
    return t.id && t.status === 'planned' && t.member_email && !t.late_notified_ms &&
      Number(t.start_ms) >= day[0] && now > Number(t.start_ms) + LATE_MS;
  });
  if (!late.length) return false;
  const fired = [];
  withLock_(function () {
    late.forEach(function (x) {
      const t = findTask_(String(x.id));
      if (!t || t.late_notified_ms || t.status !== 'planned') return;
      setCells_('tasks', t._row, { late_notified_ms: now });
      fired.push(t);
    });
  });
  fired.forEach(function (t) { runRules_('late', t); });
  return fired.length > 0;
}

// ---------- 見張り（画面を開いていなくても、遅延のルールを動かす） ----------

const TICK_MINUTES = 5;
const TICK_SCOPE = 'https://www.googleapis.com/auth/script.scriptapp';
const NEED_AUTH = '承認が必要です（エディタで authorize を実行）';

/** 遅延のルールが 1 つでもオンか。 */
function wantsTick_() {
  return readOpt_('rules').some(function (r) { return r.id && String(r.when) === 'late' && isOn_(r.enabled); }) ||
    readOpt_('tasks').some(function (t) { return t.id && String(t.event_id) === EVENT_WAIT; });
}

/**
 * 時間で動く仕組み（トリガー）を、遅延のルールがオンのあいだだけ置く。5 分おきに tick が動く。
 * 置けなかったら理由を返す（置けた・要らないなら ''）。置けない理由は覚えておき、15 秒おきの更新のたびに同じことを試さない。
 * force: 覚えている理由に関わらず、置き直す（ルールを変えたとき、authorize を実行したとき、見張りが止まっていそうなとき）。
 */
function syncTick_(force) {
  const p = props_();
  const want = wantsTick_();
  const id = p.getProperty('TICK_ID') || '';
  if (!force) {
    if (want && id) return '';
    if (!want && !id) return '';
    if (want && p.getProperty('TICK_WHY')) return p.getProperty('TICK_WHY');
  }
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); });
    if (want) {
      const t = ScriptApp.newTrigger('tick').timeBased().everyMinutes(TICK_MINUTES).create();
      p.setProperty('TICK_ID', String(t.getUniqueId()));
      p.setProperty('TICK_SET', String(Date.now()));
    } else if (id) {
      p.deleteProperty('TICK_ID');
    }
    if (p.getProperty('TICK_WHY')) p.deleteProperty('TICK_WHY');
    return '';
  } catch (err) {
    const why = needsAuth_(TICK_SCOPE) ? NEED_AUTH : String(err && err.message ? err.message : err).slice(0, 200);
    try { p.setProperty('TICK_WHY', why); if (id) p.deleteProperty('TICK_ID'); } catch (e2) { /* 次の回に任せる */ }
    return want ? why : '';
  }
}

/** 見張りの様子（管理者の画面のいちばん下に出す）。止まっていそうなら置き直す。 */
function tickState_() {
  const p = props_();
  let why = syncTick_(false);
  const id = p.getProperty('TICK_ID') || '';
  const last = Number(p.getProperty('TICK_LAST')) || 0;
  const since = Math.max(last, Number(p.getProperty('TICK_SET')) || 0);
  // 置いてあるはずなのに、4 回ぶん動いていない: 手で消された、などで止まっている。置き直す
  if (id && since && Date.now() - since > TICK_MINUTES * 4 * 60000) why = syncTick_(true);
  return { want: wantsTick_(), on: !!(p.getProperty('TICK_ID')), last: last, why: why, minutes: TICK_MINUTES };
}

/**
 * 5 分おきに、時間で動く仕組みから呼ばれる。開始の時刻を過ぎても始まっていないタスクを探して、遅延のルールを動かす。
 * 画面からも呼べてしまう名前なので、置いたトリガー本人からの呼び出しでなければ何もしない。
 */
function tick(e) {
  const id = props_().getProperty('TICK_ID') || '';
  if (!e || !id || String(e.triggerUid) !== id) return 'skip';
  if (!isReady_()) return 'skip';
  try {
    mem_().fromTick = true;
    props_().setProperty('TICK_LAST', String(Date.now()));
    preload_(['tasks', 'members', 'rules', 'links']);
    const fired = fireLate_(read_('tasks'));
    fillEvents_(read_('tasks'));
    return fired ? 'fired' : 'ok';
  } catch (err) {
    // 失敗を外に出すと、Google から「失敗しました」のメールが毎日届く。記録だけして、次の 5 分後に任せる
    console.log('tick: ' + String(err && err.message ? err.message : err));
    return 'error';
  }
}

// ---------- 報告の写真 ----------
// 元の画像は、公開した人の Google ドライブに置く（このアプリが作ったファイルだけを扱う権限 drive.file。ドライブのほかのファイルは見えない）。
// 画面に出す小さい画像は、スプレッドシート（task_thumbs）に置く。元の画像を開けるのは、ドライブのフォルダを見られる人だけ。

const PHOTO_PER_TASK = 12;
const PHOTO_THUMB_MAX = 45000;    // 小さい画像（文字にした長さ）。1 つのセルに入る大きさにする
const PHOTO_FULL_MAX = 4000000;   // 元の画像（文字にした長さ。約 3MB）
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

// ---------- ドライブのフォルダ ----------
// このアプリがドライブに作るものは、1 つのフォルダにまとめる（権限は drive.file＝このアプリが作ったファイルだけ）。
//   Scurrop - プロジェクト名/
//     稼働リスト - プロジェクト名   … 集計（タスクの一覧の「スプレッドシートで集計」）
//     写真/2026-11/                … 報告の写真（月ごと）
//     書き出し/                    … ボードから書き出した日報・週報・月報
//     過去のデータ/                … 設定から移した、過去の月のデータ
const DIR_PHOTO = '写真';
const DIR_EXPORT = 'レポート';
const DIR_ARCHIVE = 'アーカイブ';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

/** いちばん上のフォルダ（「Scurrop - プロジェクト名」）。なければ作る。消されていたら作り直す。 */
function rootFolder_() {
  const m = mem_();
  if (m.rootDir) return m.rootDir;
  const p = props_();
  const kept = String(p.getProperty('PHOTO_FOLDER') || '');
  if (DRIVE_ID_RE.test(kept)) {
    try { const f = Drive.Files.get(kept, { fields: 'id,trashed' }); if (f && f.id && !f.trashed) return (m.rootDir = kept); } catch (err) { /* 消されていたら、作り直す */ }
  }
  const made = Drive.Files.create({ name: 'Scurrop - ' + (p.getProperty('PROJECT_NAME') || '写真'), mimeType: FOLDER_MIME }, null, { fields: 'id' });
  p.setProperty('PHOTO_FOLDER', String(made.id));
  p.deleteProperty('FOLDERS');
  return (m.rootDir = String(made.id));
}

/**
 * フォルダの中のフォルダ（'写真/2026-11' のように書く。'' はいちばん上）。なければ作る。
 * 作ったフォルダの番号は覚えておく。check が true のときは、覚えている番号がまだ使えるかを 1 つずつ確かめる。
 */
function folder_(path, check) {
  const root = rootFolder_();
  if (!path) return root;
  const p = props_();
  let map = parseJson_(p.getProperty('FOLDERS'), {});
  if (!map || map.root !== root || !map.dirs) map = { root: root, dirs: {} };
  let parent = root, at = '', changed = false;
  path.split('/').forEach(function (name) {
    at = at ? at + '/' + name : name;
    let id = DRIVE_ID_RE.test(String(map.dirs[at] || '')) ? String(map.dirs[at]) : '';
    if (id && check) {
      try { const f = Drive.Files.get(id, { fields: 'id,trashed' }); if (!f || !f.id || f.trashed) id = ''; } catch (err) { id = ''; }
    }
    if (!id) {
      id = String(Drive.Files.create({ name: T_(name), mimeType: FOLDER_MIME, parents: [parent] }, null, { fields: 'id' }).id);
      map.dirs[at] = id;
      changed = true;
    }
    parent = id;
  });
  if (changed) p.setProperty('FOLDERS', JSON.stringify(map));
  return parent;
}

/** フォルダを使う作業。覚えていたフォルダが消されていて失敗したら、確かめ直して、もう一度だけ試す。 */
function inFolder_(path, fn) {
  try { return fn(folder_(path)); } catch (err) { return fn(folder_(path, true)); }
}

function ym_(ms) { const d = new Date(ms); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
function folderUrl_() {
  const id = String(props_().getProperty('PHOTO_FOLDER') || '');
  return DRIVE_ID_RE.test(id) ? 'https://drive.google.com/drive/folders/' + id : '';
}

/** プロジェクト名を変えたら、フォルダと稼働リストの名前も合わせる。できなくても止めない。 */
function renameDrive_(name) {
  try {
    if (typeof Drive === 'undefined') return;
    const root = String(props_().getProperty('PHOTO_FOLDER') || '');
    if (DRIVE_ID_RE.test(root)) Drive.Files.update({ name: 'Scurrop - ' + name }, root);
    const sum = String(props_().getProperty('SUM_FILE') || '');
    if (DRIVE_ID_RE.test(sum)) Drive.Files.update({ name: T_(SUM_LIST) + ' - ' + name }, sum);
  } catch (err) { /* 名前を直せなくても、プロジェクト名の変更は通す */ }
}

/**
 * ドライブのフォルダを整理する（管理者）。前の版でいちばん上に置かれた写真を、月ごとのフォルダ（写真/2026-11）に移す。
 * 返すのは { moved, left（時間切れで残った数）, failed, url }。
 */
function tidyDrive() {
  const me = me_();
  requireAdmin_(me);
  if (typeof Drive === 'undefined') throw new Error('Drive  サービスが有効になっていません。');
  const t0 = Date.now();
  const out = { moved: 0, left: 0, failed: 0, url: '' };
  try {
    readOpt_('task_photos').forEach(function (ph) {
      const id = String(ph.file_id || '');
      if (!ph.id || !DRIVE_ID_RE.test(id)) return;
      if (Date.now() - t0 > 20000) { out.left++; return; }
      try {
        const f = Drive.Files.get(id, { fields: 'id,parents,trashed' });
        if (!f || f.trashed) return;
        const want = folder_(DIR_PHOTO + '/' + ym_(Number(ph.time_ms) || Date.now()), !out.moved && !out.failed);
        const now = f.parents || [];
        if (now.length === 1 && now[0] === want) return;
        Drive.Files.update({}, id, null, { addParents: want, removeParents: now.join(',') });
        out.moved++;
      } catch (err) { out.failed++; }
    });
  } catch (err) {
    throw new Error(needsAuth_(DRIVE_SCOPE) ? NEED_AUTH : 'フォルダを整理できませんでした: ' + String(err && err.message ? err.message : err).slice(0, 160));
  }
  out.url = folderUrl_();
  if (out.moved) withLock_(function () { logHistory_(me.email, '', 'setting', 'ドライブのフォルダを整理（写真 ' + out.moved + ' 枚を月別フォルダへ移動）', null); });
  return out;
}

/** 元の画像をドライブに保存する。返すのは { id, error }。保存できなくても、止めない（小さい画像だけが残る）。 */
function savePhotoFile_(name, dataUrl) {
  try {
    if (typeof Drive === 'undefined') throw new Error('Drive  サービスが有効になっていません');
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new Error('画像を読み込めませんでした');
    const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
    // 写真は、月ごとのフォルダに入れる（写真/2026-11）
    const f = clock_('drive', function () { return inFolder_(DIR_PHOTO + '/' + ym_(Date.now()), function (folder) { return Drive.Files.create({ name: name, parents: [folder] }, blob, { fields: 'id' }); }); });
    if (!f || !DRIVE_ID_RE.test(String(f.id))) throw new Error('保存結果を確認できませんでした');
    return { id: String(f.id), error: '' };
  } catch (err) {
    return { id: '', error: needsAuth_(DRIVE_SCOPE) ? NEED_AUTH : String(err && err.message ? err.message : err).slice(0, 200) };
  }
}

/** 写真の行と、ドライブのファイルを片付ける（ファイルはゴミ箱へ。戻せる）。 */
function dropPhotos_(rows) {
  if (!rows.length) return;
  const ids = {};
  rows.forEach(function (r) { ids[String(r.id)] = true; });
  rows.slice().sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { deleteRow_('task_photos', r._row); });
  readOpt_('task_thumbs').filter(function (x) { return ids[String(x.id)]; }).sort(function (a, b) { return b._row - a._row; }).forEach(function (x) { deleteRow_('task_thumbs', x._row); });
  rows.forEach(function (r) {
    if (!DRIVE_ID_RE.test(String(r.file_id || ''))) return;
    try { Drive.Files.update({ trashed: true }, String(r.file_id)); } catch (err) { /* 片付けられなくても止めない */ }
  });
}

/** そのタスクの写真を足してよい人か（担当の本人か、管理者）。だめなら断る。 */
function photoTask_(me, taskId, forWrite) {
  const t = findTask_(taskId);
  if (!t) throw new Error('タスクが見つかりません。');
  const admin = me.role === 'admin' && me.via === 'account';
  if (!admin && (me.role !== 'member' && me.role !== 'admin' || t.member_email !== me.email)) throw new Error('このタスクの担当ではありません。');
  if (forWrite && !admin && String(t.status) === 'done') throw new Error('完了したタスクには写真を追加できません。');
  return t;
}

/** 報告に写真を足す（担当の本人か、管理者）。input: { field, thumb, full, key } */
function addTaskPhoto(id, input) {
  const key = input && input.key;
  const me = me_(key);
  const taskId = text_(id, 40);
  const fieldKey = text_(input && input.field, 12);
  const thumb = image_(input && input.thumb, PHOTO_THUMB_MAX, '写真');
  const full = String(input && input.full || '');
  if (!thumb) throw new Error('写真を読み込めませんでした。');
  if (full.length > PHOTO_FULL_MAX || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(full)) throw new Error('写真のサイズが大きすぎるか、読み込めませんでした。');
  preload_(['tasks', 'templates', 'task_photos', 'members']);
  const check = function () {
    const t = photoTask_(me, taskId, true);
    const tpl = t.template_id ? templateMap_()[String(t.template_id)] : null;
    const f = tpl ? tpl.fields.filter(function (x) { return x.key === fieldKey && x.type === 'photo'; })[0] : null;
    if (!f) throw new Error('このタスクには写真フィールドがありません。');
    if (readOpt_('task_photos').filter(function (ph) { return String(ph.task_id) === taskId; }).length >= PHOTO_PER_TASK) throw new Error('写真は 1 タスクにつき最大 ' + PHOTO_PER_TASK + ' 枚です。');
    return t;
  };
  const t = check();
  // 元の画像は、順番待ち（ロック）の外でドライブに置く（時間がかかるため）
  const now = new Date();
  const stamp = ymdText_(ymd_(now.getTime())) + '_' + hm_(now.getTime()).replace(':', '');
  const ext = /^data:image\/png/.test(full) ? 'png' : /^data:image\/webp/.test(full) ? 'webp' : 'jpg';
  const saved = savePhotoFile_(stamp + '_' + String(t.title).replace(/[\\/:*?"<>|\r\n]/g, ' ').slice(0, 40) + '.' + ext, full);
  const pid = id_();
  withLock_(function () {
    check();
    appendObj_('task_photos', { id: pid, task_id: taskId, field: fieldKey, email: me.email, time_ms: now.getTime(), file_id: saved.id });
    appendObj_('task_thumbs', { id: pid, data: thumb });
    logHistory_(me.email, taskId, 'photo', '写真を追加' + (saved.id ? '' : '（ドライブへの保存に失敗、サムネイルのみ）'), null);
  });
  return { photo: { id: pid, field: fieldKey, email: me.email, time: now.getTime(), url: saved.id ? 'https://drive.google.com/file/d/' + saved.id + '/view' : '', thumb: thumb },
    notice: saved.error ? '元画像をドライブに保存できませんでした（サムネイルのみ保存）: ' + saved.error : '' };
}

/** そのタスクの写真を読む（担当の本人か、管理者）。 */
function getTaskPhotos(id, key) {
  const me = me_(key);
  const taskId = text_(id, 40);
  preload_(['tasks', 'task_photos', 'task_thumbs', 'members']);
  photoTask_(me, taskId, false);
  const data = {};
  readOpt_('task_thumbs').forEach(function (x) { data[String(x.id)] = String(x.data || ''); });
  return readOpt_('task_photos').filter(function (ph) { return ph.id && String(ph.task_id) === taskId; })
    .sort(function (a, b) { return Number(a.time_ms) - Number(b.time_ms); })
    .map(function (ph) {
      const th = data[String(ph.id)] || '';
      return { id: String(ph.id), field: String(ph.field), email: String(ph.email), time: Number(ph.time_ms),
        url: DRIVE_ID_RE.test(String(ph.file_id || '')) ? 'https://drive.google.com/file/d/' + String(ph.file_id) + '/view' : '',
        thumb: /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(th) ? th : '' };
    });
}

/** 写真を消す（担当の本人は完了するまで。管理者はいつでも）。ドライブのファイルはゴミ箱に入る。 */
function removeTaskPhoto(photoId, key) {
  const me = me_(key);
  const pid = text_(photoId, 40);
  let taskId = '';
  withLock_(function () {
    const ph = readOpt_('task_photos').filter(function (x) { return String(x.id) === pid; })[0];
    if (!ph) throw new Error('写真が見つかりません。');
    taskId = String(ph.task_id);
    photoTask_(me, taskId, true);
    dropPhotos_([ph]);
    logHistory_(me.email, taskId, 'photo', '写真を削除', null);
  });
  return getTaskPhotos(taskId, key);
}

// ---------- 集計（スプレッドシートの側で見る） ----------
// まとめて俯瞰するのは、スプレッドシートの得意なところ。この画面では作り込まず、スプレッドシートに用意して、画面からそこを開く
// ばらばらのシート（タスク・メンバー・ボード・テンプレート・履歴・リンク・写真）を、1 枚のリストに統合する
// どのボードのだれが、いつ、どれくらい稼働したか。報告のフィールドの値・場所・写真も、同じ行に並べる。
//   「稼働リスト」… タスクごとの 1 行。絞り込み・並べ替えができる
//   「サマリー」  … 月・ボード・メンバーごとの、稼働日数・タスク・完了・稼働時間・遅延（ピボットテーブル）

const SUM_LIST = '稼働リスト';
const SUM_VIEW = 'サマリー';
const SUM_OLD = ['集計データ', '集計']; // 前の版の名前（見つけたら片付ける）
const SUM_COLS = ['月', '日付', '曜日', 'ボード', 'メンバー', 'ロール', 'タスク', 'テンプレート', 'ステータス', '予定開始', '予定終了', '実績開始', '完了',
  '稼働時間（分）', '稼働時間（時間）', '遅延（分）', '当日のシフト', 'シフト内外', 'シフト外稼働（分）', '住所', 'メモ', '報告メモ', '開始場所', '完了場所', '写真（枚）', '写真', 'Meet', 'リンク先',
  '完了数', '稼働日', '遅延（回）'];
const SUM_HELPERS = 3;   // 終わりの 3 列（完了数・稼働日・遅延（回））は、サマリーの計算に使う。リストでは隠す
const SUM_FIELDS_MAX = 30;
const SUM_WD = ['日', '月', '火', '水', '木', '金', '土'];

/** スプレッドシートの URL。開かずに、番号から組み立てる。 */
function sheetUrl_(gid) {
  const id = props_().getProperty('SHEET_ID') || '';
  return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' + (gid === undefined || gid === null ? '' : '#gid=' + gid) : '';
}

/**
 * 稼働リストの中身を作る。返すのは { head, rows, links }。
 * rows は文字と数だけ（式は入れない）。links は、あとから「地図」「開く」などの短い字に置き換えるリンクの場所 [行, 列, 字, URL]。
 */
function summaryData_(range) {
  const members = {};
  read_('members').forEach(function (x) { members[String(x.email)] = { name: String(x.name), board: String(x.board || ''), role: String(x.role) === 'admin' ? '管理者' : 'メンバー' }; });
  const tpls = {};
  const fieldCols = [];
  readOpt_('templates').forEach(function (t) {
    if (!t.id) return;
    const p = pubTemplate_(t);
    tpls[p.id] = p;
    p.fields.forEach(function (f) { if (f.type !== 'photo' && fieldCols.indexOf(f.label) < 0 && fieldCols.length < SUM_FIELDS_MAX) fieldCols.push(f.label); });
  });
  const tasks = read_('tasks').filter(function (t) { return t.id && Number(t.start_ms) && (!range || (range.only ? !!range.only[String(t.id)] : (Number(t.end_ms) >= range.from && Number(t.start_ms) < range.to))); })
    .sort(function (a, b) { return Number(a.start_ms) - Number(b.start_ms); });
  const shiftRows = readOpt_('shifts').filter(function (x) { return x.id; });
  const shiftCache = {};
  // その人の、当日のシフト（[開始, 終了] の並び）
  const shiftsFor = function (email, ms) {
    const d = new Date(ms);
    const day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const list = shiftCache[day0] || (shiftCache[day0] = shiftsOn_(day0, shiftRows));
    return list.filter(function (x) { return x.member === email; }).sort(function (a, b) { return a.start - b.start; });
  };
  const info = [];
  const byId = {};
  tasks.forEach(function (t) { byId[String(t.id)] = t; });
  // 開始・完了のときの場所（履歴から）
  const spots = {};
  read_('history').forEach(function (h) {
    const a = String(h.action);
    if ((a !== 'start' && a !== 'done') || !byId[String(h.task_id)]) return;
    const g = geoOf_(h);
    if (g) (spots[String(h.task_id)] || (spots[String(h.task_id)] = {}))[a] = g;
  });
  // 写真（枚数と、1 枚目の元の画像）
  const photos = {};
  readOpt_('task_photos').forEach(function (ph) {
    if (!ph.id) return;
    const k = String(ph.task_id);
    const x = photos[k] || (photos[k] = { n: 0, file: '' });
    x.n++;
    if (!x.file && DRIVE_ID_RE.test(String(ph.file_id || ''))) x.file = String(ph.file_id);
  });
  // リンク先（相手のタスク名とメンバー）
  const linked = {};
  readOpt_('links').forEach(function (l) {
    const a = byId[String(l.a_task)], b = byId[String(l.b_task)];
    if (!a || !b) return;
    const say = function (o) { return String(o.title) + '（' + (o.member_email ? (members[String(o.member_email)] || {}).name || String(o.member_email) : '未割り当て') + '）'; };
    (linked[String(a.id)] || (linked[String(a.id)] = [])).push(say(b));
    (linked[String(b.id)] || (linked[String(b.id)] = [])).push(say(a));
  });
  const label = { planned: '予定', active: 'アクティブ', done: '完了' };
  const head = SUM_COLS.slice(0, SUM_COLS.length - SUM_HELPERS).concat(fieldCols, SUM_COLS.slice(SUM_COLS.length - SUM_HELPERS));
  const col = function (name) { return head.indexOf(name) + 1; };
  const links = [];
  const rows = tasks.map(function (t, i) {
    const email = String(t.member_email || '');
    const m = members[email] || { name: email || '未割り当て', board: '', role: '' };
    const start = Number(t.start_ms), end = Number(t.end_ms), started = Number(t.started_ms) || 0;
    const done = String(t.status) === 'done' ? (Number(t.done_ms) || 0) : 0;
    const mins = done ? Math.max(0, Math.round((done - (started || done)) / 60000)) : 0;
    const late = started ? Math.max(0, Math.round((started - start) / 60000)) : 0;
    const day = ymdText_(ymd_(start));
    const tpl = t.template_id ? tpls[String(t.template_id)] : null;
    const values = parseJson_(t.values, {});
    const sp = spots[String(t.id)] || {};
    const ph = photos[String(t.id)] || { n: 0, file: '' };
    const meet = meetUrl_(t);
    const mapOf = function (g) { return g ? 'https://www.google.com/maps/search/?api=1&query=' + g.lat + ',' + g.lng : ''; };
    const file = ph.file ? 'https://drive.google.com/file/d/' + ph.file + '/view' : '';
    // シフトとの関係。完了していれば実際の時刻（開始〜完了）、まだなら予定の時刻で見る
    const sh = email ? shiftsFor(email, start) : [];
    const w0 = done ? (started || done) : start, w1 = done ? done : end;
    let inside = 0;
    sh.forEach(function (x) { inside += Math.max(0, Math.min(w1, x.end) - Math.max(w0, x.start)); });
    inside = Math.min(inside, Math.max(0, w1 - w0));
    const outMs = Math.max(0, (w1 - w0) - inside);
    const rel = !email ? '' : !sh.length ? 'シフトなし' : outMs < 60000 ? 'シフト内' : inside < 60000 ? 'シフト外' : '一部シフト外';
    const outMins = done && email ? Math.round((sh.length ? outMs : (w1 - w0)) / 60000) : 0;
    info.push({ email: email, name: m.name, board: m.board, role: m.role, day: day, mins: mins, out: outMins, done: !!done, worked: !!(started || done), late: late > 0 });
    const r = i + 2;
    if (sp.start) links.push([r, col('開始場所'), '地図', mapOf(sp.start)]);
    if (sp.done) links.push([r, col('完了場所'), '地図', mapOf(sp.done)]);
    if (file) links.push([r, col('写真'), '開く', file]);
    if (meet) links.push([r, col('Meet'), 'Meet', meet]);
    const fixed = [cell_(day.slice(0, 7)), cell_(day), wd_()[new Date(start).getDay()], cell_(m.board || (email ? 'デフォルト' : '')), cell_(m.name), m.role, cell_(String(t.title)),
      cell_(tpl ? tpl.name : ''), label[String(t.status)] || cell_(String(t.status)), cell_(hm_(start)), cell_(hm_(end)), started ? cell_(hm_(started)) : '', done ? cell_(hm_(done)) : '',
      mins, Math.round(mins / 6) / 10, late,
      email ? (sh.length ? cell_(sh.map(function (x) { return hm_(x.start) + '–' + hm_(x.end); }).join('、')) : 'なし') : '', rel, outMins,
      cell_(String(t.address || '')), cell_(memoOf_(t)), cell_(String(t.note || '')),
      mapOf(sp.start), mapOf(sp.done), ph.n, file, meet, cell_((linked[String(t.id)] || []).join('、'))];
    const fields = fieldCols.map(function (lb) {
      const f = tpl ? tpl.fields.filter(function (x) { return x.label === lb && x.type !== 'photo'; })[0] : null;
      const v = f ? values[f.key] : '';
      if (v === undefined || v === null || v === '') return '';
      if (Array.isArray(v)) return cell_(v.join('・'));
      return typeof v === 'number' ? v : cell_(String(v));
    });
    return fixed.concat(fields, [done ? 1 : 0, started || done ? cell_(day) : '', late > 0 ? 1 : 0]);
  });
  return { head: head, rows: rows, links: links, info: info, shiftRows: shiftRows };
}

/** 見た目を整える 1 つの手順。失敗しても止めず、何ができなかったかを notes に残す（リストの中身は、もう書けている）。 */
function deco_(notes, what, fn) {
  try { fn(); } catch (err) { notes.push(what + ': ' + String(err && err.message ? err.message : err).slice(0, 120)); }
}

/** ファイルの名前に付ける、プロジェクトの名前。 */
function projectTitle_() { return props_().getProperty('PROJECT_NAME') || book_().getName(); }

/** スプレッドシートの URL（番号から組み立てる）。 */
function bookUrl_(id, gid) {
  return id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' + (gid === undefined || gid === null ? '' : '#gid=' + gid) : '';
}

/**
 * リストを 1 枚のシートに書いて、見た目を整える。返すのは { sheet, all（見出しを含む全体の範囲） }。
 * hide: 終わりから何列を隠すか（サマリーの計算に使う列）。
 */
function fillList_(ss, name, d, notes, hide) {
  const n = d.head.length;
  // 見出しと、決まった言い回しのセル（状態・ロールなど）は、プロジェクトの言語で書く。利用者が入れた文字は、そのまま
  const values = [d.head.map(function (c) { return T_(TX_(c, 'col')); })].concat(lang_() === 'ja' ? d.rows : d.rows.map(function (r) { return r.map(X_); }));
  const colOf = function (label) { return d.head.indexOf(label) + 1; };
  const list = ss.getSheetByName(T_(name)) || ss.insertSheet(T_(name));
  deco_(notes, '絞り込みの解除', function () { const f = list.getFilter(); if (f) f.remove(); });
  deco_(notes, 'しま模様の解除', function () { list.getBandings().forEach(function (b) { b.remove(); }); });
  list.clearContents();
  list.getRange(1, 1, values.length, n).setValues(values);
  // ここから下は見た目。1 つずつ試し、できなかったものは理由を返す
  const all = list.getRange(1, 1, values.length, n);
  deco_(notes, '見出し', function () { list.getRange(1, 1, 1, n).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(NAVY).setVerticalAlignment('middle'); });
  deco_(notes, '見出しの固定', function () { list.setFrozenRows(1); if (colOf('メンバー') > 0) list.setFrozenColumns(colOf('メンバー')); });
  if (d.rows.length) {
    deco_(notes, 'しま模様', function () { list.getRange(2, 1, d.rows.length, n).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false); });
    deco_(notes, '絞り込み', function () { all.createFilter(); });
    if (d.links && d.links.length) deco_(notes, 'リンク', function () {
      // URL をそのまま出すと長いので、「地図」「開く」などの短い字に置き換える。列ごとに 1 回でまとめて書く（1 マスずつ書くと遅い）
      const byCol = {};
      d.links.forEach(function (x) { (byCol[x[1]] || (byCol[x[1]] = {}))[x[0]] = x; });
      Object.keys(byCol).forEach(function (c) {
        const cells = [];
        for (let r = 2; r <= d.rows.length + 1; r++) {
          const x = byCol[c][r];
          const b = SpreadsheetApp.newRichTextValue().setText(x ? x[2] : '');
          if (x) b.setLinkUrl(x[3]);
          cells.push([b.build()]);
        }
        list.getRange(2, Number(c), d.rows.length, 1).setRichTextValues(cells);
      });
    });
    if (colOf('遅延（分）') > 0) deco_(notes, '遅延の色', function () {
      const rule = SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor('#D70015').setBold(true)
        .setRanges([list.getRange(2, colOf('遅延（分）'), d.rows.length, 1)]).build();
      list.setConditionalFormatRules([rule]);
    });
  }
  deco_(notes, '列の幅', function () { list.autoResizeColumns(1, n); });
  if (hide) deco_(notes, '計算用の列の非表示', function () { list.showColumns(1, n); list.hideColumns(n - hide + 1, hide); });
  return { sheet: list, all: all };
}

/** 作ったスプレッドシートから、要らないシート（初めからある空のシートなど）を外す。 */
function keepSheets_(ss, names, notes) {
  const keep = names.map(T_);
  ss.getSheets().forEach(function (sh) {
    if (keep.indexOf(sh.getName()) < 0) deco_(notes, '不要なシートの削除', function () { ss.deleteSheet(sh); });
  });
}

/**
 * 集計を入れるスプレッドシート（ドライブのフォルダに作る「稼働リスト - プロジェクト名」）。
 * データを入れているスプレッドシートとは別にする（元のデータに、集計のシートを混ぜない）。
 * ドライブに作れないときは、元のスプレッドシートの中に作る（理由を notes に残す）。
 */
function sumBook_(notes) {
  try {
    if (typeof Drive === 'undefined') throw new Error('Drive  サービスが有効になっていません');
    const p = props_();
    let id = String(p.getProperty('SUM_FILE') || '');
    if (DRIVE_ID_RE.test(id)) {
      try { const f = Drive.Files.get(id, { fields: 'id,trashed' }); if (!f || !f.id || f.trashed) id = ''; } catch (err) { id = ''; }
    } else id = '';
    if (!id) {
      id = String(Drive.Files.create({ name: T_(SUM_LIST) + ' - ' + projectTitle_(), mimeType: SHEET_MIME, parents: [rootFolder_()] }, null, { fields: 'id' }).id);
      p.setProperty('SUM_FILE', id);
    }
    return { ss: SpreadsheetApp.openById(id), id: id, own: true };
  } catch (err) {
    notes.push('ドライブに別ファイルを作成できなかったため、データ用スプレッドシート内に作成しました（' +
      (needsAuth_(DRIVE_SCOPE) ? NEED_AUTH : String(err && err.message ? err.message : err).slice(0, 120)) + '）');
    return { ss: book_(), id: props_().getProperty('SHEET_ID') || '', own: false };
  }
}

/**
 * 集計を用意して、開く先を返す（管理者）。「稼働リスト」と「サマリー」を作り直す。
 * 置き場所は、ドライブのフォルダの中の別のスプレッドシート（「稼働リスト - プロジェクト名」）。
 * 返すのは { url（稼働リスト）, viewUrl（サマリー）, rows, cols, pivot, own（別のスプレッドシートに作れたか）, notes（整えられなかったところ） }。
 */
function openSummary() {
  const me = me_();
  requireAdmin_(me);
  const d = summaryData_();
  const n = d.head.length;
  const out = { url: '', viewUrl: '', rows: d.rows.length, cols: n, pivot: false, own: false, notes: [] };
  const colOf = function (name) { return d.head.indexOf(name) + 1; };
  withLock_(function () {
    const bk = sumBook_(out.notes);
    const ss = bk.ss;
    out.own = bk.own;
    const made = fillList_(ss, SUM_LIST, d, out.notes, SUM_HELPERS);
    out.url = bookUrl_(bk.id, made.sheet.getSheetId());
    // サマリー（ピボットテーブル）
    if (d.rows.length) {
      try {
        const view = ss.getSheetByName(T_(SUM_VIEW)) || ss.insertSheet(T_(SUM_VIEW));
        view.getPivotTables().forEach(function (pt) { pt.remove(); });
        view.clearContents();
        const fn = SpreadsheetApp.PivotTableSummarizeFunction;
        const pt = view.getRange(1, 1).createPivotTable(made.all);
        pt.addRowGroup(colOf('月'));
        pt.addRowGroup(colOf('ボード'));
        pt.addRowGroup(colOf('メンバー'));
        pt.addPivotValue(colOf('稼働日'), fn.COUNTUNIQUE).setDisplayName(T_('稼働日数'));
        pt.addPivotValue(colOf('タスク'), fn.COUNTA).setDisplayName(T_('タスク'));
        pt.addPivotValue(colOf('完了数'), fn.SUM).setDisplayName(T_('完了'));
        pt.addPivotValue(colOf('稼働時間（時間）'), fn.SUM).setDisplayName(T_('稼働時間（時間）'));
        pt.addPivotValue(colOf('遅延（回）'), fn.SUM).setDisplayName(T_('遅延（回）'));
        out.viewUrl = bookUrl_(bk.id, view.getSheetId());
        out.pivot = true;
      } catch (err) {
        out.notes.push('サマリー: ' + String(err && err.message ? err.message : err).slice(0, 120));
      }
    }
    // 片付け。別のスプレッドシートに作れたら、元のスプレッドシートに前の版が作った集計のシートを外す
    const main = book_();
    (bk.own ? [SUM_LIST, SUM_VIEW] : []).concat(SUM_OLD).forEach(function (name) {
      const old = main.getSheetByName(name);
      if (old) deco_(out.notes, '旧バージョンのシートの削除', function () { main.deleteSheet(old); });
    });
    if (bk.own) keepSheets_(ss, [SUM_LIST, SUM_VIEW], out.notes);
    logHistory_(me.email, '', 'report', '集計を更新（' + d.rows.length + ' 件）', null);
  });
  return out;
}

/** 稼働リストから、計算用の列（終わりの 3 列）を外したもの。書き出しと、過去のデータに使う。 */
function plainList_(d) {
  const cut = d.head.length - SUM_HELPERS;
  return { head: d.head.slice(0, cut), rows: d.rows.map(function (r) { return r.slice(0, cut); }), links: d.links };
}

// ---------- 書き出し（日報・週報・月報） ----------

/** 書き出す期間。span は day / week / month。返すのは { from, to, days（日の始まりの並び）, label（名前に使う字）, kind }。 */
function exportRange_(dayText, span) {
  const day = dayRange_(dayText);
  let first = new Date(day[0]);
  let count = 1;
  if (span === 'month') { count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(); first = new Date(first.getFullYear(), first.getMonth(), 1); }
  else if (span === 'week') { count = 7; first.setDate(first.getDate() - (first.getDay() + 6) % 7); }
  const days = [];
  for (let i = 0; i < count; i++) days.push(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i).getTime());
  const to = new Date(first.getFullYear(), first.getMonth(), first.getDate() + count).getTime();
  const a = ymdText_(ymd_(days[0])), b = ymdText_(ymd_(days[count - 1]));
  const label = span === 'month' ? a.slice(0, 7) : span === 'week' ? a + '〜' + b.slice(5) : a + '（' + wd_()[new Date(days[0]).getDay()] + '）';
  return { from: days[0], to: to, days: days, label: label, kind: span === 'month' ? '月次データ' : span === 'week' ? '週次データ' : '日次データ' };
}

/**
 * ボードで見ている日・週・月を、スプレッドシートに書き出す（管理者）。
 * ドライブのフォルダの「書き出し」に、「日報 2026-11-17（火） - プロジェクト名」のような名前で作る。同じ期間をもう一度書き出すと、同じファイルを新しくする。
 * 中身: 「メンバー別」（シフト・稼働日数・タスク・完了・稼働時間・シフト外稼働・遅延）、「日ごと」（週・月だけ。メンバー × 日の稼働時間）、「タスク」（その期間のタスクのリスト）。
 * 返すのは { url, name, rows, updated（前のファイルを新しくしたか）, notes }。
 */
function exportBoard(input) {
  const me = me_();
  requireAdmin_(me);
  const span = input && (input.span === 'week' || input.span === 'month') ? input.span : 'day';
  const range = exportRange_(input && input.day, span);
  const name = T_(range.kind + ' ' + range.label) + ' - ' + projectTitle_();
  const out = { url: '', name: name, rows: 0, updated: false, notes: [] };
  const d = summaryData_(range);
  out.rows = d.rows.length;
  // タスクのリスト（計算用の列は付けない）
  const tasks = plainList_(d);
  // メンバー別
  const hours = function (mins) { return Math.round(mins / 6) / 10; };
  const people = read_('members').filter(isJoined_).map(function (m) { return { email: String(m.email), name: String(m.name), board: String(m.board || '') || 'デフォルト', role: String(m.role) === 'admin' ? '管理者' : 'メンバー' }; });
  if (d.info.some(function (x) { return !x.email; })) people.push({ email: '', name: '未割り当て', board: '', role: '' });
  const shiftMins = {};
  range.days.forEach(function (a) { shiftsOn_(a, d.shiftRows).forEach(function (x) { shiftMins[x.member] = (shiftMins[x.member] || 0) + Math.round((x.end - x.start) / 60000); }); });
  const sum = { shift: 0, days: 0, tasks: 0, done: 0, mins: 0, out: 0, late: 0 };
  const perDay = {};
  const byMember = people.map(function (m) {
    const mine = d.info.filter(function (x) { return x.email === m.email; });
    const worked = {};
    let mins = 0, outM = 0, done = 0, late = 0;
    mine.forEach(function (x) {
      if (x.worked) worked[x.day] = true;
      mins += x.mins; outM += x.out; if (x.done) done++; if (x.late) late++;
      const k = m.email + '|' + x.day;
      perDay[k] = (perDay[k] || 0) + x.mins;
    });
    const sh = shiftMins[m.email] || 0;
    sum.shift += sh; sum.days += Object.keys(worked).length; sum.tasks += mine.length; sum.done += done; sum.mins += mins; sum.out += outM; sum.late += late;
    return [cell_(m.board), cell_(m.name), m.role, hours(sh), Object.keys(worked).length, mine.length, done, hours(mins), hours(outM), late];
  });
  byMember.push(['', '合計', '', hours(sum.shift), sum.days, sum.tasks, sum.done, hours(sum.mins), hours(sum.out), sum.late]);
  const memberSheet = { head: ['ボード', 'メンバー', 'ロール', 'シフト（時間）', '稼働日数', 'タスク', '完了', '稼働時間（時間）', 'シフト外稼働（時間）', '遅延（回）'], rows: byMember };
  // 日ごと（週・月）
  let daily = null;
  if (span !== 'day') {
    const cols = range.days.map(function (a) { const dt = new Date(a); return (dt.getMonth() + 1) + '/' + dt.getDate() + '（' + wd_()[dt.getDay()] + '）'; });
    daily = { head: ['ボード', 'メンバー'].concat(cols, ['合計（時間）']), rows: people.map(function (m) {
      let total = 0;
      const line = range.days.map(function (a) { const v = perDay[m.email + '|' + ymdText_(ymd_(a))] || 0; total += v; return v ? hours(v) : ''; });
      return [cell_(m.board), cell_(m.name)].concat(line, [hours(total)]);
    }) };
  }
  withLock_(function () {
    let ss = null, id = '';
    try {
      if (typeof Drive === 'undefined') throw new Error('Drive  サービスが有効になっていません');
      inFolder_(DIR_EXPORT, function (folder) {
        // 同じ名前のファイルがあれば、それを新しくする（探せなければ、新しく作る）
        try {
          const found = Drive.Files.list({ q: "name = '" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + folder + "' in parents and trashed = false", fields: 'files(id,name)', pageSize: 5 });
          const hit = found && found.files && found.files[0];
          if (hit && DRIVE_ID_RE.test(String(hit.id))) { id = String(hit.id); out.updated = true; }
        } catch (err) { /* 探せなければ、新しく作る */ }
        if (!id) id = String(Drive.Files.create({ name: name, mimeType: SHEET_MIME, parents: [folder] }, null, { fields: 'id' }).id);
      });
      ss = SpreadsheetApp.openById(id);
    } catch (err) {
      throw new Error(needsAuth_(DRIVE_SCOPE) ? 'ドライブに出力できませんでした。' + NEED_AUTH : 'ドライブに出力できませんでした: ' + String(err && err.message ? err.message : err).slice(0, 160));
    }
    const names = ['メンバー別'].concat(daily ? ['日別'] : [], ['タスク']);
    const first = fillList_(ss, 'メンバー別', memberSheet, out.notes, 0);
    deco_(out.notes, '合計の行', function () { first.sheet.getRange(memberSheet.rows.length + 1, 1, 1, memberSheet.head.length).setFontWeight('bold'); });
    if (daily) fillList_(ss, '日別', daily, out.notes, 0);
    fillList_(ss, 'タスク', tasks, out.notes, 0);
    keepSheets_(ss, names, out.notes);
    out.url = bookUrl_(id, first.sheet.getSheetId());
    logHistory_(me.email, '', 'report', range.kind + 'を出力（' + range.label + '、' + d.rows.length + ' 件）', null);
  });
  return out;
}

// ---------- 過去のデータを移す ----------
// タスクと履歴は増え続ける。過去の月のデータを、1 か月ずつ、ドライブのフォルダ（過去のデータ）のスプレッドシートに移す。
// 移した月は、ボードにも集計にも出なくなる（移した先のスプレッドシートで見る）。写真の元の画像は、ドライブに残す。

/** 'YYYY-MM' を、その月の始まりと終わり（次の月の始まり）に直す。 */
function monthRange_(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('対象月を確認してください。');
  return { from: new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime(), to: new Date(Number(m[1]), Number(m[2]), 1).getTime(), label: m[0] };
}

/** 移せる月の一覧（管理者）。今月より前で、タスクのある月。active は、進行中で移せないタスクの数。 */
function listArchive() {
  const me = me_();
  requireAdmin_(me);
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const count = {};
  read_('tasks').forEach(function (t) {
    const st = Number(t.start_ms);
    if (!t.id || !st || st >= cur) return;
    const c = count[ym_(st)] || (count[ym_(st)] = { month: ym_(st), tasks: 0, active: 0 });
    if (String(t.status) === 'active') c.active++; else c.tasks++;
  });
  return { months: Object.keys(count).sort().map(function (k) { return count[k]; }), folderUrl: folderUrl_() };
}

/** 行をまとめて消す。続いている行は 1 回で消す（1 行ずつ消すと、数が多いときに時間がかかりすぎる）。 */
function deleteRows_(name, rows) {
  if (!rows.length) return;
  const sh = sheet_(name);
  const sorted = rows.slice().sort(function (a, b) { return b - a; });
  // 見出しのほかに 1 行も残らない消し方は、スプレッドシートが断る。空の行を 1 つ足しておく
  try { if (sh.getMaxRows() - sorted.length < 2) sh.insertRowsAfter(sh.getMaxRows(), 1); } catch (err) { /* 足せなければ、そのまま試す */ }
  let i = 0;
  while (i < sorted.length) {
    let n = 1;
    while (i + n < sorted.length && sorted[i + n] === sorted[i] - n) n++;
    sh.deleteRows(sorted[i] - n + 1, n);
    i += n;
  }
  forget_(name);
}

/**
 * 過去の 1 か月ぶんのデータを、ドライブのスプレッドシートに移す（管理者）。month は 'YYYY-MM'。今月と、先の月は移せない。
 * 移すもの: その月に始まるタスク（進行中のものは残す）、そのタスクの履歴・リンク・写真の記録、その月の、タスクに付かない履歴（設定の変更など）。
 * 移した先: 「過去のデータ/過去のデータ 2026-10 - プロジェクト名」。読むための「稼働リスト」と、元の形のままのシート（tasks・history・links・task_photos）が入る。
 * 先に移した先を書き、行の数を確かめてから、元のスプレッドシートから消す（途中で失敗しても、元のデータは消えない）。
 * 返すのは { url, name, tasks, history, links, photos, kept（進行中で残したタスク）, notes }。
 */
function archiveMonth(month) {
  const me = me_();
  requireAdmin_(me);
  const range = monthRange_(month);
  const now = new Date();
  if (range.to > new Date(now.getFullYear(), now.getMonth(), 1).getTime()) throw new Error('当月以降はアーカイブできません。');
  const out = { url: '', name: '', tasks: 0, history: 0, links: 0, photos: 0, kept: 0, notes: [] };
  withLock_(function () {
    const all = read_('tasks');
    const inMonth = all.filter(function (t) { return t.id && Number(t.start_ms) >= range.from && Number(t.start_ms) < range.to; });
    const moving = inMonth.filter(function (t) { return String(t.status) !== 'active'; });
    out.kept = inMonth.length - moving.length;
    if (!moving.length) throw new Error(out.kept ? '対象月のタスクはすべて進行中です。完了後にアーカイブしてください。' : '対象月のタスクがありません。');
    const ids = {}, remaining = {};
    moving.forEach(function (t) { ids[String(t.id)] = true; });
    all.forEach(function (t) { if (t.id && !ids[String(t.id)]) remaining[String(t.id)] = true; });
    const hist = read_('history').filter(function (h) {
      const tm = Number(h.time_ms);
      return ids[String(h.task_id)] || (tm >= range.from && tm < range.to && !remaining[String(h.task_id)]);
    });
    const links = readOpt_('links').filter(function (l) { return l.id && (ids[String(l.a_task)] || ids[String(l.b_task)]); });
    const photos = readOpt_('task_photos').filter(function (ph) { return ph.id && ids[String(ph.task_id)]; });
    const photoIds = {};
    photos.forEach(function (ph) { photoIds[String(ph.id)] = true; });
    const thumbs = readOpt_('task_thumbs').filter(function (x) { return photoIds[String(x.id)]; });
    const readable = plainList_(summaryData_({ from: range.from, to: range.to, only: ids }));
    // 1. 移した先を作って書く
    let ss = null, id = '';
    try {
      if (typeof Drive === 'undefined') throw new Error('Drive  サービスが有効になっていません');
      inFolder_(DIR_ARCHIVE, function (folder) {
        // 同じ月を前にも移していたら（進行中で残した分を、あとから移すとき）、名前に番号を付けて別のファイルにする
        let name = '';
        for (let n = 1; n <= 20; n++) {
          name = T_(DIR_ARCHIVE + ' ' + range.label + (n > 1 ? '（' + n + '）' : '')) + ' - ' + projectTitle_();
          let taken = false;
          try {
            const found = Drive.Files.list({ q: "name = '" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + folder + "' in parents and trashed = false", fields: 'files(id)', pageSize: 1 });
            taken = !!(found && found.files && found.files.length);
          } catch (err) { /* 探せなければ、そのままの名前で作る（同じ名前のファイルが 2 つになるだけ） */ }
          if (!taken) break;
        }
        id = String(Drive.Files.create({ name: name, mimeType: SHEET_MIME, parents: [folder] }, null, { fields: 'id' }).id);
        out.name = name;
      });
      ss = SpreadsheetApp.openById(id);
    } catch (err) {
      throw new Error(needsAuth_(DRIVE_SCOPE) ? 'ドライブへアーカイブできませんでした。' + NEED_AUTH : 'ドライブへアーカイブできませんでした: ' + String(err && err.message ? err.message : err).slice(0, 160));
    }
    const first = fillList_(ss, SUM_LIST, readable, out.notes, 0);
    // 写真の小さい画像（task_thumbs）も移す。ドライブに元の画像を置けなかった写真は、これだけが残っているため
    const raw = [['tasks', moving], ['history', hist], ['links', links], ['task_photos', photos]].concat(sheet_('task_thumbs') ? [['task_thumbs', thumbs]] : []);
    raw.forEach(function (x) {
      const head = head_(x[0]);
      const values = [head].concat(x[1].map(function (r) { return head.map(function (c) { const v = r[c]; return v === undefined || v === null ? '' : cell_(v); }); }));
      const sh = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
      sh.clearContents();
      sh.getRange(1, 1, values.length, head.length).setValues(values);
      deco_(out.notes, '見出しの固定', function () { sh.setFrozenRows(1); });
    });
    keepSheets_(ss, [SUM_LIST].concat(raw.map(function (x) { return x[0]; })), out.notes);
    // 2. 書けたことを確かめる（行の数が合わなければ、元のデータには手を付けない）
    SpreadsheetApp.flush();
    raw.forEach(function (x) {
      if (ss.getSheetByName(x[0]).getLastRow() !== x[1].length + 1) throw new Error('アーカイブ先の行数が一致しません（' + x[0] + '）。元データは変更していません。');
    });
    // 3. 元のスプレッドシートから消す
    try {
      // タスクは最後に消す。途中で失敗しても、タスクが残っていれば、もう一度移すときに、付いている履歴・リンク・写真をまた拾える
      deleteRows_('task_thumbs', thumbs.map(function (r) { return r._row; }));
      deleteRows_('task_photos', photos.map(function (r) { return r._row; }));
      deleteRows_('links', links.map(function (r) { return r._row; }));
      deleteRows_('history', hist.map(function (r) { return r._row; }));
      deleteRows_('tasks', moving.map(function (r) { return r._row; }));
    } catch (err) {
      touchAll_(); forget_();
      throw new Error('アーカイブ先への書き込みは完了しましたが、元データの削除中に失敗しました: ' + String(err && err.message ? err.message : err).slice(0, 120) +
        '。同じ月を再度アーカイブすると、残りを移動できます（アーカイブ先は連番付きの別ファイルになります）。');
    }
    try { props_().deleteProperty('HIST_N'); } catch (err) { /* 次の読み込みで直る */ }
    touchAll_(); forget_();
    out.url = bookUrl_(id, first.sheet.getSheetId());
    out.tasks = moving.length; out.history = hist.length; out.links = links.length; out.photos = photos.length;
    logHistory_(me.email, '', 'setting', '過去データをアーカイブ（' + range.label + '、タスク ' + moving.length + ' 件・履歴 ' + hist.length + ' 件）', null);
  });
  return out;
}

// ---------- Meet ----------
// タスクの予定ごとに、Google Meet のリンクを付ける。Calendar のサービス（拡張サービス）を使う。権限は、いまのカレンダーの権限のまま。
// 予定そのものは、これまでどおり CalendarApp で作る。CalendarApp の予定の番号は、サービスの側の番号と同じとは限らない（公式）ので、
// サービスの側の番号は、予定の番号（iCalUID）で引いて確かめる。

const MEET_RE = /^https:\/\/meet\.google\.com\/[A-Za-z0-9_-]+$/;
/** Meet を付けることになっているタスクか。 */
function wantsMeet_(t) { return String(t.meet || '') !== ''; }
/** タスクの Meet のリンク。シートは手で書き換えられるので、Meet のリンクの形をしているものだけを通す。 */
function meetUrl_(t) { const v = String(t.meet || ''); return MEET_RE.test(v) ? v : ''; }
function meetNote_(error) { return error ? 'Meet リンクを作成できませんでした: ' + error : ''; }
const MEET_LATER = 'Meet リンクは後ほど発行されます（連続作成により、Google の回数上限に達しました）';
/** 「あとで付きます」の知らせ。返す状態を作るあいだにもう付いていたら、出さない。 */
function meetLaterNote_(state, later) {
  if (!later) return '';
  return read_('tasks').some(function (t) { return String(t.meet) === 'retry'; }) ? MEET_LATER : '';
}

function meetApiId_(eventId) {
  const res = Calendar.Events.list('primary', { iCalUID: String(eventId), maxResults: 1 });
  return res && res.items && res.items[0] && res.items[0].id ? String(res.items[0].id) : '';
}
function meetLinkOf_(ev) {
  let url = ev && ev.hangoutLink ? String(ev.hangoutLink) : '';
  if (!url && ev && ev.conferenceData && ev.conferenceData.entryPoints) {
    ev.conferenceData.entryPoints.forEach(function (p) { if (!url && p && p.entryPointType === 'video' && p.uri) url = String(p.uri); });
  }
  return MEET_RE.test(url) ? url : '';
}
/**
 * 予定に Meet を付ける。返すのは { cell（tasks の meet の欄に入れる値）, error }。
 * 付いたらリンク。頼んだがリンクがまだなら wait（次に管理者が開いたときに取りに行く）。失敗したら on（付けることにはなっている）と理由。
 */
function addMeet_(eventId, again) {
  try {
    if (typeof Calendar === 'undefined') throw new Error('Calendar  サービスが有効になっていません');
    const apiId = meetApiId_(eventId);
    if (!apiId) throw new Error('予定が見つかりません');
    let ev = clock_('meet', function () {
      return Calendar.Events.patch({ conferenceData: { createRequest: { requestId: id_(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } },
        'primary', apiId, { conferenceDataVersion: 1 });
    });
    let url = meetLinkOf_(ev);
    if (!url) { ev = Calendar.Events.get('primary', apiId); url = meetLinkOf_(ev); }
    return { cell: url || 'wait', error: '' };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    // 短いあいだに続けて作ると、Google の回数の上限（Rate Limit Exceeded）に当たることがある（2026-11-15 実機）。
    // 少し待ってもう一度だけ試し、それでもだめなら「あとでやり直す」にしておく（管理者が開いたときに、1 つずつ作り直す）
    if (/rate limit|quota|too many/i.test(msg)) {
      if (!again) { Utilities.sleep(1500); return addMeet_(eventId, true); }
      mem_().meetLimited = true; // この実行のなかでは、もうやり直さない（すぐ試しても、また上限に当たる）
      return { cell: 'retry', error: '', later: true };
    }
    return { cell: 'on', error: msg.slice(0, 200) };
  }
}
/** 予定から Meet を外す。外せなくても、タスクの側の設定は外す（予定にリンクが残ることはある）。 */
function dropMeet_(eventId) {
  try {
    if (typeof Calendar === 'undefined') return;
    const apiId = meetApiId_(eventId);
    if (apiId) Calendar.Events.patch({ conferenceData: null }, 'primary', apiId, { conferenceDataVersion: 1 });
  } catch (err) { /* 外せなくても止めない */ }
}
/** リンク待ちのタスクが今日のぶんにあれば、1 つだけ取りに行く（管理者が開いたとき）。取れたら true。 */
function fillMeet_(tasks) {
  if (mem_().meetLimited) return false;
  const t = tasks.filter(function (x) { return (String(x.meet) === 'wait' || String(x.meet) === 'retry') && x.event_id; })[0];
  if (!t) return false;
  const was = String(t.meet);
  let cell = '';
  if (was === 'retry') {
    // 回数の上限で作れなかったもの: もう一度作る。まだ上限なら、次に開いたときに回す。ほかの理由で失敗したら、やり直しをやめる
    const mt = addMeet_(String(t.event_id), true);
    cell = mt.cell === 'retry' ? '' : mt.cell;
  } else {
    try {
      const apiId = meetApiId_(String(t.event_id));
      if (apiId) cell = meetLinkOf_(Calendar.Events.get('primary', apiId));
    } catch (err) { return false; }
  }
  if (!cell) return false;
  withLock_(function () {
    const now = findTask_(String(t.id));
    if (now && String(now.meet) === was) setCells_('tasks', now._row, { meet: cell });
  });
  return true;
}

// ---------- カレンダー ----------

/**
 * カレンダーの予定の説明（備考）を作る。住所は説明ではなく、予定の「場所」に入れる。
 *   メモ：
 *   （メモ）
 *
 *   URL：
 *   （タスクの URL）
 *
 *   リンク：
 *   （リンク先のタスク）
 */
function describe_(taskId, memo, linkLines, member) {
  const link = linkFor_(taskId, member);
  const parts = [];
  if (memo) parts.push(T_('メモ：\n') + memo);
  if (link) parts.push('URL：\n' + link);
  if (linkLines && linkLines.length) parts.push(T_('リンク：\n') + linkLines.join('\n'));
  return parts.join('\n\n');
}

/** カレンダーの招待メールも送るか（設定。初めはオフ）。 */
function inviteOn_() { return props_().getProperty('CAL_INVITE') === 'true'; }

function makeEvent_(taskId, title, start, end, memo, member, address, quiet) {
  try {
    // カレンダーからの招待メールは、設定でオンにしたときだけ送る（初めはオフ。割り当ては Scurrop のメールで知らせる）。
    // quiet: オンでも送らない（繰り返しのタスクは、まとめて 1 通で知らせるため）。メンバーは、どちらでも予定のゲストに入る
    const opts = { description: describe_(taskId, memo, [], member), guests: member, sendInvites: !quiet && inviteOn_() };
    if (address) opts.location = address;
    const ev = CalendarApp.getDefaultCalendar().createEvent(title, new Date(start), new Date(end), opts);
    // 予定は「非公開」にする。管理者のカレンダーを見られる人に、タスク名やメモが見えないように（招待されたメンバーには見える）
    try { ev.setVisibility(CalendarApp.Visibility.PRIVATE); } catch (err) { /* 設定できなくても予定は作る */ }
    return { id: ev.getId(), error: '' };
  } catch (err) {
    return { id: '', error: String(err && err.message ? err.message : err) };
  }
}

/** タスクの予定の説明を、今のリンクに合わせて書き直す。問題があれば文字で返す。 */
function syncEvent_(taskId) {
  try {
    const tasks = read_('tasks');
    const t = tasks.filter(function (x) { return String(x.id) === taskId; })[0];
    if (!t || !t.event_id || String(t.event_id) === EVENT_WAIT) return '';
    const ev = CalendarApp.getEventById(String(t.event_id));
    if (!ev) return '';
    const byId = {};
    tasks.forEach(function (x) { byId[x.id] = x; });
    const names = {};
    read_('members').forEach(function (m) { names[String(m.email)] = String(m.name); });
    const lines = [];
    read_('links').forEach(function (l) {
      const otherId = String(l.a_task) === taskId ? String(l.b_task) : String(l.b_task) === taskId ? String(l.a_task) : '';
      const o = otherId && byId[otherId];
      if (!o) return;
      lines.push((l.kind ? '（' + l.kind + '）' : '') + String(o.title) + ' ' +
        hm_(Number(o.start_ms)) + '–' + hm_(Number(o.end_ms)) + ' ' + (o.member_email ? (names[o.member_email] || o.member_email) : '未割り当て'));
    });
    ev.setDescription(describe_(taskId, memoOf_(t), lines, String(t.member_email || '')));
    return '';
  } catch (err) {
    return 'カレンダーの予定を更新できませんでした: ' + String(err && err.message ? err.message : err);
  }
}
