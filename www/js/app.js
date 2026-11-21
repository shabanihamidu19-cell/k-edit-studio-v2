'use strict';
/* K-EDIT STUDIO - app shell: navigation, projects (save/list), home, AI tools, settings */

const Projects = {
  _t: null,
  async list() {
    const all = await DB.all('projects');
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  async save(p, now) {
    if (!p) return;
    clearTimeout(this._t);
    p.updated = Date.now();
    try { if (Engine.W) p.thumb = Engine.snapshot(200).toDataURL('image/jpeg', .6); } catch (e) { }
    p.duration = p.duration || 0;
    try { await DB.put('projects', JSON.parse(JSON.stringify(p))); }
    catch (e) { UI.toast('Could not save project: ' + e.message, 'error', 5000); }
  },
  saveSoon() { clearTimeout(this._t); this._t = setTimeout(() => { if (Store.project && $('#studio').classList.contains('active')) this.save(Store.project); }, 1500); },
  async addPhoto({ name, thumb, blob }) {
    try { await DB.put('projects', { id: U.uid('ph'), kind: 'photo', name, thumb, blob, updated: Date.now() }); } catch (e) { console.warn(e); }
  },
  async create(kind) {
    const p = Model.newProject({ kind, name: (kind === 'audio' ? 'Audio ' : 'Video ') + new Date().toLocaleDateString() });
    await DB.put('projects', p);
    await App.go('studio', p);
    if (kind === 'audio') setTimeout(() => Editor.audioMenu(), 300); else setTimeout(() => Editor.addMediaMenu(), 300);
  },
  async open(rec) {
    if (rec.kind === 'photo') {
      if (!rec.blob) { UI.toast('This photo was too large to keep inside the app. Open it again from your gallery.', 'error', 4000); return; }
      await App.go('photo'); Photo.open(new File([rec.blob], rec.name + '.png', { type: rec.blob.type }));
    } else App.go('studio', rec);
  },
  async duplicate(rec) {
    const c = JSON.parse(JSON.stringify(rec)); c.id = U.uid(rec.kind === 'photo' ? 'ph' : 'p'); c.name = rec.name + ' copy'; c.updated = Date.now();
    if (rec.blob) c.blob = rec.blob; await DB.put('projects', c); Home.render();
  },
  async remove(rec) { await DB.del('projects', rec.id); Home.render(); },
};

const App = {
  cur: 'home', stack: [],
  screens: ['home', 'studio', 'photo', 'ai', 'settings'],
  async go(name, arg) {
    this.screens.forEach(s => { const el = $('#' + s); el && el.classList.toggle('active', s === name); });
    const prev = this.cur; this.cur = name;
    if (name === 'home') Home.render();
    else if (name === 'ai') Home.renderAI();
    else if (name === 'settings') Home.renderSettings();
    else if (name === 'studio' && arg) { Photo.ready && (Photo.S = null); await Editor.open(arg); }
    else if (name === 'photo') { Photo.mount(); }
    if (prev === 'studio' && name !== 'studio') { Engine.pause(); }
    window.scrollTo(0, 0);
  },
  back() {
    if ($('#modal-root').children.length) { const last = $('#modal-root').lastElementChild; const x = last.querySelector('.modal-h .ibtn'); if (x) { x.click(); return true; } last.remove(); return true; }
    if (this.cur === 'studio') { if (Editor.panelOpen) { Editor.closePanel(); return true; } Editor.exit(); return true; }
    if (this.cur === 'photo') { if (Photo.pn && !Photo.pn.classList.contains('hidden')) { Photo.closePanel(); return true; } Photo.exit(); return true; }
    if (this.cur !== 'home') { this.go('home'); return true; }
    return false;
  },
  init() {
    const A = Files.plug('App');
    if (A && A.addListener) A.addListener('backButton', () => { if (!this.back()) A.exitApp && A.exitApp(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.back(); });
    $$('[data-go]').forEach(b => b.onclick = () => this.go(b.dataset.go));
    window.addEventListener('beforeunload', () => { if (Store.project && this.cur === 'studio') Projects.save(Store.project); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && Store.project && this.cur === 'studio') Projects.save(Store.project); });
    Bus.on('change', () => { if (this.cur === 'studio') Projects.saveSoon(); });
    window.addEventListener('error', e => console.error('Uncaught', e.message, e.filename, e.lineno));
    window.addEventListener('unhandledrejection', e => console.error('Unhandled', e.reason));
    this.go('home');
    setTimeout(() => $('#splash').classList.add('gone'), 450);
  },
};

const Home = {
  async render() {
    const root = $('#home-body'); root.innerHTML = '';
    const tile = (icon, label, sub, fn, cls = '') => h('button', { class: 'tile ' + cls, onclick: fn }, ic(icon, 28), h('b', null, label), h('small', null, sub));
    root.append(
      h('div', { class: 'hero' }, h('div', null, h('h1', null, 'K-EDIT STUDIO'), h('small', null, 'Video • Music • Photo • AI'))),
      h('div', { class: 'tiles' },
        tile('film', 'New video', 'Multi-track timeline', () => Projects.create('video'), 'big'),
        tile('image', 'Photo editor', 'Adjust, cut-out, retouch', async () => { const f = await Files.pick({ accept: 'image/*' }); if (f[0]) { await App.go('photo'); Photo.open(f[0]); } }, 'big'),
        tile('music', 'Audio studio', 'Music, voice, SFX', () => Projects.create('audio')),
        tile('ai', 'AI tools', 'Captions, cut-out, enhance', () => App.go('ai')),
      ),
      h('div', { class: 'sec-h' }, h('b', null, 'Recent'), h('button', { class: 'ibtn', onclick: () => App.go('settings'), html: Icons.get('settings', 22) })));
    const list = await Projects.list();
    if (!list.length) { root.append(UI.empty('film', 'No projects yet', 'Tap “New video” or open a photo to begin')); return; }
    const grid = h('div', { class: 'pgrid' });
    list.forEach(rec => {
      const card = h('div', { class: 'pcard' },
        h('button', { class: 'pthumb checker', onclick: () => Projects.open(rec) }, rec.thumb ? h('img', { src: rec.thumb, alt: '' }) : ic(rec.kind === 'audio' ? 'music' : 'film', 32), h('span', { class: 'badge' }, rec.kind === 'photo' ? 'PHOTO' : rec.kind === 'audio' ? 'AUDIO' : U.fmt(rec.duration || 0))),
        h('div', { class: 'pmeta' }, h('div', null, h('b', null, rec.name), h('small', null, new Date(rec.updated || Date.now()).toLocaleString())), h('button', { class: 'ibtn', onclick: () => this.menu(rec), html: Icons.get('more', 20) })));
      grid.append(card);
    });
    root.append(grid);
  },
  async menu(rec) {
    const c = await UI.choose(rec.name, [{ label: 'Rename', icon: 'text', value: 'ren' }, { label: 'Duplicate', icon: 'copy', value: 'dup' }, { label: 'Delete', icon: 'trash', value: 'del' }]);
    if (c === 'ren') { const n = await UI.prompt({ title: 'Rename', value: rec.name }); if (n && n.trim()) { rec.name = n.trim().slice(0, 60); await DB.put('projects', rec); this.render(); } }
    else if (c === 'dup') Projects.duplicate(rec);
    else if (c === 'del') { if (await UI.confirm('Delete', `Delete “${rec.name}”? This cannot be undone.`, 'Delete')) Projects.remove(rec); }
  },
  renderAI() {
    const root = $('#ai-body'); root.innerHTML = '';
    const c = AI.cfg(); const st = k => c[k] ? '✓ key set' : 'no key';
    const photoTool = (icon, label, sub, key) => h('button', { class: 'choose-i', onclick: async () => { const f = await Files.pick({ accept: 'image/*' }); if (!f[0]) return; await App.go('photo'); await Photo.open(f[0]); key === 'bg' ? Photo.bgPanel && Photo.bgPanel() : key === 'enh' ? Photo.enhancePanel && Photo.enhancePanel() : Photo.retouchPanel && Photo.retouchPanel(); } }, ic(icon, 22), h('div', null, h('b', null, label), h('small', null, sub)));
    root.append(
      h('p', { class: 'muted pad' }, 'AI tools call the providers you configure in Settings. If a call fails you will see the real error – nothing is faked. Local tools (marked “local”) run on the device.'),
      h('div', { class: 'choose pad' },
        photoTool('wand', 'Remove background', `remove.bg ${st('removebg')} • Photoroom ${st('photoroom')} • Clipdrop ${st('clipdrop')} • local auto-cutout`, 'bg'),
        photoTool('ai', 'AI enhance / upscale', `Clipdrop ${st('clipdrop')} • local 2× fallback`, 'enh'),
        photoTool('eraser', 'Object removal', `Clipdrop ${st('clipdrop')} • local fill`, 'rt'),
        h('button', { class: 'choose-i', onclick: () => Projects.create('video') }, ic('captions', 22), h('div', null, h('b', null, 'Auto captions (video)'), h('small', null, `Whisper: Groq ${st('groq')} • OpenAI ${st('openai')} • custom. Open a video project → AI tools`))),
        h('button', { class: 'choose-i', onclick: () => App.go('settings') }, ic('settings', 22), h('div', null, h('b', null, 'Configure providers'), h('small', null, 'API keys and fallback order')))));
  },
  renderSettings() {
    const root = $('#settings-body'); root.innerHTML = '';
    const c = AI.cfg();
    const field = (label, key, ph, test) => {
      const inp = h('input', { class: 'inp', type: 'password', placeholder: ph || 'API key', value: c[key] || '', autocomplete: 'off' });
      inp.onchange = () => { c[key] = inp.value.trim(); AI.save(c); };
      const eye = h('button', { class: 'ibtn', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; }, html: Icons.get('eye', 20) });
      const t = test ? h('button', { class: 'btn sm', onclick: async () => { c[key] = inp.value.trim(); AI.save(c); if (!c[key]) { UI.toast('Enter a key first', 'error'); return; } const b = UI.busy('Testing ' + label + '…'); try { UI.toast(label + ': ' + await AI.test(key), 'success', 4000); } catch (e) { UI.toast(label + ': ' + e.message, 'error', 6000); } finally { b.done(); } } }, 'Test') : null;
      return h('div', { class: 'frow' }, h('div', { class: 'lbl-s' }, label), h('div', { class: 'row' }, inp, eye, t));
    };
    const txt = (label, obj, k, ph, pw) => { const inp = h('input', { class: 'inp', type: pw ? 'password' : 'text', placeholder: ph || '', value: obj[k] || '' }); inp.onchange = () => { obj[k] = inp.value.trim(); AI.save(c); }; return h('div', { class: 'frow' }, h('div', { class: 'lbl-s' }, label), inp); };
    const sec = (t, ...k) => h('section', { class: 'card' }, h('h3', null, t), ...k);
    const pq = UI.seg([{ label: 'Auto', value: 'auto' }, { label: '360p', value: '360' }, { label: '480p', value: '480' }, { label: '720p', value: '720' }], String(Settings.get('previewQ', 'auto')), v => Settings.set('previewQ', v));
    const lim = UI.seg([{ label: '40 MB', value: 40 }, { label: '80 MB', value: 80 }, { label: '200 MB', value: 200 }, { label: '500 MB', value: 500 }], Settings.get('maxStoreMB', 80), v => Settings.set('maxStoreMB', v));
    const dur = UI.slider({ label: 'Default photo length in video', min: 1, max: 10, step: 1, value: Settings.get('imageDur', 4), unit: ' s', onChange: v => Settings.set('imageDur', v) });
    const usage = h('div', { class: 'muted' }, 'Calculating storage…');
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { usage.textContent = `Storage used: ${U.size(e.usage || 0)} of ${U.size(e.quota || 0)}`; });
    root.append(
      sec('Background removal', field('remove.bg', 'removebg', 'remove.bg API key', true), field('Photoroom', 'photoroom', 'Photoroom API key', true), field('Clipdrop (remove-bg, cleanup, upscale)', 'clipdrop', 'Clipdrop API key', true),
        h('details', null, h('summary', null, 'Custom endpoint'), txt('URL (multipart POST, field “image_file”, returns PNG)', c.bgCustom, 'url', 'https://…'), txt('Auth header name', c.bgCustom, 'header', 'Authorization'), txt('Header value', c.bgCustom, 'key', 'Bearer …', true))),
      sec('Auto captions (speech to text)', field('Groq Whisper (free tier available)', 'groq', 'gsk_…', true), field('OpenAI Whisper', 'openai', 'sk-…', true),
        h('details', null, h('summary', null, 'Custom Whisper-compatible endpoint'), txt('URL', c.sttCustom, 'url', 'https://…/v1/audio/transcriptions'), txt('Key', c.sttCustom, 'key', '', true), txt('Model', c.sttCustom, 'model', 'whisper-1')),
        h('p', { class: 'muted' }, 'Providers are tried in this order: Groq → OpenAI → custom. If one fails the next is used; if all fail you see every error.')),
      sec('Editor', h('div', { class: 'lbl-s' }, 'Preview quality (lower = smoother on weak phones)'), pq, h('div', { class: 'lbl-s' }, 'Store imported media inside the app up to'), lim, dur, usage,
        h('p', { class: 'muted' }, 'Keys are stored only on this device. Larger media is not copied; you will be asked to select it again when reopening a project.')),
      sec('About', h('p', { class: 'muted' }, 'K-EDIT STUDIO 2.0 – personal video / music / photo editor. Export uses the Android WebView encoder (MP4 where supported, otherwise WebM), plus GIF, WAV and PNG/JPEG/WebP.')));
  },
};

window.App = App; window.Projects = Projects; window.Home = Home;
window.addEventListener('DOMContentLoaded', () => App.init());
