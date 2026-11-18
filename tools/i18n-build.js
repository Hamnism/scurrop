/**
 * 対訳の表（i18n/*.json）から、src/I18n.gs を作る。
 *   node tools/i18n-build.js          … 作り直す
 *   node tools/i18n-build.js --check  … いまの I18n.gs が、対訳の表と合っているかだけ確かめる（合っていなければ失敗）
 * 対訳の鍵は、コードに書いてある日本語の文言そのもの（tools/strings.js で一覧にできる）。
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const NAMES = { ja: '日本語', en: 'English', fr: 'Français', es: 'Español', 'zh-TW': '繁體中文' };
// 画面で選べる言語。フランス語・スペイン語・繁體中文は、訳を確かめるまで出さない（訳のファイル i18n/*.json は残してある。出すときは、ここに足す）
const ENABLED = ['ja', 'en'];
const WD = { ja: ['日', '月', '火', '水', '木', '金', '土'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
  es: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], 'zh-TW': ['日', '一', '二', '三', '四', '五', '六'] };
function build() {
  const dict = {};
  ENABLED.filter((l) => l !== 'ja').forEach((l) => {
    const f = path.join(root, 'i18n', l + '.json');
    if (fs.existsSync(f)) dict[l] = JSON.parse(fs.readFileSync(f, 'utf8'));
  });
  const names = {}; Object.keys(NAMES).forEach((l) => { if (l === 'ja' || dict[l]) names[l] = NAMES[l]; });
  const wd = {}; Object.keys(names).forEach((l) => { wd[l] = WD[l]; });
  return '// このファイルは tools/i18n-build.js が i18n/*.json から作る。手で直さない（直すのは i18n/*.json）\n' +
    '// 対訳の表。鍵は、Code.gs と index.html に書いてある日本語の文言そのもの\n' +
    'const I18N_NAMES = ' + JSON.stringify(names) + ';\n' +
    'const I18N_WD = ' + JSON.stringify(wd) + ';\n' +
    'const I18N = ' + JSON.stringify(dict, null, 0).replace(/","/g, '",\n"') + ';\n';
}
const out = path.join(root, 'src', 'I18n.gs');
if (process.argv[2] === '--check') {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== build()) { console.error('src/I18n.gs が i18n/*.json と合っていません。node tools/i18n-build.js を実行してください。'); process.exit(1); }
} else if (require.main === module) {
  fs.writeFileSync(out, build());
  console.log('src/I18n.gs を書きました（' + fs.statSync(out).size + ' バイト）');
}
module.exports = { build, ENABLED };
