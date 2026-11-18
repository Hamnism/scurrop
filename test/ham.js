// 既定のアイコン（青いハムスター）のファビコンを作る道具。
// 絵の正本は src/index.html の HAM と HAM_COLOR。Code.gs の HAM_FAV は、ここで作った PNG（48px）をそのまま貼ったもの。
// 絵を変えたら `node test/ham.js` を実行し、出た data URL で Code.gs の HAM_FAV を置き換える。
// テスト（logic.test.js）は、HAM_FAV の中身が HAM と同じ絵かを確かめる。
const fs = require('fs'), zlib = require('zlib');

/** index.html から絵と色を読む。 */
function hamArt() {
  const src = fs.readFileSync(__dirname + '/../src/index.html', 'utf8');
  const grid = src.match(/const HAM = (\[[\s\S]*?\]);/), color = src.match(/const HAM_COLOR = (\{[\s\S]*?\});/);
  if (!grid || !color) throw new Error('index.html に HAM と HAM_COLOR が見つかりません');
  return { grid: Function('return ' + grid[1])(), color: Function('return ' + color[1])() };
}

/** 1 ドットを scale 倍にした RGBA の並び。「.」は透明（角を丸く見せる分）。 */
function hamPixels(scale) {
  const art = hamArt(), n = art.grid.length * scale, px = Buffer.alloc(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = art.grid[Math.floor(y / scale)][Math.floor(x / scale)];
    if (c === '.') continue;
    const hex = art.color[c], i = (y * n + x) * 4;
    px[i] = parseInt(hex.slice(1, 3), 16); px[i + 1] = parseInt(hex.slice(3, 5), 16); px[i + 2] = parseInt(hex.slice(5, 7), 16); px[i + 3] = 255;
  }
  return { size: n, px: px };
}

const CRC = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); }
  return function (buf) { let c = 0xFFFFFFFF; for (const b of buf) c = t[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA の並びを PNG の data URL にする。 */
function toPng(img) {
  const n = img.size, raw = Buffer.alloc(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) img.px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  const head = Buffer.alloc(13); head.writeUInt32BE(n, 0); head.writeUInt32BE(n, 4); head[8] = 8; head[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

/** toPng で作った PNG を RGBA の並びに戻す（テスト用。フィルタなしの PNG だけ読める）。 */
function fromPng(dataUrl) {
  const png = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
  let at = 8, size = 0; const idat = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8), data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') size = data.readUInt32BE(0);
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    if (raw[y * (size * 4 + 1)] !== 0) throw new Error('フィルタつきの PNG は読めません');
    raw.copy(px, y * size * 4, y * (size * 4 + 1) + 1, (y + 1) * (size * 4 + 1));
  }
  return { size: size, px: px };
}

module.exports = { hamPixels, toPng, fromPng };
if (require.main === module) console.log(toPng(hamPixels(3)));
