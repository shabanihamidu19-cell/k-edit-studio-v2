'use strict';
/* K-EDIT STUDIO - studio workspace: selection, toolbars, importing, text/stickers/audio/captions, gizmo, shortcuts */

const Editor = {
  sel: null, gizmo: null, panelOpen: false, pickCb: null, ready: false,

  mount() {
    if (this.ready) return; this.ready = true;
    this.stage = $('#stage'); this.host = $('#stage-host'); this.canvas = $('#stage-canvas');
    this.toolbar = $('#toolbar'); this.panelEl = $('#panel'); this.timeEl = $('#st-time'); this.playBtn = $('#st-play');
    Engine.init(this.canvas);
    Timeline.init($('#tl-host'));
    this.gizmo = new Gizmo(this.host, {
      canvas: this.canvas, size: () => ({ W: Engine.W, H: Engine.H }),
      box: () => { const it = this.cur(); if (!it || !Model.isVisual(it)) return null; if (Engine.t < it.start || Engine.t >= it.start + it.dur) return null; const b = Engine.itemBox(it, Engine.t); return b; },
      tf: () => this.baseTf(this.cur()),
      set: tf => this.applyTf(tf),
      start: () => Store.begin('gz'),
      end: moved => { if (moved) Bus.emit('change', {}); },
      buttons: [{ pos: 'tl', icon: 'close', fn: () => this.del() }, { pos: 'tr', icon: 'copy', fn: () => this.dup() }],
      pick: (x, y) => { if (this.pickCb) { const cb = this.pickCb; this.pickCb = null; cb(x, y); return null; } const it = Engine.hitTest(x, y); return it ? it.id : null; },
      select: id => this.select(id),
      tap: () => { },
    });
    new ResizeObserver(() => this.layoutStage()).observe(this.stage);
    Bus.on('rendered', () => this.gizmo.refresh());
    Bus.on('select', () => this.gizmo.refresh());
    Bus.on('change', () => { this.gizmo.refresh(); this.updateUndo(); if (this.sel && !this.cur()) this.select(null); this.layoutStage(); });
    Bus.on('time', t => { this.timeEl.textContent = U.fmt(t, true) + ' / ' + U.fmt(Store.project ? Store.project.duration : 0); });
    Bus.on('play', () => { this.playBtn.innerHTML = Icons.get('pause', 24); });
    Bus.on('pause', () => { this.playBtn.innerHTML = Icons.get('play', 24); });
    this.playBtn.innerHTML = Icons.get('play', 24); this.playBtn.onclick = () => Engine.toggle();
    $('#st-undo').onclick = () => { Engine.pause(); if (!Store.undo()) UI.toast('Nothing to undo'); };
    $('#st-redo').onclick = () => { Engine.pause(); if (!Store.redo()) UI.toast('Nothing to redo'); };
    $('#st-ratio').onclick = () => this.canvasPanel();
    $('#st-export').onclick = () => { Engine.pause(); Export.open(); };
    $('#st-title').onclick = async () => { const n = await UI.prompt({ title: 'Project name', value: Store.project.name }); if (n && n.trim()) { Store.project.name = n.trim().slice(0, 60); $('#st-title').textContent = Store.project.name; Projects.saveSoon(); } };
    $('#st-back').onclick = () => this.exit();
    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('resize', () => this.layoutStage());
  },
  key(e) {
    if (!$('#studio').classList.contains('active') || e.target.matches('input,textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); Engine.toggle(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') this.del();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? Store.redo() : Store.undo(); }
    else if (e.key === 's') this.split();
  },
  async open(project) {
    this.mount();
    Engine.pause();
    const missing = await Library.restore(project);
    Store.load(project);
    for (const it of project.items) if (it.type === 'video' && it.reverse && it.rev) { await Reverser.load(it.rev.key); }
    this.sel = null; this.closePanel(true); this.renderToolbar();
    $('#st-title').textContent = project.name;
    Engine.setSize(); this.layoutStage(); Timeline.fit(); Timeline.pps = U.clamp(Timeline.pps, 20, 120);
    Engine.seek(0); Timeline.render(); this.updateUndo();
    if (missing.length) this.relinkFlow(missing);
  },
  async relinkFlow(missing) {
    const ok = await UI.confirm('Missing media', `${missing.length} file(s) are too large to be stored inside the app and must be re-selected: ${missing.map(m => m.name).join(', ')}`, 'Select files');
    if (!ok) return;
    const files = await Files.pick({ accept: 'video/*,image/*,audio/*', multiple: true });
    for (const m of missing) {
      const f = files.find(x => x.name === m.name && x.size === m.size) || files.find(x => x.name === m.name);
      if (f) { try { await Library.relink(m, f); } catch (e) { UI.toast(e.message, 'error'); } }
    }
    Engine.refresh(); Timeline.render();
    const still = missing.filter(m => !Library.get(m.id));
    if (still.length) UI.toast(`${still.length} file(s) still missing`, 'error');
  },
  exit() { Engine.pause(); this.closePanel(true); Projects.save(Store.project, true).then(() => App.go('home')); },
  layoutStage() {
    if (!Store.project || !this.stage) return;
    const cw = this.stage.clientWidth, ch = this.stage.clientHeight; if (!cw || !ch) return;
    const asp = Engine.W / Engine.H; let w = cw, hh = cw / asp; if (hh > ch) { hh = ch; w = ch * asp; }
    this.canvas.style.width = Math.floor(w) + 'px'; this.canvas.style.height = Math.floor(hh) + 'px';
    this.gizmo && this.gizmo.refresh();
  },
  updateUndo() { $('#st-undo').disabled = !Store.undoS.length; $('#st-redo').disabled = !Store.redoS.length; },

  /* ---------------- selection & helpers ---------------- */
  cur() { return this.sel && Store.project ? Model.find(Store.project, this.sel) : null; },
  select(id) {
    if (id === this.sel) { return; }
    this.sel = id; this.closePanel(true); this.renderToolbar(); Bus.emit('select', id);
  },
  mut(fn, key) { const id = this.sel; Store.edit(p => { const it = Model.find(p, id); if (it) fn(it, p); }, key); },
  lt() { const it = this.cur(); return it ? U.clamp(Engine.t - it.start, 0, it.dur) : 0; },
  baseTf(it) { if (!it) return { x: 0, y: 0, s: 1, r: 0 }; const v = Anim.transformAt({ ...it, anim: {} }, U.clamp(Engine.t - it.start, 0, it.dur)); return { x: v.x, y: v.y, s: v.s, r: v.r, op: v.op }; },
  /* write transform; if the item has keyframes, edit/create one at the playhead */
  applyTf(tf) {
    Store.live(p => {
      const it = Model.find(p, this.sel); if (!it) return;
      if (it.kf && it.kf.length) {
        const lt = U.clamp(Engine.t - it.start, 0, it.dur); let k = Model.kfAt(it, lt);
        if (!k) { const v = this.baseTf(it); k = { t: +lt.toFixed(3), x: v.x, y: v.y, s: v.s, r: v.r, op: v.op }; it.kf.push(k); it.kf.sort((a, b) => a.t - b.t); }
        ['x', 'y', 's', 'r', 'op'].forEach(q => { if (tf[q] !== undefined) k[q] = tf[q]; });
      } else ['x', 'y', 's', 'r', 'op'].forEach(q => { if (tf[q] !== undefined) it.tf[q] = tf[q]; });
    });
  },
  del() { const it = this.cur(); if (!it) return; Engine.pause(); const id = it.id; this.sel = null; Store.edit(p => Model.remove(p, id)); this.renderToolbar(); Bus.emit('select', null); },
  dup() { const it = this.cur(); if (!it) return; let nid; Store.edit(p => { const b = Model.dup(p, it.id); nid = b && b.id; }); if (nid) this.select(nid); UI.toast('Duplicated', 'success'); },
  split() {
    const it = this.cur() || Engine.visualAt(Engine.t).filter(i => i.track === 'main')[0];
    if (!it) { UI.toast('Select a clip first', 'error'); return; }
    let ok = false; Store.edit(p => { ok = !!Model.split(p, it.id, Engine.t); });
    if (!ok) { Store.undoS.pop(); UI.toast('Move the playhead inside the clip to split', 'error'); } else UI.toast('Split', 'success');
  },
  addMarker() { Store.edit(p => { p.markers = p.markers || []; const t = +Engine.t.toFixed(2); if (!p.markers.includes(t)) p.markers.push(t); p.markers.sort((a, b) => a - b); }); UI.toast('Marker added'); },

  /* ---------------- toolbar ---------------- */
  tbtn(icon, label, fn, cls = '') { return h('button', { class: 'tb ' + cls, onclick: fn }, ic(icon, 22), h('span', null, label)); },
  renderToolbar() {
    const tb = this.toolbar; tb.innerHTML = '';
    const it = this.cur(); const B = (i, l, f, c) => tb.append(this.tbtn(i, l, f, c));
    if (!it) {
      B('film', 'Media', () => this.addMediaMenu()); B('music', 'Audio', () => this.audioMenu()); B('text', 'Text', () => this.addText());
      B('smile', 'Stickers', () => this.stickerPanel()); B('layers', 'Overlay', () => this.addOverlay());
      B('sparkles', 'Filters', () => this.addFxLayer('filter')); B('bolt', 'Effects', () => this.addFxLayer('fx')); B('adjust', 'Adjust', () => this.addFxLayer('adj'));
      B('captions', 'Captions', () => this.captionsMenu()); B('ratio', 'Canvas', () => this.canvasPanel()); B('ai', 'AI', () => this.aiPanel());
      return;
    }
    B('back', 'Back', () => this.select(null), 'back');
    B('split', 'Split', () => this.split());
    const t = it.type, vis = Model.isVisual(it);
    if (t === 'video' || t === 'audio') B('speed', 'Speed', () => this.speedPanel());
    if (t === 'video' || t === 'audio') B('volume', 'Volume', () => this.volumePanel());
    if (t === 'audio') { B('wave', 'Effects', () => this.audioFxPanel()); B('pulse', 'Beats', () => this.beatsPanel()); B('link', 'Sync', () => this.syncPanel()); }
    if (t === 'text') { B('text', 'Edit', () => this.textPanel()); }
    if (vis) { B('anim', 'Animate', () => this.animPanel()); B('keyframe', 'Edit', () => this.transformPanel()); }
    if (t === 'video' || t === 'image') { B('crop', 'Crop', () => this.cropPanel()); }
    if (t === 'video' || t === 'image' || t === 'fxlayer' || t === 'color') {
      B('sparkles', 'Filters', () => this.filterPanel()); B('adjust', 'Adjust', () => this.adjustPanel()); B('bolt', 'Effects', () => this.effectsPanel());
    }
    if (t === 'video' || t === 'image') { B('chroma', 'Chroma', () => this.chromaPanel()); B('mask', 'Mask', () => this.maskPanel()); }
    if (vis) B('blend', 'Blend', () => this.blendPanel());
    if (it.track === 'main' && Store.project.items.filter(i => i.track === 'main').indexOf(it) < Store.project.items.filter(i => i.track === 'main').length - 1) B('transition', 'Transition', () => this.openTransition(it.id));
    if (t === 'video') {
      B('reverse', 'Reverse', () => this.reverse()); B('freeze', 'Freeze', () => this.freeze()); B('wave', 'Detach', () => this.detachAudio());
    }
    if (vis && t !== 'text') { B('rotate', 'Rotate', () => this.rotate90()); B('flip', 'Mirror', () => this.mut(i => { i.tf.fx = !i.tf.fx; })); }
    B('copy', 'Duplicate', () => this.dup()); B('trash', 'Delete', () => this.del(), 'danger');
  },

  /* ---------------- dock panel ---------------- */
  panel(title, body, { onClose } = {}) {
    this.closePanel(true);
    this.panelEl.innerHTML = '';
    this.panelEl.append(h('div', { class: 'pn-h' }, h('b', null, title), h('button', { class: 'ibtn', onclick: () => this.closePanel(), html: Icons.get('check', 22) })), h('div', { class: 'pn-b' }, body));
    this.panelEl.classList.remove('hidden'); this.toolbar.classList.add('hidden'); this.panelOpen = true; this._onClose = onClose;
    setTimeout(() => this.layoutStage(), 30);
  },
  closePanel(silent) {
    if (this._onClose) { const f = this._onClose; this._onClose = null; try { f(); } catch (e) { } }
    this.panelEl.classList.add('hidden'); this.toolbar.classList.remove('hidden'); this.panelOpen = false; this.pickCb = null;
    if (!silent) setTimeout(() => this.layoutStage(), 30);
  },
  sl(label, min, max, step, get, set, o = {}) {
    return UI.slider({ label, min, max, step, value: get(), def: o.def, unit: o.unit || '', fmt: o.fmt, onInput: v => set(v) });
  },

  /* ---------------- importing ---------------- */
  async importFiles(files, { track = 'main', at } = {}) {
    if (!files.length) return;
    const b = UI.busy('Importing…');
    let lastId = null, n = 0;
    try {
      for (const f of files) {
        b.set(`Importing ${++n}/${files.length}: ${f.name}`);
        let media;
        try { media = await Library.add(f); } catch (e) { UI.toast(e.message, 'error', 4000); continue; }
        Store.edit(p => {
          p.media[media.id] = Library.meta(media);
          if (!p.items.length && media.kind !== 'audio' && !p.autoRatioDone) {
            p.autoRatioDone = true;
            const r = media.w / media.h; let best = '16:9', bd = 9;
            for (const k of ['16:9', '9:16', '1:1', '4:5']) { const [a, c] = Model.RATIOS[k]; const d = Math.abs(Math.log(r / (a / c))); if (d < bd) { bd = d; best = k; } }
            p.ratio = best;
          }
          let it;
          if (media.kind === 'audio') { it = Model.makeFromMedia(media, { start: at != null ? at : Engine.t }); }
          else if (track === 'ovl') { it = Model.makeFromMedia(media, { track: 'ovl', start: at != null ? at : Engine.t }); }
          else { it = Model.makeFromMedia(media, { track: 'main', start: 1e9 }); }
          p.items.push(it); lastId = it.id;
        });
      }
    } finally { b.done(); }
    if (lastId) { const it = Model.find(Store.project, lastId); Engine.setSize(); this.layoutStage(); Engine.seek(it ? (it.track === 'main' ? it.start : it.start) : 0); this.select(lastId); Timeline.fit(); Timeline.pps = U.clamp(Timeline.pps, 14, 140); Timeline.render(); UI.toast('Imported', 'success'); }
  },
  async addMediaMenu() {
    const c = await UI.choose('Add to timeline', [
      { label: 'Video / Photo from device', sub: 'Added to the main track', icon: 'film', value: 'media' },
      { label: 'Colour clip', sub: 'Solid colour / title card background', icon: 'ratio', value: 'color' },
    ]);
    if (c === 'media') this.importFiles(await Files.pick({ accept: 'video/*,image/*', multiple: true }), { track: 'main' });
    else if (c === 'color') {
      Store.edit(p => { p.items.push(Model.makeColor('#1b1b2f', 1e9, 3, 'main')); }); const it = Store.project.items.filter(i => i.track === 'main').pop(); this.select(it.id);
    }
  },
  async addOverlay() { this.importFiles(await Files.pick({ accept: 'video/*,image/*', multiple: true }), { track: 'ovl' }); },

  /* ---------------- text ---------------- */
  addText(str = 'Tap to edit') {
    let id; Store.edit(p => { const it = Model.makeText(str, Engine.t, Math.min(4, Math.max(1.5, p.duration - Engine.t || 3))); it.tf.y = 0; p.items.push(it); id = it.id; });
    this.select(id); this.textPanel();
  },
  /* ---------------- stickers ---------------- */
  stickerPanel() {
    let cat = 'Faces', color = '#ffd60a';
    const grid = h('div', { class: 'emoji-grid' });
    const addSticker = (kind, v) => { let id; Store.edit(p => { const it = Model.makeSticker(kind, v, Engine.t, 3, color); p.items.push(it); id = it.id; }); this.sel = id; Bus.emit('select', id); this.stickerRefresh && this.stickerRefresh(); };
    const fill = () => {
      grid.innerHTML = '';
      if (cat === 'Shapes') Shapes.list.forEach(s => grid.append(h('button', { class: 'emo', onclick: () => addSticker('shape', s) }, h('canvas', { width: 40, height: 40, 'data-s': s }))));
      else (EMOJI[cat] || []).forEach(e => grid.append(h('button', { class: 'emo', onclick: () => addSticker('emoji', e) }, e)));
      $$('canvas', grid).forEach(cv => { const x = cv.getContext('2d'); x.translate(20, 20); x.scale(34, 34); x.fillStyle = color; x.fill(Shapes.get(cv.dataset.s)); });
    };
    const cats = Object.keys(EMOJI).concat(['Shapes']);
    const chips = UI.chips(cats.map(c => ({ label: c, value: c })), cat, v => { cat = v; fill(); }, 'scroll');
    const col = UI.color(color, v => { color = v; if (cat === 'Shapes') fill(); });
    fill();
    this.panel('Stickers', h('div', null, chips, grid, h('div', { class: 'lbl-s' }, 'Shape colour'), col), { onClose: () => { this.stickerRefresh = null; this.renderToolbar(); } });
  },

  /* ---------------- audio ---------------- */
  async audioMenu() {
    const c = await UI.choose('Audio', [
      { label: 'Add music / audio file', sub: 'MP3, M4A, WAV, OGG…', icon: 'music', value: 'file' },
      { label: 'Extract audio from a video', sub: 'Uses only the sound of the chosen video', icon: 'wave', value: 'extract' },
      { label: 'Record voice-over', sub: 'Microphone, at the playhead', icon: 'mic', value: 'rec' },
      { label: 'Sound effects', sub: 'Generated on-device: whoosh, pop, ding…', icon: 'bolt', value: 'sfx' },
    ]);
    if (c === 'file') this.importFiles(await Files.pick({ accept: 'audio/*', multiple: true }));
    else if (c === 'extract') this.extractAudio();
    else if (c === 'rec') this.recordPanel();
    else if (c === 'sfx') this.sfxPanel();
  },
  async extractAudio() {
    const fs = await Files.pick({ accept: 'video/*' }); if (!fs.length) return;
    const b = UI.busy('Reading video…');
    try {
      const media = await Library.add(fs[0], { kind: 'video' });
      let id; Store.edit(p => {
        p.media[media.id] = Library.meta(media);
        const it = Model.base('audio', 'aud'); it.mediaId = media.id; it.name = media.name.replace(/\.[^.]+$/, '') + ' (audio)'; it.start = Engine.t; it.out = media.dur; it.dur = media.dur; p.items.push(it); id = it.id;
      });
      this.select(id); UI.toast('Audio extracted onto an audio track', 'success');
    } catch (e) { UI.toast(e.message, 'error'); } finally { b.done(); }
  },
  async sfxPanel() {
    const kinds = [['whoosh', 'Whoosh'], ['pop', 'Pop'], ['ding', 'Ding'], ['beep', 'Beep'], ['drum', 'Kick'], ['clap', 'Clap'], ['laser', 'Laser'], ['riser', 'Riser']];
    const body = h('div', { class: 'grid2' }, kinds.map(([k, n]) => h('button', { class: 'btn', onclick: async () => {
      try {
        const blob = await AudioUtil.synth(k); const media = await Library.addBlob(blob, n + '.wav', 'audio');
        let id; Store.edit(p => { p.media[media.id] = Library.meta(media); const it = Model.makeFromMedia(media, { start: Engine.t }); it.name = n; p.items.push(it); id = it.id; });
        this.sel = id; Bus.emit('select', id); UI.toast(n + ' added at playhead', 'success');
      } catch (e) { UI.toast(e.message, 'error'); }
    } }, n)));
    this.panel('Sound effects', body);
  },
  recordPanel() {
    let rec = null, chunks = [], stream = null, t0 = 0, timer = null, startAt = 0, muteProject = true;
    const time = h('div', { class: 'rec-time' }, '00:00');
    const btn = h('button', { class: 'rec-btn', html: Icons.get('mic', 34) });
    const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); };
    btn.onclick = async () => {
      if (rec && rec.state === 'recording') { stop(); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (e) { UI.toast('Microphone unavailable or permission denied', 'error', 4000); return; }
      const mt = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      rec = new MediaRecorder(stream, mt ? { mimeType: mt } : undefined); chunks = []; startAt = Engine.t;
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        clearInterval(timer); stream.getTracks().forEach(x => x.stop()); Engine.pause(); Engine.setMonitor(true); btn.classList.remove('on');
        const dur = (performance.now() - t0) / 1000; if (!chunks.length || dur < .3) { UI.toast('Recording too short', 'error'); return; }
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        try {
          const media = await Library.addBlob(blob, 'Voice-over ' + new Date().toLocaleTimeString().replace(/:/g, '-') + (blob.type.includes('mp4') ? '.m4a' : '.webm'), 'audio');
          let id; Store.edit(p => { p.media[media.id] = Library.meta(media); const it = Model.makeFromMedia(media, { start: startAt }); it.name = 'Voice-over'; p.items.push(it); id = it.id; });
          this.sel = id; Bus.emit('select', id); UI.toast('Voice-over added', 'success');
        } catch (e) { UI.toast('Could not read recording: ' + e.message, 'error'); }
      };
      Engine.audioInit(); Engine.setMonitor(!muteProject);
      rec.start(250); t0 = performance.now(); btn.classList.add('on');
      timer = setInterval(() => { time.textContent = U.fmt((performance.now() - t0) / 1000); }, 200);
      if (Store.project.items.length) Engine.play();
    };
    const body = h('div', { class: 'rec' }, btn, time,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: e => { muteProject = e.target.checked; } }), ' Mute project sound while recording (use headphones to hear it)'),
      h('small', { class: 'muted' }, 'Recording starts at the playhead and the video plays along. Tap again to stop.'));
    this.panel('Voice-over', body, { onClose: () => { stop(); } });
  },

  /* ---------------- fx layers (filters / effects / adjustment on a time range) ---------------- */
  addFxLayer(kind) {
    let id; Store.edit(p => { const it = Model.makeFxLayer(Engine.t, Math.min(5, Math.max(1.5, p.duration - Engine.t || 5))); it.name = kind === 'filter' ? 'Filter' : kind === 'fx' ? 'Effect' : 'Adjustment'; p.items.push(it); id = it.id; });
    this.select(id);
    if (kind === 'filter') this.filterPanel(); else if (kind === 'fx') this.effectsPanel(); else this.adjustPanel();
  },

  /* ---------------- captions ---------------- */
  async captionsMenu() {
    const c = await UI.choose('Captions', [
      { label: 'Auto captions (AI)', sub: 'Speech-to-text with Whisper API (configure key in Settings)', icon: 'ai', value: 'auto' },
      { label: 'Import subtitles (.srt / .vtt)', sub: 'Adds each line as a text clip', icon: 'captions', value: 'srt' },
      { label: 'Export captions as .srt', sub: 'From caption clips on the timeline', icon: 'download', value: 'exp' },
    ]);
    if (c === 'auto') this.autoCaptions();
    else if (c === 'srt') { const f = await Files.pick({ accept: '.srt,.vtt,text/*' }); if (f[0]) this.applyCaptions(this.parseSub(await f[0].text()), {}); }
    else if (c === 'exp') this.exportSrt();
  },
  parseSub(txt) {
    const out = [], blocks = txt.replace(/\r/g, '').replace(/^WEBVTT.*\n/, '').split(/\n\n+/);
    const ts = s => { const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+('0.' + m[4])) : 0; };
    blocks.forEach(b => {
      const lines = b.split('\n').filter(Boolean); const i = lines.findIndex(l => l.includes('-->')); if (i < 0) return;
      const [a, c] = lines[i].split('-->'); const text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '');
      if (text.trim()) out.push({ start: ts(a), end: ts(c), text: text.trim() });
    });
    return out;
  },
  applyCaptions(segs, { karaoke = false, replace = true } = {}) {
    if (!segs.length) { UI.toast('No captions found', 'error'); return; }
    Store.edit(p => {
      if (replace) p.items = p.items.filter(i => !i.cap);
      segs.forEach(s => {
        const it = Model.makeText(s.text, s.start, Math.max(.5, s.end - s.start)); it.cap = true;
        it.text.size = p.ratio === '9:16' ? .045 : .055; it.text.stroke = { c: '#000000', w: .09 }; it.text.shadow = { c: '#000000', b: .15, x: 0, y: .04 };
        it.tf.y = .36; if (karaoke && s.words && s.words.length) { it.words = s.words.map(w => ({ w: w.w, s: Math.max(0, w.s - s.start), e: w.e - s.start })); it.text.hl = '#ffd60a'; }
        it.anim.in = { id: 'fade', dur: .15 }; p.items.push(it);
      });
    });
    UI.toast(`${segs.length} captions added`, 'success');
  },
  async autoCaptions() {
    const p = Store.project;
    if (!p.items.some(i => Model.hasAudio(i) && !i.mute)) { UI.toast('Add a video or audio clip with sound first', 'error'); return; }
    const lang = await UI.choose('Spoken language', [{ label: 'Auto-detect', value: '' }, { label: 'Kiswahili', value: 'sw' }, { label: 'English', value: 'en' }, { label: 'Français', value: 'fr' }, { label: 'العربية', value: 'ar' }, { label: 'Español', value: 'es' }]);
    if (lang === null) return;
    const ctrl = new AbortController();
    const b = UI.busy('Preparing audio…', { cancel: () => ctrl.abort() });
    try {
      const segs = await AI.transcribe(p, { lang, signal: ctrl.signal, onStatus: (t, pc) => b.set(t, pc) });
      b.done(); this.applyCaptions(segs, { karaoke: true });
    } catch (e) { b.done(); if (e.name !== 'AbortError') UI.toast(e.message, 'error', 6000); }
  },
  async exportSrt() {
    const caps = Store.project.items.filter(i => i.type === 'text').sort((a, b) => a.start - b.start);
    if (!caps.length) { UI.toast('No text clips to export', 'error'); return; }
    const f = s => { const ms = Math.round(s * 1000); const z = (n, l = 2) => String(n).padStart(l, '0'); return `${z(Math.floor(ms / 3600000))}:${z(Math.floor(ms / 60000) % 60)}:${z(Math.floor(ms / 1000) % 60)},${z(ms % 1000, 3)}`; };
    const srt = caps.map((c, i) => `${i + 1}\n${f(c.start)} --> ${f(c.start + c.dur)}\n${c.text.str}\n`).join('\n');
    const r = await Files.saveBlob(new Blob([srt], { type: 'text/plain' }), (Store.project.name || 'captions') + '.srt');
    UI.toast('Saved to ' + r.where, 'success');
  },

  /* ---------------- AI (video) ---------------- */
  aiPanel() {
    const it = Engine.visualAt(Engine.t).find(i => i.type === 'video' || i.type === 'image');
    const frameTool = (label, sub, fn) => h('button', { class: 'choose-i', onclick: async () => {
      if (!it) { UI.toast('Place the playhead on a video or photo clip', 'error'); return; }
      const ctrl = new AbortController(); const b = UI.busy(label + '…', { cancel: () => ctrl.abort() });
      try {
        const src = it.type === 'video' ? await Engine.frameOf(it, 1280) : (() => { const m = Library.get(it.mediaId); const c = U.canvas(m.img.width, m.img.height); c.getContext('2d').drawImage(m.img, 0, 0); return c; })();
        const res = await fn(src, ctrl.signal, (t) => b.set(t));
        b.done(); const blob = await U.canvasToBlob(res.canvas, 'image/png');
        const media = await Library.addBlob(blob, label.replace(/\s+/g, '-') + '.png', 'image');
        let id; Store.edit(p => { p.media[media.id] = Library.meta(media); const n = Model.makeFromMedia(media, { track: 'ovl', start: Engine.t }); n.dur = 3; n.out = 3; n.tf.s = 1; p.items.push(n); id = n.id; });
        this.select(id); UI.toast(`${label} done (${res.provider})`, 'success');
      } catch (e) { b.done(); if (e.name !== 'AbortError') UI.toast(e.message, 'error', 6000); }
    } }, ic('ai', 22), h('div', null, h('b', null, label), h('small', null, sub)));
    const body = h('div', { class: 'choose' },
      h('button', { class: 'choose-i', onclick: () => { this.closePanel(); this.autoCaptions(); } }, ic('captions', 22), h('div', null, h('b', null, 'Auto captions'), h('small', null, 'Whisper speech-to-text → timed text clips'))),
      frameTool('Remove background', 'Current frame → transparent PNG overlay', async (src, sig, st) => AI.removeBg(src, { signal: sig, onStatus: st })),
      frameTool('Enhance frame', 'Sharpen / upscale current frame → still', async (src, sig, st) => AI.enhance(src, { signal: sig, onStatus: st })),
      h('button', { class: 'choose-i', onclick: () => { this.closePanel(); const a = this.cur(); if (!a || a.type !== 'audio') { UI.toast('Select an audio clip, then use Beats', 'error'); } else this.beatsPanel(); } }, ic('pulse', 22), h('div', null, h('b', null, 'Beat sync'), h('small', null, 'Detect beats in selected music and cut clips to them'))));
    this.panel('AI tools', body);
  },

  /* ---------------- canvas ---------------- */
  canvasPanel() {
    const p = Store.project;
    const rat = UI.chips(Object.keys(Model.RATIOS).map(r => ({ label: r, value: r })), p.ratio, v => { Store.edit(q => { q.ratio = v; }); Engine.setSize(); this.layoutStage(); }, 'scroll');
    const mode = UI.seg([{ label: 'Colour', value: 'color' }, { label: 'Blur fill', value: 'blur' }], p.bg.mode, v => Store.edit(q => { q.bg.mode = v; }));
    const col = UI.color(p.bg.color, v => Store.edit(q => { q.bg.color = v; q.bg.mode = 'color'; }, 'bgc'));
    const fps = UI.seg([24, 30, 60].map(v => ({ label: v + ' fps', value: v })), p.fps, v => Store.edit(q => { q.fps = v; }));
    this.panel('Canvas', h('div', null, h('div', { class: 'lbl-s' }, 'Aspect ratio'), rat, h('div', { class: 'lbl-s' }, 'Background (letterbox area)'), mode, col, h('div', { class: 'lbl-s' }, 'Project frame rate'), fps));
  },
};
window.Editor = Editor;
