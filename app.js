const $ = i => document.getElementById(i);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr = n => '\u20B9 ' + Number(n || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const num = v => typeof v === 'number' ? Number(v).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : esc(v);
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
let T = sessionStorage.getItem('t'), ME = JSON.parse(sessionStorage.getItem('u') || 'null'), STU = [], REP = null;

function toast(m, err) { const t = $('toast'); t.textContent = m; t.className = err ? 'err' : ''; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(() => t.style.display = 'none', 3500); }
async function post(body) {
  if (!/^https:\/\/script\.google\.com\//.test(API_URL)) throw new Error('Set API_URL in config.js first');
  let j;
  try {
    const r = await fetch(API_URL, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)});
    j = await r.json();
  } catch (e) { throw new Error('Cannot reach the server. Check API_URL and the web app deployment.'); }
  if (!j.ok) throw new Error(j.error);
  return j.data;
}
async function call(a, p) {
  try { return await post({token: T, action: a, payload: p || {}}); }
  catch (e) { if (/Session expired/.test(e.message)) endSession(); toast(e.message, true); throw e; }
}
function table(el, head, body, opts = {}) {
  $(el).innerHTML = '<thead><tr>' + head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    body.map(r => '<tr>' + r.map(c => '<td' + (typeof c === 'number' ? ' class="n"' : '') + '>' + (opts.raw ? c : num(c)) + '</td>').join('') + '</tr>').join('') + '</tbody>';
}

/* ---- session ---- */
$('lbtn').onclick = doLogin; $('lp').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
async function doLogin() {
  $('lerr').textContent = ''; $('lbtn').disabled = true;
  try {
    const r = await post({action: 'login', payload: {u: $('lu').value, p: $('lp').value}});
    T = r.token; ME = r.user; sessionStorage.setItem('t', T); sessionStorage.setItem('u', JSON.stringify(ME)); $('lp').value = ''; init();
  } catch (e) { $('lerr').textContent = e.message; }
  $('lbtn').disabled = false;
}
function endSession() { sessionStorage.clear(); T = null; ME = null; $('app').hidden = true; $('login').hidden = false; }
$('out').onclick = () => { call('logout').finally(endSession); };
function init() {
  $('login').hidden = true; $('app').hidden = false;
  $('who').textContent = ME.name + ' (' + ME.role + ')';
  document.querySelectorAll('.adm').forEach(e => e.hidden = ME.role !== 'admin');
  $('cd').value = $('td').value = today();
  show('coll'); loadDash();
}
if (T && ME) init();

/* ---- tabs ---- */
$('nav').onclick = e => { if (e.target.dataset.t) show(e.target.dataset.t); };
function show(t) {
  ['coll', 'stu', 'rep', 'usr', 'cls'].forEach(x => $('p-' + x).hidden = x !== t);
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  if (t === 'coll') loadDash(); if (t === 'stu') loadStudents(); if (t === 'rep') initRep(); if (t === 'usr') { loadUsers(); loadAudit(); } if (t === 'cls') loadClosing();
}

/* ---- dashboard & collection ---- */
async function loadDash() {
  const d = await call('dashboard');
  const c = (l, v, col) => `<div class="card"><small style="color:${col}">${esc(l)}</small><b style="color:${col}">${inr(v)}</b></div>`;
  $('cards').innerHTML = c('Total Income', d.income, 'var(--green)') + c('Total Withdraw', d.wd, 'var(--red)') + c('Bank Deposit', d.bank, 'var(--blue)') +
    c('Cash in Hand', d.cash, 'var(--brown)') + Object.entries(d.holders).map(([k, v]) => c(k, v, 'var(--blue)')).join('');
  const del = ME.role === 'admin';
  renderRecent(d.recent);
  $('holders').innerHTML = Object.keys(d.holders).map(k => `<option value="${esc(k)}">`).join('');
  table('ttab', ['Date', 'Account', 'Action', 'Amount', ''], d.transfers.map(t => [esc(t.Date), esc(t.Holder), Number(t.Amount) < 0 ? 'Withdraw' : 'Deposit', num(Math.abs(Number(t.Amount))),
    del ? `<button class="sm red" data-id="${esc(t.ID)}" onclick="delTr(this.dataset.id)">✕</button>` : '']), {raw: true});
}
let RECENT = [], RC = '';
function renderRecent(l) {
  RECENT = l;
  table('rtab', ['Date', 'LF', 'Name', 'Class', 'Type', 'Amount', 'Book', ''], l.map(t => [esc(t.Date), esc(t['LF No']), esc(t.Name), esc(t.Class), esc(t.Type), num(Number(t.Amount)), esc(t['New Book']),
    `<button class="sm ghost" data-id="${esc(t.ID)}" onclick="showReceipt(this.dataset.id)">Receipt</button>` +
    (ME.role === 'admin' ? ` <button class="sm" data-id="${esc(t.ID)}" onclick="editTx(this.dataset.id)">Edit</button>` : '')]), {raw: true});
}
$('rfl').onchange = async () => renderRecent(await call('txns', {lf: $('rfl').value}));
async function refreshRecent() { await loadDash(); if ($('rfl').value) $('rfl').onchange(); }
function editTx(id) {
  const t = RECENT.find(x => x.ID === id);
  $('dlg').innerHTML = `<h2>Edit Transaction</h2><div class="info">${esc(t.Name)} • LF ${esc(t['LF No'])}</div>
    <label>Date</label><input type="date" id="e_d" value="${esc(t.Date)}">
    <label>Type</label><select id="e_t"><option ${t.Type === 'Deposit' ? 'selected' : ''}>Deposit</option><option ${t.Type === 'Withdraw' ? 'selected' : ''}>Withdraw</option></select>
    <label>Amount</label><input type="number" id="e_a" step="0.01" value="${Number(t.Amount)}">
    <label>New Book</label><select id="e_b"><option ${t['New Book'] !== 'Yes' ? 'selected' : ''}>No</option><option ${t['New Book'] === 'Yes' ? 'selected' : ''}>Yes</option></select>
    <label>Note</label><input id="e_n" value="${esc(t.Note)}">
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" onclick="$('dlg').close()">Cancel</button><button id="e_s">Save</button></div>`;
  $('dlg').showModal();
  $('e_s').onclick = async () => {
    await call('editTxn', {id, date: $('e_d').value, type: $('e_t').value, amount: $('e_a').value, newBook: $('e_b').value, note: $('e_n').value});
    $('dlg').close(); toast('Transaction updated'); refreshRecent();
  };
}
function printHtml(h) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document; d.open(); d.write('<html><body style="margin:0">' + h + '</body></html>'); d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 300);
}
async function showReceipt(id) {
  const r = await call('receipt', {id}), kv = (l, v) => `<div style="display:flex;justify-content:space-between;font-size:13px;margin:3px 0"><span>${l}</span><b>${esc(v)}</b></div>`;
  RC = `<div style="font-family:Arial,sans-serif;width:300px;margin:auto;padding:12px;border:1px dashed #000;color:#000">
    <div style="text-align:center;font-weight:700;font-size:16px">VIDHYANIDHI COLLECTION</div>
    <div style="text-align:center;font-size:12px;margin:2px 0 10px">${r.type === 'Deposit' ? 'Deposit' : 'Withdrawal'} Receipt</div>
    ${kv('Date', r.date)}${kv('Name', r.name)}${kv('Class', r.cls)}${kv('LF No', r.lf)}${kv('Adm No', r.adm)}${r.newBook === 'Yes' ? kv('New Book', 'Yes') : ''}
    <hr style="border:0;border-top:1px dashed #000">${kv(r.type, inr(r.amount))}${kv('Balance', inr(r.balance))}
    <div style="text-align:center;font-size:11px;margin-top:10px">By ${esc(r.by)} • Ref ${esc(r.id)}</div></div>`;
  $('dlg').innerHTML = RC + `<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" onclick="$('dlg').close()">Close</button><button id="rp_b">Print</button></div>`;
  $('dlg').showModal(); $('rp_b').onclick = () => printHtml(RC);
}
async function delTr(id) { if (confirm('Delete this transfer?')) { await call('deleteTransfer', {id}); loadDash(); } }

async function lookup() {
  const lf = $('clf').value.trim(); if (!lf) return;
  try { const s = await call('student', {lf}); $('cinfo').textContent = `${s.name} • ${s.cls}-${s.div} • Balance ${inr(s.balance)}`; $('camt').focus(); }
  catch (e) { $('cinfo').textContent = ''; }
}
$('clf').onkeydown = e => { if (e.key === 'Enter') lookup(); }; $('clf').onblur = lookup;
async function txn(type) {
  const b = await call('addTxn', {type, date: $('cd').value, lf: $('clf').value, amount: $('camt').value, newBook: $('cnb').value, note: $('cnote').value});
  toast(type + ' saved. New balance ' + inr(b.balance));
  if ($('cauto').checked) showReceipt(b.id);
  $('clf').value = $('camt').value = $('cnote').value = ''; $('cnb').value = 'No'; $('cinfo').textContent = ''; $('clf').focus(); loadDash();
}
$('bdep').onclick = () => txn('Deposit'); $('bwd').onclick = () => txn('Withdraw');
$('ttype').onchange = () => $('thw').hidden = $('ttype').value !== 'Person';
async function trf(dir) {
  await call('addTransfer', {dir, date: $('td').value, amount: $('tamt').value, type: $('ttype').value, holder: $('thold').value});
  toast(dir === 'Withdraw' ? 'Withdrawn to cash in hand' : 'Deposited'); $('tamt').value = ''; loadDash();
}
$('btr').onclick = () => trf('Deposit'); $('btw').onclick = () => trf('Withdraw');

/* ---- students ---- */
async function loadStudents() { STU = await call('students'); renderStu(); }
function renderStu() {
  const q = $('ssearch').value.toLowerCase(), adm = ME.role === 'admin';
  const list = STU.filter(s => [s.lf, s.adm, s.name, s.cls + '-' + s.div].join(' ').toLowerCase().includes(q));
  table('stab', ['LF No', 'Adm No', 'Name', 'Class', 'Balance', 'Status', ''], list.map(s => [esc(s.lf), esc(s.adm), esc(s.name), esc(s.cls + '-' + s.div), num(s.balance), esc(s.status),
    `<button class="sm" data-lf="${esc(s.lf)}" onclick="stuForm(this.dataset.lf)">Edit</button> ` + (adm ? `<button class="sm red" data-lf="${esc(s.lf)}" onclick="stuDel(this.dataset.lf)">Delete</button>` : '')]), {raw: true});
}
$('ssearch').oninput = renderStu; $('sadd').onclick = () => stuForm('');
function stuForm(lf) {
  const s = STU.find(x => x.lf === lf) || {lf: '', adm: '', name: '', cls: '', div: '', status: 'Active'};
  $('dlg').innerHTML = `<h2>${lf ? 'Edit' : 'Add'} Student</h2>
    <label>Student Name</label><input id="f_name" value="${esc(s.name)}">
    <div style="display:flex;gap:8px"><div><label>Class</label><input id="f_cls" value="${esc(s.cls)}"></div><div><label>Division</label><input id="f_div" value="${esc(s.div)}"></div></div>
    <label>Admission Number</label><input id="f_adm" value="${esc(s.adm)}"><label>LF No</label><input id="f_lf" value="${esc(s.lf)}">
    <label>Status</label><select id="f_st"><option>Active</option><option ${s.status === 'Inactive' ? 'selected' : ''}>Inactive</option></select>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" onclick="$('dlg').close()">Cancel</button><button id="f_save">Save</button></div>`;
  $('dlg').showModal();
  $('f_save').onclick = async () => {
    await call('saveStudent', {orig: lf, lf: $('f_lf').value, adm: $('f_adm').value, name: $('f_name').value, cls: $('f_cls').value, div: $('f_div').value, status: $('f_st').value});
    $('dlg').close(); toast('Saved'); loadStudents();
  };
}
async function stuDel(lf) { if (confirm('Delete student LF ' + lf + '?')) { toast(await call('deleteStudent', {lf})); loadStudents(); } }

const HEAD = ['Student Name', 'Class', 'Division', 'Admission No', 'LF No', 'Opening Balance'];
$('stpl').onclick = () => {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ['Sample Student', '5', 'A', 'ADM1001', '701', 0]]);
  ws['!cols'] = HEAD.map(() => ({wch: 18}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Students'); XLSX.writeFile(wb, 'Student_Import_Template.xlsx');
};
$('simp').onclick = () => $('sfile').click();
$('sfile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer()), data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: ''});
  const map = {studentname: 'name', name: 'name', class: 'cls', division: 'div', div: 'div', admissionno: 'adm', admissionnumber: 'adm', admno: 'adm', lfno: 'lf', lf: 'lf', openingbalance: 'open', opening: 'open'};
  const rows = data.map(r => { const o = {}; Object.keys(r).forEach(k => { const m = map[k.toLowerCase().replace(/[^a-z]/g, '')]; if (m) o[m] = r[k]; }); return o; });
  e.target.value = '';
  if (!rows.length) return toast('No rows found in file', true);
  if (!confirm('Import ' + rows.length + ' rows?')) return;
  const r = await call('importStudents', {rows});
  alert('Added: ' + r.added + '\nSkipped: ' + r.errors.length + (r.errors.length ? '\n\n' + r.errors.slice(0, 20).join('\n') : ''));
  loadStudents();
};

/* ---- reports ---- */
async function initRep() { const c = await call('meta'); $('rcls').innerHTML = '<option value="">All classes</option>' + c.map(x => `<option>${esc(x)}</option>`).join(''); fields(); }
function fields() { document.querySelectorAll('#p-rep [data-f]').forEach(d => d.hidden = !d.dataset.f.split(' ').includes($('rname').value)); }
$('rname').onchange = fields;
$('rrun').onclick = async () => {
  REP = await call('report', {name: $('rname').value, lf: $('rlf').value, from: $('rfrom').value, to: $('rto').value, cls: $('rcls').value});
  $('rtitle').textContent = REP.title;
  table('rtable', REP.headers, REP.rows.concat(REP.footer || []));
};
function needRep() { if (!REP) { toast('Run a report first', true); return false; } return true; }
$('rxls').onclick = () => {
  if (!needRep()) return;
  const ws = XLSX.utils.aoa_to_sheet([[REP.title], [], REP.headers, ...REP.rows, ...(REP.footer || [])]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report'); XLSX.writeFile(wb, 'Report_' + today() + '.xlsx');
};
$('rpdf').onclick = () => {
  if (!needRep()) return;
  const doc = new window.jspdf.jsPDF({orientation: REP.headers.length > 6 ? 'landscape' : 'portrait'});
  doc.setFontSize(13); doc.text('Vidhyanidhi Collection', 14, 14); doc.setFontSize(10); doc.text(REP.title, 14, 21);
  const fmt = r => r.map(c => typeof c === 'number' ? c.toFixed(2) : c);
  doc.autoTable({head: [REP.headers], body: REP.rows.concat(REP.footer || []).map(fmt), startY: 26, styles: {fontSize: 8}, headStyles: {fillColor: [120, 144, 58]}});
  doc.save('Report_' + today() + '.pdf');
};

/* ---- users ---- */
async function loadUsers() {
  const u = await call('listUsers');
  table('utab', ['Username', 'Name', 'Role', ''], u.map(x => [esc(x.username), esc(x.name), esc(x.role), `<button class="sm red" data-u="${esc(x.username)}" onclick="usrDel(this.dataset.u)">Delete</button>`]), {raw: true});
}
async function usrDel(u) { if (confirm('Delete user ' + u + '?')) { await call('deleteUser', {username: u}); loadUsers(); } }
$('uadd').onclick = () => {
  $('dlg').innerHTML = `<h2>Add / Reset User</h2><label>Username</label><input id="u_n"><label>Full name</label><input id="u_f">
    <label>Password (min 6; leave blank to keep when editing)</label><input id="u_p" type="password"><label>Role</label><select id="u_r"><option value="staff">staff</option><option value="admin">admin</option></select>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" onclick="$('dlg').close()">Cancel</button><button id="u_s">Save</button></div>`;
  $('dlg').showModal();
  $('u_s').onclick = async () => { await call('saveUser', {username: $('u_n').value, name: $('u_f').value, password: $('u_p').value, role: $('u_r').value}); $('dlg').close(); toast('Saved'); loadUsers(); };
};
$('cpw').onclick = () => {
  $('dlg').innerHTML = `<h2>Change Password</h2><label>Current password</label><input id="c_o" type="password"><label>New password</label><input id="c_n" type="password">
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" onclick="$('dlg').close()">Cancel</button><button id="c_s">Update</button></div>`;
  $('dlg').showModal();
  $('c_s').onclick = async () => { await call('changePassword', {old: $('c_o').value, neu: $('c_n').value}); $('dlg').close(); toast('Password updated'); };
};

/* ---- report print ---- */
$('rprt').onclick = () => {
  if (!needRep()) return;
  printHtml('<div style="font-family:Arial;padding:14px"><h3 style="margin:0 0 8px">' + esc(REP.title) + '</h3><table style="border-collapse:collapse;font-size:12px;width:100%">' + $('rtable').innerHTML + '</table></div><style>th,td{border:1px solid #888;padding:4px 6px;text-align:left}th{background:#ddd}</style>');
};

/* ---- daily closing ---- */
let KEXP = 0;
async function loadClosing() {
  if (!$('kd').value) $('kd').value = today();
  const k = await call('closingInfo', {date: $('kd').value}), c = (l, v) => `<div class="card"><small>${l}</small><b>${inr(v)}</b></div>`;
  $('kinfo').innerHTML = c('Deposits (day)', k.dep) + c('Withdrawals (day)', k.wd) + c('Net to bank/custody (day)', k.tr) + c('Expected cash in hand', k.expected);
  KEXP = k.expected; $('kcnt').value = k.closing ? k.closing.counted : ''; $('knote').value = k.closing ? k.closing.note : ''; kdiff();
  table('ktab', ['Date', 'Expected', 'Counted', 'Difference', 'By'], k.list.map(x => [esc(x.Date), num(Number(x.Expected)), num(Number(x.Counted)),
    `<span class="${x.Difference < 0 ? 'neg' : x.Difference > 0 ? 'pos' : ''}">${num(Number(x.Difference))}</span>`, esc(x.User)]), {raw: true});
}
function kdiff() {
  const v = $('kcnt').value; if (v === '') { $('kdiff').textContent = ''; return; }
  const d = Math.round((Number(v) - KEXP) * 100) / 100;
  $('kdiff').textContent = d === 0 ? '✔ Cash matches' : (d < 0 ? 'Short by ' : 'Excess by ') + inr(Math.abs(d));
  $('kdiff').style.color = d === 0 ? 'var(--green)' : 'var(--red)';
}
$('kd').onchange = loadClosing; $('kcnt').oninput = kdiff;
$('ksave').onclick = async () => { await call('saveClosing', {date: $('kd').value, counted: $('kcnt').value, note: $('knote').value}); toast('Closing saved'); loadClosing(); };

/* ---- PIN, backup, restore, year-end, audit ---- */
function askPin(msg) {
  return new Promise(res => {
    $('dlg').innerHTML = `<h2>Enter PIN</h2><div class="info">${esc(msg || '')}</div><input id="pin_i" type="password" inputmode="numeric" maxlength="4" autocomplete="off">
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="ghost" id="pin_c">Cancel</button><button id="pin_o">OK</button></div>`;
    $('dlg').showModal();
    let done = false; const fin = v => { if (done) return; done = true; $('dlg').close(); res(v); };
    $('pin_o').onclick = () => fin($('pin_i').value); $('pin_c').onclick = () => fin(null);
    $('pin_i').onkeydown = e => { if (e.key === 'Enter') fin($('pin_i').value); };
    $('dlg').oncancel = () => fin(null);
  });
}
async function backup(pin) {
  const d = await call('exportData', {pin}), wb = XLSX.utils.book_new();
  Object.keys(d).forEach(n => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d[n]), n));
  XLSX.writeFile(wb, 'Vidhyanidhi_Backup_' + today() + '.xlsx');
}
$('bexp').onclick = async () => { const pin = await askPin('PIN required to export data'); if (pin === null) return; await backup(pin); toast('Backup downloaded'); };
$('bimp').onclick = () => $('bfile').click();
$('bfile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer()), data = {}, mode = $('bmode').value;
  wb.SheetNames.forEach(n => data[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, defval: ''}));
  if (mode === 'replace' && !confirm('REPLACE will erase all current students, transactions, transfers and closings, then load the file. A backup of the current data is downloaded first. Continue?')) return;
  const pin = await askPin('PIN required to import data'); if (pin === null) return;
  if (mode === 'replace') await backup(pin);
  const r = await call('importData', {pin, mode, data});
  alert('Import complete:\n' + Object.entries(r).map(([k, v]) => k + ': ' + v + ' rows').join('\n')); loadAudit();
};
$('bpin').onclick = async () => {
  const old = await askPin('Enter your CURRENT PIN'); if (old === null) return;
  const neu = await askPin('Enter the NEW 4-digit PIN'); if (neu === null) return;
  await call('setPin', {old, neu}); toast('PIN changed'); loadAudit();
};
const yeText = r => `Will promote ${r.promote} students and mark ${r.leave} as leavers (Inactive). Skipped (non-numeric class): ` + (Object.entries(r.skipped).map(([k, v]) => k + ' (' + v + ')').join(', ') || 'none') + '. Balances carry forward automatically.';
$('yprev').onclick = async () => { $('yinfo').textContent = yeText(await call('yearEndPreview', {finalClass: $('yfin').value})); };
$('yrun').onclick = async () => {
  const r = await call('yearEndPreview', {finalClass: $('yfin').value});
  if (!confirm(yeText(r) + '\n\nA backup file will be downloaded first. Continue?')) return;
  const pin = await askPin('PIN required for year-end'); if (pin === null) return;
  await backup(pin); await call('yearEnd', {pin, finalClass: $('yfin').value});
  toast('Year-end completed'); $('yinfo').textContent = ''; loadAudit();
};
async function loadAudit() { table('atab', ['Time', 'User', 'Action', 'Details'], await call('audit')); }
$('aload').onclick = loadAudit;

/* ---- reset / clear data: 5 taps + PIN ---- */
let rtaps = 0, rtimer;
$('rreset').onclick = async () => {
  clearTimeout(rtimer); rtaps++;
  if (rtaps < 5) {
    $('rinfo').textContent = 'Tap ' + (5 - rtaps) + ' more time(s) to unlock reset...';
    rtimer = setTimeout(() => { rtaps = 0; $('rinfo').textContent = ''; }, 5000);
    return;
  }
  rtaps = 0; $('rinfo').textContent = '';
  const all = $('rscope').value === 'all';
  if (!confirm('This permanently erases ' + (all ? 'ALL students, transactions, transfers and closings' : 'all transactions, transfers and closings') + '. A backup file is downloaded first. Continue?')) return;
  const pin = await askPin('PIN required to reset data'); if (pin === null) return;
  await backup(pin);
  await call('resetData', {pin, scope: $('rscope').value});
  toast('Data cleared'); loadAudit();
};
