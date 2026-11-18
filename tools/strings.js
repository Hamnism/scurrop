/**
 * 画面とメールに出る日本語の文言を、ファイルと行つきで一覧にする（英語などへの翻訳の下ごしらえ）。
 *   node tools/strings.js            … 一覧を出す（タブ区切り: ファイル・行・文言）
 *   node tools/strings.js --count    … 数だけ出す
 * コメントは数えない。文言は、コードの中の文字列をそのまま抜き出したもの（つなぎ合わせる前の断片も含む）。
 */
const fs = require('fs');
const path = require('path');
const JA = /[ぁ-んァ-ヶ一-龥]/;
const out = [];
['src/index.html', 'src/Code.gs'].forEach((file) => {
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const code = line.replace(/\s\/\/\s.*$/, '');
    (code.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || []).forEach((q) => { const v = q.slice(1, -1); if (JA.test(v) && v.indexOf('$1') < 0) out.push([file, i + 1, v]); });
  });
});
module.exports = { list: out };
if (require.main !== module) { /* ほかの道具・テストから使うときは、一覧だけ渡す */ } else if (process.argv[2] === '--count') {
  const uniq = new Set(out.map((x) => x[2]));
  console.log(out.length + ' 個（重なりを除くと ' + uniq.size + ' 個）');
} else {
  out.forEach((x) => console.log(x.join('\t')));
}
