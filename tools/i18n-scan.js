/**
 * 訳し残しを探す。英語などの言語でプロジェクトを作り、主な画面とダイアログを開いて、画面に残っている日本語を一覧にする。
 *   node tools/i18n-scan.js en      （en / fr / es / zh-TW。zh-TW は、かなだけを数える）
 * データ（名前・タスク名）は英字で入れるので、出てきた日本語は、対訳の表で直しきれていない文言。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { makeEnv } = require('../test/mock.js');
const { pageHtml } = require('./demo.js');
const lang = process.argv[2] || 'en';
const JA = lang === 'zh-TW' ? /[ぁ-んァ-ヶ]/ : /[ぁ-んァ-ヶ一-龥]/;
const day = new Date(); day.setHours(0, 0, 0, 0);
const at = (h, m) => day.getTime() + (h * 60 + (m || 0)) * 60000;
(async () => {
  const e = makeEnv(path.join(__dirname, '../src/Code.gs')); const a = e.api; e.now = at(8);
  a.initProject({ name: 'Maintenance', lang });
  a.addBoard({ name: 'Field', color: '#2279B6' });
  a.addMember({ email: 'alice@example.com', name: 'Alice', board: 'Field' });
  a.addMember({ email: 'bob@example.com', name: 'Bob', board: '' });
  const tp = a.saveTemplate({ name: 'Inspection', board: 'Field', minutes: 60, geo: true, fields: [{ label: 'Units', type: 'number', required: true }, { label: 'Result', type: 'select', required: false, options: ['OK', 'Repair'] }, { label: 'Parts', type: 'multi', options: ['Belt', 'Filter'] }, { label: 'Photo', type: 'photo' }] }).templates[0];
  a.saveShift({ member: 'alice@example.com', date: new Date(at(0)).toISOString().slice(0, 10), start: '09:00', end: '18:00', repeat: 'weekly', days: [1, 2, 3, 4, 5], until: '' });
  const ids = {};
  const mk = (title, who, h1, h2, o) => { const st = a.createTask(Object.assign({ title, member: who, start: at(h1), end: at(h2), templateId: tp.id, address: '1 Main St', memo: 'Back door' }, o || {})); ids[title] = st.tasks.filter((t) => t.title === title)[0].id; };
  mk('Morning check', 'alice@example.com', 9, 10); mk('Noon check', 'alice@example.com', 11, 12, { meet: true }); mk('Late one', 'bob@example.com', 9, 10); mk('Open job', '', 14, 15);
  mk('Weekly', 'bob@example.com', 15, 16, { repeat: 'daily', until: new Date(at(0) + 3 * 86400000).toISOString().slice(0, 10) });
  a.linkTasks(ids['Morning check'], ids['Late one'], 'handover', false);
  e.user = 'alice@example.com'; e.now = at(9, 12); a.updateTask(ids['Morning check'], 'start', { geo: { lat: 35.6, lng: 139.7, acc: 12 } });
  e.now = at(9, 50); a.updateTask(ids['Morning check'], 'done', { note: 'ok', values: { [tp.fields[0].key]: 3, [tp.fields[1].key]: 'OK', [tp.fields[2].key]: ['Belt'] } });
  e.now = at(11, 5); a.updateTask(ids['Noon check'], 'start', {});
  e.user = 'bob@example.com'; e.now = at(9, 5); a.reportLate(ids['Late one'], { minutes: 15, note: 'traffic' });
  e.user = 'admin@example.com'; e.now = at(13, 20);
  const found = {};
  const b = await chromium.launch();
  const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const open = async (user, vp, task) => {
    const p = await (await b.newContext({ viewport: vp })).newPage();
    await p.exposeFunction('gasCall', async (fn, args) => { e.user = user; try { return { v: JSON.parse(JSON.stringify(e.api[fn](...args))) }; } catch (err) { return { e: err.message }; } });
    await p.route('https://fonts.gstatic.com/**', (r) => r.fulfill({ contentType: 'image/png', body: PX }));
    await p.route('https://app.test/', (r) => { e.user = user; return r.fulfill({ contentType: 'text/html; charset=utf-8', body: pageHtml(e.api.doGet({ parameter: { task: task || '', debug: '1' } }).boot, '') }); });
    await p.goto('https://app.test/'); await p.waitForTimeout(300); return p;
  };
  const grab = async (p, where) => {
    const list = await p.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (n.parentElement.closest('script,style')) continue; const t = n.textContent.trim(); if (t) out.push(t); }
      document.querySelectorAll('[aria-label],[title],[placeholder]').forEach((el) => ['aria-label', 'title', 'placeholder'].forEach((k) => { const v = el.getAttribute(k); if (v) out.push(v); })); return out; });
    list.filter((t) => JA.test(t)).forEach((t) => { const k = t.slice(0, 90); (found[k] = found[k] || new Set()).add(where); });
  };
  const click = async (p, loc) => { try { await loc.first().click({ timeout: 2000 }); await p.waitForTimeout(200); return true; } catch (err) { return false; } };
  const esc = async (p) => { await p.evaluate(() => { const d = document.getElementById('dlg'); if (d.open) d.close(); }); };
  let p = await open('admin@example.com', { width: 1360, height: 900 });
  await grab(p, 'board');
  await click(p, p.locator('.task')); await grab(p, 'board:task');
  await click(p, p.locator('.cols>.side button', { hasText: /./ }).nth(2)); await grab(p, 'dialog:edit'); await esc(p);
  await click(p, p.locator('.lane-l')); await grab(p, 'board:member');
  await click(p, p.locator('.cols>.side .btn').last()); await grab(p, 'dialog:shift'); await esc(p);
  await click(p, p.locator('.shead .btn.primary')); await p.locator('dialog select').last().selectOption('weekly').catch(() => {}); await grab(p, 'dialog:task'); await esc(p);
  for (const i of [1, 2]) { await click(p, p.locator('.shead .seg').first().locator('button').nth(i)); await p.waitForTimeout(300); await grab(p, 'board:span' + i); await p.locator('.wc').first().hover().catch(() => {}); await grab(p, 'tip'); }
  await click(p, p.locator('.shead .seg').first().locator('button').nth(0));
  const tabs = p.locator('.bar .tab');
  await click(p, tabs.nth(1)); await grab(p, 'tasks'); await click(p, p.locator('.tbl tbody tr.click')); await grab(p, 'tasks:report');
  await click(p, p.locator('section .seg').first().locator('button').nth(1)); await grab(p, 'templates'); await click(p, p.locator('[aria-label] .linkbtn, .tplrow, .linkbtn')); await grab(p, 'template:edit');
  await click(p, tabs.nth(2)); await grab(p, 'members'); await click(p, p.locator('.tbl .btn')); await grab(p, 'dialog:member'); await esc(p);
  await click(p, p.locator('.shead .btn.primary')); await grab(p, 'dialog:addmember'); await esc(p);
  await click(p, tabs.nth(3)); await grab(p, 'reports');
  for (const i of [0, 1, 4]) { await click(p, p.locator('.set .btn.sm').nth(i)); await p.waitForTimeout(500); await grab(p, 'dialog:report' + i); await esc(p); }
  await click(p, tabs.nth(4)); await grab(p, 'settings'); await click(p, p.locator('.set .sethead .btn').first()); await grab(p, 'dialog:rule'); await esc(p);
  p = await open('alice@example.com', { width: 390, height: 844 }); await grab(p, 'member');
  await click(p, p.locator('.mtask').nth(1)); await grab(p, 'member:task');
  p = await open('bob@example.com', { width: 390, height: 844 }, ids['Late one']); await grab(p, 'member:late'); await click(p, p.locator('.btn', { hasText: /./ }).nth(1)); await grab(p, 'dialog:late');
  p = await open('nobody@example.com', { width: 390, height: 844 }); await grab(p, 'guest');
  // メール
  e.mails.forEach((m) => [m.subject, m.body].forEach((t) => String(t).split('\n').filter((x) => JA.test(x)).forEach((x) => { (found[x.slice(0, 90)] = found[x.slice(0, 90)] || new Set()).add('mail'); })));
  await b.close();
  const keys = Object.keys(found);
  keys.forEach((k) => console.log([...found[k]].slice(0, 2).join(',') + '\t' + k));
  console.log(lang + ': 訳し残し ' + keys.length + ' 個');
})().catch((err) => { console.error(err); process.exit(1); });
