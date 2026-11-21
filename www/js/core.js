'use strict';
/* K-EDIT STUDIO - core utilities, UI kit, storage, undo/redo store */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const U = {
  uid: (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4),
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  deep: o => JSON.parse(JSON.stringify(o)),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  fmt(s, ms = false) {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    let r = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    if (ms) r += '.' + String(Math.floor((s % 1) * 10));
    return r;
  },
  size(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  },
  debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  raf(fn) { let q = false; return (...a) => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(...a); }); }; },
  ease: {
    linear: t => t,
    out: t => 1 - Math.pow(1 - t, 3),
    in: t => t * t * t,
    inOut: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  },
  hex2rgb(hex) {
    hex = (hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  },
  rgb2hex(r, g, b) { return '#' + [r, g, b].map(v => U.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); },
  even: n => Math.max(2, Math.round(n / 2) * 2),
  canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; },
  blobToCanvas: async (blob, maxDim = 99999) => {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const c = U.canvas(bmp.width * k, bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  },
  canvasToBlob: (c, type = 'image/png', q = 0.92) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Canvas export failed (image too large for device memory?)')), type, q)),
  isLowEnd: () => (navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4),
};

/* tiny hyperscript */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) return k.forEach(add);
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  return el;
}
const ic = (name, size) => h('span', { class: 'icw', html: Icons.get(name, size) });

const Bus = {
  m: {},
  on(e, f) { (this.m[e] = this.m[e] || []).push(f); return () => this.off(e, f); },
  off(e, f) { this.m[e] = (this.m[e] || []).filter(x => x !== f); },
  emit(e, d) { (this.m[e] || []).slice().forEach(f => { try { f(d); } catch (err) { console.error('Bus', e, err); } }); },
};

/* ---------- Settings ---------- */
const Settings = {
  d: null,
  load() { try { this.d = JSON.parse(localStorage.getItem('kedit_settings') || '{}'); } catch (e) { this.d = {}; } },
  get(k, def) { if (!this.d) this.load(); return this.d[k] === undefined ? def : this.d[k]; },
  set(k, v) { if (!this.d) this.load(); this.d[k] = v; try { localStorage.setItem('kedit_settings', JSON.stringify(this.d)); } catch (e) { console.warn(e); } },
};

/* ---------- IndexedDB ---------- */
const DB = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('kedit', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('rev')) d.createObjectStore('rev', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const rq = fn(s);
      t.oncomplete = () => res(rq ? rq.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('IndexedDB aborted (storage full?)'));
    });
  },
  get: (s, k) => DB.tx(s, 'readonly', st => st.get(k)),
  put: (s, v) => DB.tx(s, 'readwrite', st => st.put(v)),
  del: (s, k) => DB.tx(s, 'readwrite', st => st.delete(k)),
  all: s => DB.tx(s, 'readonly', st => st.getAll()),
};

/* ---------- Files (browser + Capacitor) ---------- */
const Files = {
  native: () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()),
  plug: n => window.Capacitor && Capacitor.Plugins && Capacitor.Plugins[n],
  pick({ accept = '*/*', multiple = false } = {}) {
    return new Promise(resolve => {
      const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
      if (multiple) inp.multiple = true;
      document.body.appendChild(inp);
      let done = false;
      const fin = v => { if (done) return; done = true; inp.remove(); resolve(v); };
      inp.addEventListener('change', () => fin(Array.from(inp.files || [])));
      inp.addEventListener('cancel', () => fin([]));
      inp.click();
    });
  },
  b64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] || '');
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  },
  /* Saves a Blob to the device. Returns {where, uri?} */
  async saveBlob(blob, name) {
    const FS = this.plug('Filesystem');
    if (this.native() && FS) {
      const CH = 3 * 1024 * 1024;
      const tries = [['DOCUMENTS', 'KEdit/' + name], ['EXTERNAL', 'KEdit/' + name], ['CACHE', name]];
      let lastErr;
      for (const [dir, path] of tries) {
        try {
          for (let off = 0, first = true; off < blob.size || first; off += CH, first = false) {
            const data = await this.b64(blob.slice(off, off + CH));
            if (first) await FS.writeFile({ path, data, directory: dir, recursive: true });
            else await FS.appendFile({ path, data, directory: dir });
          }
          const { uri } = await FS.getUri({ path, directory: dir });
          return { where: dir === 'DOCUMENTS' ? 'Documents/KEdit' : dir === 'EXTERNAL' ? 'App storage/KEdit' : 'Cache', uri, path, dir };
        } catch (e) { lastErr = e; console.warn('save failed in', dir, e); }
      }
      throw new Error('Could not save file: ' + (lastErr && lastErr.message || lastErr));
    }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, style: { display: 'none' } });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { where: 'Downloads' };
  },
  async share(res, title = 'K-Edit') {
    const Sh = this.plug('Share');
    if (Sh && res && res.uri) { try { await Sh.share({ title, url: res.uri, dialogTitle: title }); return true; } catch (e) { console.warn(e); } }
    return false;
  },
};

/* ---------- UI kit ---------- */
const UI = {
  _toastT: null,
  toast(msg, type = 'info', ms = 2600) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  },
  busy(text = 'Working…', { cancel } = {}) {
    const root = $('#busy');
    const bar = $('#busy-bar'), tx = $('#busy-text'), cb = $('#busy-cancel');
    tx.textContent = text; bar.style.width = '0%'; bar.parentElement.style.display = 'none';
    root.classList.add('show');
    cb.style.display = cancel ? 'block' : 'none';
    cb.onclick = () => { cb.disabled = true; cancel && cancel(); };
    cb.disabled = false;
    const api = {
      set(t, pct) {
        if (t != null) tx.textContent = t;
        if (pct != null) { bar.parentElement.style.display = 'block'; bar.style.width = Math.round(U.clamp(pct, 0, 1) * 100) + '%'; }
      },
      done() { root.classList.remove('show'); },
    };
    return api;
  },
  /* modal bottom sheet. content: Node */
  modal({ title, body, actions, onClose, wide } = {}) {
    const root = $('#modal-root');
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: 'modal' + (wide ? ' wide' : '') });
    const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 180); onClose && onClose(); };
    if (title) box.append(h('div', { class: 'modal-h' }, h('h3', null, title), h('button', { class: 'ibtn', onclick: close, html: Icons.get('close', 20) })));
    box.append(h('div', { class: 'modal-b' }, body));
    if (actions) box.append(h('div', { class: 'modal-a' }, actions.map(a => h('button', { class: 'btn ' + (a.kind || ''), onclick: async () => { const r = a.onClick ? await a.onClick(close) : undefined; if (r !== false && !a.keep) close(); } }, a.label))));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    root.append(back);
    requestAnimationFrame(() => back.classList.add('show'));
    return { close, box };
  },
  prompt({ title, value = '', multiline = false, placeholder = '', ok = 'OK' }) {
    return new Promise(resolve => {
      const inp = multiline ? h('textarea', { class: 'inp', rows: 4, placeholder }) : h('input', { class: 'inp', type: 'text', placeholder });
      inp.value = value;
      let res = null;
      UI.modal({
        title, body: inp,
        actions: [{ label: 'Cancel', onClick: () => { res = null; } }, { label: ok, kind: 'primary', onClick: () => { res = inp.value; } }],
        onClose: () => resolve(res),
      });
      setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 250);
    });
  },
  confirm(title, text, ok = 'OK') {
    return new Promise(resolve => {
      let res = false;
      UI.modal({ title, body: h('p', { class: 'muted' }, text), actions: [{ label: 'Cancel' }, { label: ok, kind: 'primary', onClick: () => { res = true; } }], onClose: () => resolve(res) });
    });
  },
  /* list chooser: options [{label, sub, icon, value}] */
  choose(title, options) {
    return new Promise(resolve => {
      let res = null, m;
      const list = h('div', { class: 'choose' }, options.map(o => h('button', { class: 'choose-i', onclick: () => { res = o.value; m.close(); } },
        o.icon ? ic(o.icon, 22) : null, h('div', null, h('b', null, o.label), o.sub ? h('small', null, o.sub) : null))));
      m = UI.modal({ title, body: list, onClose: () => resolve(res) });
    });
  },
  slider({ label, min = 0, max = 100, step = 1, value = 0, def, unit = '', fmt, onInput, onChange }) {
    const vEl = h('span', { class: 'sl-v' });
    const inp = h('input', { type: 'range', min, max, step, value });
    const show = v => { vEl.textContent = fmt ? fmt(+v) : (Math.abs(step) < 1 ? (+v).toFixed(2) : Math.round(+v)) + unit; const pct = (v - min) / (max - min) * 100; inp.style.setProperty('--p', pct + '%'); };
    show(value);
    inp.addEventListener('input', () => { show(inp.value); onInput && onInput(+inp.value); });
    inp.addEventListener('change', () => onChange && onChange(+inp.value));
    const lab = h('span', { class: 'sl-l', onclick: () => { if (def !== undefined) { inp.value = def; show(def); onInput && onInput(def); onChange && onChange(def); } } }, label);
    const el = h('div', { class: 'sl' }, h('div', { class: 'sl-top' }, lab, vEl), inp);
    el.set = v => { inp.value = v; show(v); };
    el.input = inp;
    return el;
  },
  seg(options, value, onChange) {
    const el = h('div', { class: 'seg' });
    options.forEach(o => {
      const b = h('button', { class: o.value === value ? 'on' : '', onclick: () => { $$('button', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(o.value); } }, o.label);
      el.append(b);
    });
    return el;
  },
  chips(options, value, onChange, cls = '') {
    const el = h('div', { class: 'chips ' + cls });
    options.forEach(o => {
      const b = h('button', { class: 'chip' + (o.value === value ? ' on' : ''), title: o.title || '', onclick: () => { $$('.chip', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); onChange(o.value); } }, o.icon ? ic(o.icon, 18) : null, o.label != null ? h('span', null, o.label) : null);
      el.append(b);
    });
    el.pick = v => $$('.chip', el).forEach((x, i) => x.classList.toggle('on', options[i].value === v));
    return el;
  },
  color(value, onInput, onChange) {
    const sw = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff2d55', '#8e8e93'];
    const inp = h('input', { type: 'color', value: value || '#ffffff' });
    inp.addEventListener('input', () => onInput && onInput(inp.value));
    inp.addEventListener('change', () => onChange && onChange(inp.value));
    const el = h('div', { class: 'colors' }, inp, sw.map(c => h('button', { class: 'cswatch', style: { background: c }, onclick: () => { inp.value = c; onInput && onInput(c); onChange && onChange(c); } })));
    el.set = v => { inp.value = v; };
    return el;
  },
  empty(icon, title, sub) { return h('div', { class: 'empty' }, ic(icon, 44), h('b', null, title), sub ? h('small', null, sub) : null); },
};

/* ---------- Project store with undo / redo ---------- */
const Store = {
  project: null, undoS: [], redoS: [], lastKey: null, lastT: 0,
  load(p) { this.project = p; this.undoS = []; this.redoS = []; this.lastKey = null; Model.relayout(p); Bus.emit('project:loaded'); Bus.emit('change', {}); },
  snap() { return JSON.stringify(this.project); },
  push(key) {
    const now = performance.now();
    if (!(key && key === this.lastKey && now - this.lastT < 900)) {
      this.undoS.push(this.snap());
      if (this.undoS.length > 80) this.undoS.shift();
      this.redoS.length = 0;
    }
    this.lastKey = key || null; this.lastT = now;
  },
  /* edit with undo capture. fn(project) mutates. */
  edit(fn, key) { this.push(key); fn(this.project); this.project.updated = Date.now(); Model.relayout(this.project); Bus.emit('change', {}); },
  /* gesture: one snapshot at begin, live mutations after */
  begin(key) { this.push(key || U.uid('g')); this.lastKey = null; },
  live(fn) { fn(this.project); this.project.updated = Date.now(); Model.relayout(this.project); Bus.emit('change', { live: true }); },
  undo() {
    if (!this.undoS.length) return false;
    this.redoS.push(this.snap());
    this.project = JSON.parse(this.undoS.pop()); this.lastKey = null;
    Model.relayout(this.project); Bus.emit('change', { history: true }); return true;
  },
  redo() {
    if (!this.redoS.length) return false;
    this.undoS.push(this.snap());
    this.project = JSON.parse(this.redoS.pop()); this.lastKey = null;
    Model.relayout(this.project); Bus.emit('change', { history: true }); return true;
  },
};

window.addEventListener('error', e => { console.error('Unhandled:', e.message); });
window.addEventListener('unhandledrejection', e => { console.error('Unhandled promise:', e.reason); });
