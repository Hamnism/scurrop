/**
 * README に載せる図「アクセスと権限」を作る（日本語・英語）。
 *   node tools/diagram-access.js
 * 出力: public/docs/images/access.ja.svg・access.en.svg（手順書に貼る）と、promo/diagram/ の .png（2 倍の大きさ。LP などに。Git には入れない）。
 * 文言を直すときは、下の TEXT を直して作り直す。
 */
const fs = require('fs');
const path = require('path');
// README・手順書に貼る SVG。開発用のリポジトリでは public/ の中、公開用のリポジトリでは、いちばん上の docs/images
const OUT = path.join(__dirname, fs.existsSync(path.join(__dirname, '../public')) ? '../public/docs/images' : '../docs/images');
const PNG = path.join(__dirname, '../promo/diagram');     // LP などに使う PNG（Git には入れない）
const C = { navy: '#1F2E38', blue: '#2279B6', ink: '#1D1D1F', sub: '#6E6E73', line: '#C7C7CC', soft: '#F5F5F7', red: '#D70015', green: '#1E8E3E', white: '#FFFFFF' };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans','Noto Sans JP','Yu Gothic',Meiryo,sans-serif";
const TEXT = {
  ja: {
    title: 'アクセスと権限', lead: '権限は二層です。上位がGoogleスプレッドシートの共有権限、その下がScurropのロールです。',
    upper: 'Googleスプレッドシート（データの保存先）', upperSub: '編集できる人は、全データとメンバーのロールを直接変更できます',
    chip: '共有は、信頼できる管理者に限定',
    bridge: 'Scurropは、公開したアカウントの権限で読み書きします（利用者への共有は不要）',
    lower: 'Scurrop（Apps ScriptのWebアプリ）', lowerSub: 'URLは全員共通。開いた人のGoogleアカウントで、表示する画面を切り替えます',
    roles: [
      { h: '管理者', r: '管理者の画面', s: '公開したアカウントと同じ組織のみ', kind: 'admin' },
      { h: 'メンバー', r: '本人のメンバーページ', s: '組織外は、本人専用の鍵つきリンク', kind: 'member' },
      { h: '登録なし・未ログイン', r: 'アクセス不可', s: 'データは読み込みません', kind: 'none' }
    ]
  },
  en: {
    title: 'Access and permissions', lead: 'Two layers: Google Sheet sharing permissions on top, Scurrop roles underneath.',
    upper: 'Google Sheet (where the data lives)', upperSub: 'Anyone who can edit it can change all data and member roles directly',
    chip: 'Share only with admins you trust',
    bridge: 'Scurrop reads and writes with the deploying account’s permissions (no need to share with users)',
    lower: 'Scurrop (Apps Script web app)', lowerSub: 'One URL for everyone. The screen is chosen from the Google account of the person who opens it',
    roles: [
      { h: 'Admin', r: 'Admin console', s: 'Same organization as the deploying account', kind: 'admin' },
      { h: 'Member', r: 'Own member page', s: 'Outside the organization: personal key link', kind: 'member' },
      { h: 'Unregistered · not signed in', r: 'No access', s: 'No data is read', kind: 'none' }
    ]
  }
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const W = 1200, H = 520;
function svg(t) {
  let o = '';
  const text = (x, y, s, size, fill, weight, anchor) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight || 400}" text-anchor="${anchor || 'start'}">${esc(s)}</text>`;
  o += `<rect width="${W}" height="${H}" rx="16" fill="${C.white}"/>`;
  o += text(40, 56, t.title, 24, C.ink, 700) + text(40, 86, t.lead, 14, C.sub);
  // 上の層: スプレッドシート
  const uy = 112, uh = 96;
  o += `<rect x="40" y="${uy}" width="${W - 80}" height="${uh}" rx="16" fill="${C.soft}" stroke="${C.line}" stroke-width="1.5"/>`;
  o += text(68, uy + 42, t.upper, 18, C.ink, 700) + text(68, uy + 68, t.upperSub, 14, C.sub);
  const cw = 330;
  o += `<rect x="${W - 68 - cw}" y="${uy + 26}" width="${cw}" height="44" rx="22" fill="${C.white}" stroke="${C.red}" stroke-width="1.5"/>` + text(W - 68 - cw / 2, uy + 54, t.chip, 14, C.red, 600, 'middle');
  // つなぎ
  const by = uy + uh;
  o += `<line x1="100" y1="${by + 6}" x2="100" y2="${by + 50}" stroke="${C.sub}" stroke-width="1.5" marker-start="url(#a)" marker-end="url(#a)"/>` + text(128, by + 33, t.bridge, 14, C.sub);
  // 下の層: Scurrop
  const ly = by + 56, lh = 236;
  o += `<rect x="40" y="${ly}" width="${W - 80}" height="${lh}" rx="16" fill="${C.white}" stroke="${C.navy}" stroke-width="2"/>`;
  o += text(68, ly + 42, t.lower, 18, C.navy, 700) + text(68, ly + 68, t.lowerSub, 14, C.sub);
  const rw = 344, rg = 16;
  t.roles.forEach((r, i) => {
    const x = 68 + (rw + rg) * i, y = ly + 92;
    const fill = r.kind === 'admin' ? C.navy : C.white, stroke = r.kind === 'admin' ? C.navy : r.kind === 'member' ? C.blue : C.red;
    const head = r.kind === 'admin' ? '#C9D3DA' : C.sub, main = r.kind === 'admin' ? C.white : r.kind === 'member' ? C.blue : C.red, sub = r.kind === 'admin' ? '#C9D3DA' : C.sub;
    o += `<rect x="${x}" y="${y}" width="${rw}" height="116" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    o += text(x + 22, y + 32, r.h, 13, head, 600) + text(x + 22, y + 64, '→ ' + r.r, 18, main, 700) + text(x + 22, y + 92, r.s, 13, sub);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" role="img" aria-label="${esc(t.title)}">` +
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${C.sub}"/></marker></defs>${o}</svg>\n`;
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PNG, { recursive: true });
  Object.keys(TEXT).forEach((l) => fs.writeFileSync(path.join(OUT, 'access.' + l + '.svg'), svg(TEXT[l])));
  let chromium = null; try { chromium = require('playwright').chromium; } catch (e) { console.log('SVG だけ作りました（PNG は Playwright が要ります）'); return; }
  const fontDir = process.env.FONT_DIR || '';
  const face = fontDir ? [400, 600, 700].map((w) => `@font-face{font-family:"DiagramJP";font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontDir, 'noto-sans-jp-japanese-' + w + '-normal.woff2')).toString('base64')}) format("woff2")}`).join('') : '';
  const b = await chromium.launch();
  for (const l of Object.keys(TEXT)) {
    const p = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();
    await p.setContent(`<style>${face}body{margin:0}${fontDir ? 'svg{font-family:"Inter","DiagramJP",sans-serif}' : ''}</style>` + svg(TEXT[l]).replace(/font-family="[^"]*"/, ''));
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(PNG, 'access.' + l + '.png') });
  }
  await b.close();
  console.log('public/docs/images/access.{ja,en}.svg と promo/diagram/access.{ja,en}.png を作りました');
})().catch((e) => { console.error(e); process.exit(1); });
