/** Vidhyanidhi – Student Banking System (Google Apps Script backend)
 *  1) Run setup() once   2) Deploy > Web app (Execute as: Me, Access: Anyone)
 *  Default login: admin / admin123  (change it after first login)            */

const TABS = {
  Users: ['Username', 'Hash', 'Salt', 'Role', 'Name'],
  Students: ['LF No', 'Admission No', 'Name', 'Class', 'Division', 'Status'],
  Transactions: ['ID', 'Date', 'LF No', 'Name', 'Class', 'Type', 'Amount', 'New Book', 'Note', 'User', 'Timestamp'],
  Transfers: ['ID', 'Date', 'Type', 'Holder', 'Amount', 'User', 'Timestamp'],
  Settings: ['Key', 'Value'],
  Audit: ['Time', 'User', 'Action', 'Details'],
  Closings: ['Date', 'Expected', 'Counted', 'Difference', 'Note', 'User', 'Timestamp']
};
const TEXTCOLS = { Students: [1, 2], Transactions: [2, 3], Transfers: [2], Audit: [1], Closings: [1] };
const TZ = Session.getScriptTimeZone();
const SHEET_ID = '1Ba_VbHIiwGhFHwnjNhYTUOwSzomgUoK154NzD0E7ER8';   // your Google Sheet
let _ss;
const ss = () => _ss || (_ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet());
const S = x => String(x == null ? '' : x).trim();
const uid = () => Utilities.getUuid().slice(0, 8);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function doGet() {
  try {   // older all-in-Apps-Script version (only if an 'Index' HTML file exists)
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Vidhyanidhi Collection')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (e) { return ContentService.createTextOutput('Vidhyanidhi API is running.'); }
}

/** JSON API used by the GitHub Pages site. Body: {action, token, payload} */
function doPost(e) {
  let out;
  try {
    const b = JSON.parse(e.postData.contents);
    out = { ok: true, data: b.action === 'login' ? login(b.payload.u, b.payload.p) : api(b.token, b.action, b.payload) };
  } catch (err) {
    out = { ok: false, error: String(err.message || err).replace(/^(Error|Exception):\s*/, '') };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function setup() {
  Object.keys(TABS).forEach(n => {
    const sh = ss().getSheetByName(n) || ss().insertSheet(n);
    if (sh.getLastRow() === 0) {
      sh.appendRow(TABS[n]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, TABS[n].length).setFontWeight('bold').setBackground('#78903a').setFontColor('#ffffff');
    }
    (TEXTCOLS[n] || []).forEach(c => sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@'));
  });
  if (!rows('Users').length) addUser_('admin', 'admin123', 'admin', 'Administrator');
  if (!getSet_('PinHash')) setPin_('1234');   // default admin PIN - change it in Admin panel
}
function ensure_() {   // auto-creates any new sheets on first login after an update
  const c = CacheService.getScriptCache();
  if (c.get('ready3')) return;
  setup(); c.put('ready3', '1', 3600);
}

/* ---------- helpers ---------- */
function rows(name) {
  const sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues(), h = v[0];
  return v.slice(1).map((r, i) => {
    const o = { _r: i + 2 };
    h.forEach((k, j) => { let x = r[j]; if (x instanceof Date) x = Utilities.formatDate(x, TZ, 'yyyy-MM-dd'); o[k] = x; });
    return o;
  });
}
function hash_(salt, pw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function addUser_(u, pw, role, name) {
  const salt = Utilities.getUuid();
  ss().getSheetByName('Users').appendRow([u, hash_(salt, pw), salt, role, name]);
}
function need_(u) { if (u.role !== 'admin') throw new Error('Admin access required'); }
function bal_() {
  const m = {};
  rows('Transactions').forEach(t => { const k = S(t['LF No']); m[k] = (m[k] || 0) + (t.Type === 'Deposit' ? 1 : -1) * Number(t.Amount); });
  return m;
}
const stu_ = (s, b) => ({ lf: S(s['LF No']), adm: S(s['Admission No']), name: s.Name, cls: S(s.Class), div: S(s.Division), status: s.Status, balance: b || 0 });
function checkDate_(d) { if (!DATE_RE.test(S(d))) throw new Error('Invalid date'); }
function checkAmt_(a) { a = Number(a); if (!(a > 0)) throw new Error('Enter a valid amount'); return Math.round(a * 100) / 100; }

/* ---------- authentication ---------- */
function login(u, p) {
  ensure_();
  u = S(u).toLowerCase();
  const c = CacheService.getScriptCache(), k = 'fail_' + u, f = Number(c.get(k) || 0);
  if (f >= 5) throw new Error('Too many attempts. Try again in 10 minutes.');
  const us = rows('Users').find(x => S(x.Username).toLowerCase() === u);
  if (!us || hash_(us.Salt, p) !== us.Hash) { c.put(k, String(f + 1), 600); throw new Error('Invalid username or password'); }
  c.remove(k);
  const user = { u: S(us.Username), role: us.Role, name: us.Name };
  const t = Utilities.getUuid() + Utilities.getUuid();
  c.put('s_' + t, JSON.stringify(user), 21600);
  return { token: t, user };
}
function auth_(t) {
  const s = CacheService.getScriptCache().get('s_' + t);
  if (!s) throw new Error('Session expired. Please log in again.');
  return JSON.parse(s);
}

/* ---------- single API entry point ---------- */
function api(token, action, p) {
  const u = auth_(token);
  const fn = ACTIONS[action];
  if (!fn) throw new Error('Unknown action');
  const r = fn(p || {}, u, token);
  if (LOGGED[action]) log_(u, action, detail_(p || {}));
  return r;
}

const ACTIONS = {
  logout(p, u, t) { CacheService.getScriptCache().remove('s_' + t); return true; },

  dashboard() {
    const tx = rows('Transactions'), tr = rows('Transfers');
    const sum = (a, f) => a.filter(f).reduce((s, x) => s + Number(x.Amount), 0);
    const income = sum(tx, t => t.Type === 'Deposit'), wd = sum(tx, t => t.Type === 'Withdraw'), bank = sum(tr, t => t.Type === 'Bank');
    const holders = {};
    tr.filter(t => t.Type === 'Person').forEach(t => holders[t.Holder] = (holders[t.Holder] || 0) + Number(t.Amount));
    const held = Object.values(holders).reduce((a, b) => a + b, 0);
    return { income, wd, bank, holders, cash: income - wd - bank - held, recent: tx.slice(-15).reverse(), transfers: tr.slice(-5).reverse() };
  },

  student(p) {
    const lf = S(p.lf), s = rows('Students').find(x => S(x['LF No']) === lf);
    if (!s) throw new Error('LF No ' + lf + ' not found');
    if (s.Status !== 'Active') throw new Error('Student is inactive');
    return stu_(s, bal_()[lf]);
  },

  students() { const b = bal_(); return rows('Students').map(s => stu_(s, b[S(s['LF No'])])); },

  meta() { return [...new Set(rows('Students').map(s => S(s.Class) + '-' + S(s.Division)))].sort(); },

  saveStudent(p, u) {
    const lf = S(p.lf), adm = S(p.adm), name = S(p.name), cls = S(p.cls), div = S(p.div).toUpperCase(), orig = S(p.orig);
    if (!lf || !adm || !name || !cls) throw new Error('LF No, Admission No, Name and Class are required');
    const all = rows('Students');
    if (all.some(x => S(x['LF No']) === lf && S(x['LF No']) !== orig)) throw new Error('LF No already exists');
    if (all.some(x => S(x['Admission No']) === adm && S(x['LF No']) !== orig)) throw new Error('Admission No already exists');
    const sh = ss().getSheetByName('Students');
    if (orig) {
      const o = all.find(x => S(x['LF No']) === orig);
      if (!o) throw new Error('Student not found');
      if (lf !== orig && rows('Transactions').some(t => S(t['LF No']) === orig)) throw new Error('LF No cannot change after transactions exist');
      sh.getRange(o._r, 1, 1, 6).setValues([[lf, adm, name, cls, div, p.status || 'Active']]);
    } else sh.appendRow([lf, adm, name, cls, div, 'Active']);
    return true;
  },

  deleteStudent(p, u) {
    need_(u);
    const lf = S(p.lf), o = rows('Students').find(x => S(x['LF No']) === lf);
    if (!o) throw new Error('Student not found');
    const sh = ss().getSheetByName('Students');
    if (rows('Transactions').some(t => S(t['LF No']) === lf)) { sh.getRange(o._r, 6).setValue('Inactive'); return 'Student has transactions, so marked Inactive instead of deleted.'; }
    sh.deleteRow(o._r); return 'Student deleted.';
  },

  importStudents(p, u) {
    need_(u);
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const ex = rows('Students'), lfs = new Set(ex.map(x => S(x['LF No']))), adms = new Set(ex.map(x => S(x['Admission No'])));
      const add = [], op = [], err = [], today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
      (p.rows || []).forEach((r, i) => {
        const n = i + 2, lf = S(r.lf), adm = S(r.adm), name = S(r.name), cls = S(r.cls), div = S(r.div).toUpperCase(), ob = Number(r.open || 0);
        if (!lf || !adm || !name || !cls) return err.push('Row ' + n + ': missing LF No / Admission No / Name / Class');
        if (lfs.has(lf)) return err.push('Row ' + n + ': duplicate LF No ' + lf);
        if (adms.has(adm)) return err.push('Row ' + n + ': duplicate Admission No ' + adm);
        if (isNaN(ob) || ob < 0) return err.push('Row ' + n + ': invalid opening balance');
        lfs.add(lf); adms.add(adm); add.push([lf, adm, name, cls, div, 'Active']);
        if (ob > 0) op.push([uid(), today, lf, name, cls, 'Deposit', ob, 'No', 'Opening balance', u.u, new Date()]);
      });
      if (add.length) { const sh = ss().getSheetByName('Students'); sh.getRange(sh.getLastRow() + 1, 1, add.length, 6).setValues(add); }
      if (op.length) { const sh = ss().getSheetByName('Transactions'); sh.getRange(sh.getLastRow() + 1, 1, op.length, 11).setValues(op); }
      return { added: add.length, errors: err };
    } finally { lock.releaseLock(); }
  },

  addTxn(p, u) {
    checkDate_(p.date);
    const amt = checkAmt_(p.amount), type = p.type === 'Withdraw' ? 'Withdraw' : 'Deposit', lf = S(p.lf);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const s = rows('Students').find(x => S(x['LF No']) === lf);
      if (!s || s.Status !== 'Active') throw new Error('Active student with LF No ' + lf + ' not found');
      const b = bal_()[lf] || 0;
      if (type === 'Withdraw' && amt > b) throw new Error('Insufficient balance. Available: ' + b.toFixed(2));
      const id = uid();
      ss().getSheetByName('Transactions').appendRow([id, p.date, lf, s.Name, S(s.Class) + '-' + S(s.Division), type, amt, p.newBook === 'Yes' ? 'Yes' : 'No', S(p.note), u.u, new Date()]);
      return { id, balance: b + (type === 'Deposit' ? amt : -amt) };
    } finally { lock.releaseLock(); }
  },

  deleteTxn(p, u) {
    need_(u);
    const t = rows('Transactions').find(x => x.ID === p.id);
    if (t) ss().getSheetByName('Transactions').deleteRow(t._r);
    return true;
  },

  addTransfer(p, u) {
    checkDate_(p.date);
    const amt = checkAmt_(p.amount), type = p.type === 'Person' ? 'Person' : 'Bank', holder = S(p.holder);
    if (type === 'Person' && !holder) throw new Error('Enter the person name');
    ss().getSheetByName('Transfers').appendRow([uid(), p.date, type, type === 'Bank' ? 'Bank' : holder, amt, u.u, new Date()]);
    return true;
  },

  deleteTransfer(p, u) {
    need_(u);
    const t = rows('Transfers').find(x => x.ID === p.id);
    if (t) ss().getSheetByName('Transfers').deleteRow(t._r);
    return true;
  },

  report(p) { return report_(p); },

  txns(p) { const lf = S(p.lf); let l = rows('Transactions'); if (lf) l = l.filter(t => S(t['LF No']) === lf); return l.slice(-30).reverse(); },

  receipt(p) {
    const all = rows('Transactions'), t = all.find(x => x.ID === p.id);
    if (!t) throw new Error('Transaction not found');
    const lf = S(t['LF No']);
    const bal = all.filter(x => S(x['LF No']) === lf && x._r <= t._r).reduce((s, x) => s + (x.Type === 'Deposit' ? 1 : -1) * Number(x.Amount), 0);
    const st = rows('Students').find(x => S(x['LF No']) === lf) || {};
    return { id: t.ID, date: t.Date, lf, adm: S(st['Admission No']), name: t.Name, cls: S(t.Class), type: t.Type, amount: Number(t.Amount), balance: bal, by: t.User, note: t.Note };
  },

  editTxn(p, u) {
    need_(u); checkDate_(p.date);
    const amt = checkAmt_(p.amount), type = p.type === 'Withdraw' ? 'Withdraw' : 'Deposit';
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const t = rows('Transactions').find(x => x.ID === p.id);
      if (!t) throw new Error('Transaction not found');
      const lf = S(t['LF No']), sg = y => y === 'Deposit' ? 1 : -1;
      const nb = (bal_()[lf] || 0) - sg(t.Type) * Number(t.Amount) + sg(type) * amt;
      if (nb < -0.001) throw new Error('This change would make the balance negative (' + nb.toFixed(2) + ')');
      const sh = ss().getSheetByName('Transactions');
      sh.getRange(t._r, 2).setValue(p.date); sh.getRange(t._r, 6, 1, 2).setValues([[type, amt]]); sh.getRange(t._r, 9).setValue(S(p.note));
      log_(u, 'editTxn', 'ID ' + t.ID + ' LF ' + lf + ': ' + t.Date + ' ' + t.Type + ' ' + t.Amount + ' -> ' + p.date + ' ' + type + ' ' + amt);
      return { balance: nb };
    } finally { lock.releaseLock(); }
  },

  closingInfo(p) {
    checkDate_(p.date);
    const d = p.date, tx = rows('Transactions').filter(t => t.Date === d), tr = rows('Transfers').filter(t => t.Date === d), c = rows('Closings');
    const sum = (a, f) => a.filter(f).reduce((s, x) => s + Number(x.Amount), 0), x = c.find(r => S(r.Date) === d);
    return { dep: sum(tx, t => t.Type === 'Deposit'), wd: sum(tx, t => t.Type === 'Withdraw'), tr: sum(tr, () => true), expected: cashAt_(d),
      closing: x ? { counted: Number(x.Counted), note: x.Note } : null, list: c.slice(-30).reverse() };
  },

  saveClosing(p, u) {
    checkDate_(p.date);
    const counted = Number(p.counted);
    if (p.counted === '' || isNaN(counted) || counted < 0) throw new Error('Enter the counted cash amount');
    const expected = cashAt_(p.date), diff = Math.round((counted - expected) * 100) / 100;
    const row = [p.date, expected, counted, diff, S(p.note), u.u, new Date()], sh = ss().getSheetByName('Closings');
    const ex = rows('Closings').find(x => S(x.Date) === p.date);
    if (ex) sh.getRange(ex._r, 1, 1, 7).setValues([row]); else sh.appendRow(row);
    return { expected, diff };
  },

  audit(p, u) { need_(u); return rows('Audit').slice(-200).reverse().map(a => [a.Time, a.User, a.Action, a.Details]); },

  setPin(p, u) {
    need_(u); checkPin_(u, p.old);
    if (!/^\d{4}$/.test(S(p.neu))) throw new Error('PIN must be exactly 4 digits');
    setPin_(S(p.neu)); return true;
  },

  exportData(p, u) {
    need_(u); checkPin_(u, p.pin);
    const o = {};
    BACKUP.forEach(n => { o[n] = ss().getSheetByName(n).getDataRange().getValues().map(r => r.map(x => x instanceof Date ? Utilities.formatDate(x, TZ, 'yyyy-MM-dd HH:mm:ss') : x)); });
    return o;
  },

  importData(p, u) {
    need_(u); checkPin_(u, p.pin);
    const data = p.data || {}, rep = p.mode === 'replace', res = {};
    BACKUP.forEach(n => { const d = data[n]; if (d && d.length && S(d[0].join('|')) !== TABS[n].join('|')) throw new Error('Sheet "' + n + '" has wrong columns. Use a file exported from this app.'); });
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      BACKUP.forEach(n => {
        const d = data[n]; if (!d || !d.length) return;
        const sh = ss().getSheetByName(n), w = TABS[n].length, tc = TEXTCOLS[n] || [];
        let body = d.slice(1).filter(r => r.some(c => S(c) !== '')).map(r => r.slice(0, w));
        if (rep) { if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, w).clearContent(); }
        else { const have = new Set(rows(n).map(x => S(x[TABS[n][0]]))); body = body.filter(r => !have.has(S(r[0]))); }
        body = body.map(r => { while (r.length < w) r.push(''); return r.map((c, j) => tc.includes(j + 1) ? S(c) : c); });
        res[n] = body.length;
        if (!body.length) return;
        const start = rep ? 2 : sh.getLastRow() + 1, need = start + body.length - 1;
        if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
        sh.getRange(start, 1, body.length, w).setValues(body);
      });
      return res;
    } finally { lock.releaseLock(); }
  },

  yearEndPreview(p, u) { need_(u); return yearEnd_(Number(p.finalClass), false); },
  yearEnd(p, u) { need_(u); checkPin_(u, p.pin); return yearEnd_(Number(p.finalClass), true); },

  /* ----- users ----- */
  listUsers(p, u) { need_(u); return rows('Users').map(x => ({ username: S(x.Username), name: x.Name, role: x.Role })); },

  saveUser(p, u) {
    need_(u);
    const un = S(p.username).toLowerCase(), pw = S(p.password);
    if (!/^[a-z0-9_.]{3,}$/.test(un)) throw new Error('Username: min 3 chars, letters/numbers/._ only');
    const role = p.role === 'admin' ? 'admin' : 'staff', ex = rows('Users').find(x => S(x.Username).toLowerCase() === un);
    const sh = ss().getSheetByName('Users');
    if (ex) {
      if (pw) { if (pw.length < 6) throw new Error('Password must be at least 6 characters'); const salt = Utilities.getUuid(); sh.getRange(ex._r, 2, 1, 2).setValues([[hash_(salt, pw), salt]]); }
      sh.getRange(ex._r, 4, 1, 2).setValues([[role, S(p.name) || ex.Name]]);
    } else {
      if (pw.length < 6) throw new Error('Password must be at least 6 characters');
      addUser_(un, pw, role, S(p.name) || un);
    }
    return true;
  },

  deleteUser(p, u) {
    need_(u);
    const un = S(p.username).toLowerCase();
    if (un === u.u.toLowerCase()) throw new Error('You cannot delete yourself');
    const x = rows('Users').find(r => S(r.Username).toLowerCase() === un);
    if (x) ss().getSheetByName('Users').deleteRow(x._r);
    return true;
  },

  changePassword(p, u) {
    const x = rows('Users').find(r => S(r.Username).toLowerCase() === u.u.toLowerCase());
    if (!x || hash_(x.Salt, p.old) !== x.Hash) throw new Error('Current password is incorrect');
    if (S(p.neu).length < 6) throw new Error('New password must be at least 6 characters');
    const salt = Utilities.getUuid();
    ss().getSheetByName('Users').getRange(x._r, 2, 1, 2).setValues([[hash_(salt, p.neu), salt]]);
    return true;
  }
};

/* ---------- reports: return {title, headers, rows, footer} ---------- */
function report_(p) {
  const inRange = d => (!p.from || d >= p.from) && (!p.to || d <= p.to);
  const range = (p.from || p.to) ? ' (' + (p.from || '…') + ' to ' + (p.to || '…') + ')' : '';
  const students = rows('Students'), tx = rows('Transactions');

  if (p.name === 'passbook') {
    const lf = S(p.lf), s = students.find(x => S(x['LF No']) === lf);
    if (!s) throw new Error('LF No not found');
    let b = 0;
    const list = tx.filter(t => S(t['LF No']) === lf).sort((a, c) => a.Date < c.Date ? -1 : a.Date > c.Date ? 1 : 0);
    const r = list.map(t => {
      const d = t.Type === 'Deposit' ? Number(t.Amount) : 0, w = t.Type === 'Withdraw' ? Number(t.Amount) : 0;
      b += d - w; return [t.Date, t.Type, d || '', w || '', b, t.Note];
    });
    return { title: 'Passbook - ' + s.Name + ' | LF ' + lf + ' | Adm ' + S(s['Admission No']) + ' | Class ' + S(s.Class) + '-' + S(s.Division),
      headers: ['Date', 'Type', 'Deposit', 'Withdraw', 'Balance', 'Note'], rows: r, footer: [['', 'Closing balance', '', '', b, '']] };
  }
  if (p.name === 'daily') {
    const list = tx.filter(t => inRange(t.Date)).sort((a, c) => a.Date < c.Date ? -1 : a.Date > c.Date ? 1 : 0);
    const dep = list.filter(t => t.Type === 'Deposit').reduce((s, t) => s + Number(t.Amount), 0);
    const wd = list.filter(t => t.Type === 'Withdraw').reduce((s, t) => s + Number(t.Amount), 0);
    return { title: 'Collection Report' + range, headers: ['Date', 'LF No', 'Name', 'Class', 'Type', 'Amount'],
      rows: list.map(t => [t.Date, S(t['LF No']), t.Name, S(t.Class), t.Type, Number(t.Amount)]),
      footer: [['', '', '', '', 'Total Deposit', dep], ['', '', '', '', 'Total Withdraw', wd]] };
  }
  if (p.name === 'classwise') {
    const g = {}, b = bal_();
    students.forEach(s => { const k = S(s.Class) + '-' + S(s.Division); g[k] = g[k] || { n: 0, d: 0, w: 0 }; g[k].n++; });
    const cur = {}; students.forEach(s => cur[S(s['LF No'])] = S(s.Class) + '-' + S(s.Division));
    tx.forEach(t => { const k = cur[S(t['LF No'])] || S(t.Class); g[k] = g[k] || { n: 0, d: 0, w: 0 }; if (t.Type === 'Deposit') g[k].d += Number(t.Amount); else g[k].w += Number(t.Amount); });
    const keys = Object.keys(g).sort();
    return { title: 'Class-wise Summary', headers: ['Class-Div', 'Students', 'Deposits', 'Withdrawals', 'Balance'],
      rows: keys.map(k => [k, g[k].n, g[k].d, g[k].w, g[k].d - g[k].w]),
      footer: [['TOTAL', keys.reduce((s, k) => s + g[k].n, 0), keys.reduce((s, k) => s + g[k].d, 0), keys.reduce((s, k) => s + g[k].w, 0), keys.reduce((s, k) => s + g[k].d - g[k].w, 0)]] };
  }
  if (p.name === 'balances') {
    const g = {};
    tx.forEach(t => { const k = S(t['LF No']); g[k] = g[k] || [0, 0]; g[k][t.Type === 'Deposit' ? 0 : 1] += Number(t.Amount); });
    const list = students.filter(s => !p.cls || S(s.Class) + '-' + S(s.Division) === p.cls);
    const r = list.map(s => { const x = g[S(s['LF No'])] || [0, 0]; return [S(s['LF No']), S(s['Admission No']), s.Name, S(s.Class) + '-' + S(s.Division), x[0], x[1], x[0] - x[1]]; });
    return { title: 'Student Balances' + (p.cls ? ' - Class ' + p.cls : ''), headers: ['LF No', 'Adm No', 'Name', 'Class', 'Deposit', 'Withdraw', 'Balance'], rows: r,
      footer: [['', '', 'TOTAL', '', r.reduce((s, x) => s + x[4], 0), r.reduce((s, x) => s + x[5], 0), r.reduce((s, x) => s + x[6], 0)]] };
  }
  if (p.name === 'transfers') {
    const list = rows('Transfers').filter(t => inRange(t.Date));
    return { title: 'Bank / Custody Transfers' + range, headers: ['Date', 'Type', 'Holder', 'Amount', 'By'], rows: list.map(t => [t.Date, t.Type, t.Holder, Number(t.Amount), t.User]),
      footer: [['', '', 'TOTAL', list.reduce((s, t) => s + Number(t.Amount), 0), '']] };
  }
  if (p.name === 'closings') {
    const l = rows('Closings').filter(c => inRange(S(c.Date)));
    return { title: 'Daily Closing' + range, headers: ['Date', 'Expected', 'Counted', 'Difference', 'By', 'Note'],
      rows: l.map(c => [S(c.Date), Number(c.Expected), Number(c.Counted), Number(c.Difference), c.User, c.Note]) };
  }
  throw new Error('Unknown report');
}


/* ---------- audit log, settings, PIN, cash, year-end helpers ---------- */
const LOGGED = { saveStudent: 1, deleteStudent: 1, importStudents: 1, addTxn: 1, deleteTxn: 1, addTransfer: 1, deleteTransfer: 1, saveUser: 1, deleteUser: 1, changePassword: 1, setPin: 1, saveClosing: 1, exportData: 1, importData: 1, yearEnd: 1 };
const BACKUP = ['Students', 'Transactions', 'Transfers', 'Closings'];

function log_(u, action, details) {
  ss().getSheetByName('Audit').appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), u.u, action, S(details).slice(0, 500)]);
}
function detail_(p) {
  const o = {};
  Object.keys(p).forEach(k => { if (['pin', 'password', 'old', 'neu', 'data'].includes(k)) return; o[k] = Array.isArray(p[k]) ? p[k].length + ' items' : p[k]; });
  return JSON.stringify(o);
}
function getSet_(k) { const r = rows('Settings').find(x => x.Key === k); return r ? S(r.Value) : ''; }
function setSet_(k, v) {
  const r = rows('Settings').find(x => x.Key === k), sh = ss().getSheetByName('Settings');
  if (r) sh.getRange(r._r, 2).setValue(v); else sh.appendRow([k, v]);
}
function setPin_(pin) { const salt = Utilities.getUuid(); setSet_('PinSalt', salt); setSet_('PinHash', hash_(salt, pin)); }
function checkPin_(u, pin) {
  const c = CacheService.getScriptCache(), k = 'pinfail_' + u.u, f = Number(c.get(k) || 0);
  if (f >= 5) throw new Error('Too many wrong PIN attempts. Try again in 10 minutes.');
  if (hash_(getSet_('PinSalt'), S(pin)) !== getSet_('PinHash')) { c.put(k, String(f + 1), 600); throw new Error('Wrong PIN'); }
  c.remove(k);
}
function cashAt_(d) {
  const sum = (a, f) => a.filter(f).reduce((s, x) => s + Number(x.Amount), 0);
  const tx = rows('Transactions').filter(t => t.Date <= d), tr = rows('Transfers').filter(t => t.Date <= d);
  return Math.round((sum(tx, t => t.Type === 'Deposit') - sum(tx, t => t.Type === 'Withdraw') - sum(tr, () => true)) * 100) / 100;
}
function yearEnd_(fin, apply) {
  if (!(fin > 0)) throw new Error('Enter the final class number');
  const sh = ss().getSheetByName('Students');
  if (sh.getLastRow() < 2) return { promote: 0, leave: 0, skipped: {} };
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 6), v = rng.getValues(), skipped = {};
  let pr = 0, lv = 0;
  v.forEach(r => {
    if (r[5] !== 'Active') return;
    const c = S(r[3]);
    if (!/^\d+$/.test(c)) { const k = c || '(blank)'; skipped[k] = (skipped[k] || 0) + 1; return; }
    const n = Number(c);
    if (n >= fin) { lv++; if (apply) r[5] = 'Inactive'; } else { pr++; if (apply) r[3] = String(n + 1); }
  });
  if (apply) rng.setValues(v);
  return { promote: pr, leave: lv, skipped };
}
