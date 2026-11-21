'use strict';
/* K-EDIT STUDIO - property panels for the selected clip (speed, volume, text, animation, transform, crop, filters, adjust, effects, chroma, mask, blend, transitions, reverse, freeze…) */

Object.assign(Editor, {
  tabs(opts, init, render) {
    const body = h('div', { class: 'tabbody' });
    const draw = v => { body.innerHTML = ''; body.append(render(v)); };
    const seg = UI.seg(opts, init, v => draw(v));
    draw(init);
    return h('div', null, seg, body);
  },

  /* ---------- speed ---------- */
  speedPanel() {
    const it = this.cur(); if (!it) return;
    const setSpeed = v => this.mut(i => { i.ramp = null; i.speed = v; i.dur = Model.calcDur(i); }, 'speed');
    const normal = () => {
      const s = UI.slider({ label: 'Speed', min: .1, max: 8, step: .05, value: it.speed || 1, def: 1, fmt: v => v.toFixed(2) + 'x', onInput: setSpeed });
      const chips = UI.chips([.25, .5, 1, 1.5, 2, 4].map(v => ({ label: v + 'x', value: v })), it.ramp ? null : it.speed, v => { setSpeed(v); s.set(v); });
      return h('div', null, s, chips, h('small', { class: 'muted' }, 'Audio keeps its pitch where the device supports it. Clip length changes with speed.'));
    };
    const curve = () => {
      const names = { none: 'None', montage: 'Montage', hero: 'Hero', bullet: 'Bullet', flashin: 'Flash in', flashout: 'Flash out' };
      const chips = UI.chips(Object.keys(names).map(k => ({ label: names[k], value: k })), it.ramp ? it.ramp.name : 'none', k => {
        this.mut(i => { if (k === 'none') { i.ramp = null; i.speed = 1; } else i.ramp = { name: k, segs: JSON.parse(JSON.stringify(Model.RAMPS[k])) }; i.dur = Model.calcDur(i); }, 'ramp');
      });
      const cv = h('canvas', { class: 'rampv', width: 300, height: 60 });
      const draw = () => { const cur = this.cur(); if (!cur) return; const x = cv.getContext('2d'); x.clearRect(0, 0, 300, 60); x.strokeStyle = '#ff3b6b'; x.lineWidth = 2; x.beginPath(); Model.segs(cur).forEach((g, k) => { const y = 55 - Math.min(1, g.s / 4) * 50; if (!k) x.moveTo(g.a * 300, y); else x.lineTo(g.a * 300, y); x.lineTo(g.b * 300, y); }); x.stroke(); x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.moveTo(0, 55 - 12.5); x.lineTo(300, 55 - 12.5); x.stroke(); };
      draw(); chips.addEventListener('click', () => setTimeout(draw, 50));
      return h('div', null, chips, cv, h('small', { class: 'muted' }, 'Speed ramps change speed inside the clip (taller = faster).'));
    };
    this.panel('Speed', it.type === 'video' ? this.tabs([{ label: 'Normal', value: 'n' }, { label: 'Curve', value: 'c' }], it.ramp ? 'c' : 'n', v => v === 'n' ? normal() : curve()) : normal());
  },

  /* ---------- volume / audio fx ---------- */
  afxChips(it) {
    return UI.chips(AFX.map(([id, n]) => ({ label: n, value: id })), it.afx || 'none', v => this.mut(i => { i.afx = v === 'none' ? null : v; }), 'wrap');
  },
  volumePanel() {
    const it = this.cur(); if (!it) return;
    const mute = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.mute, onchange: e => this.mut(i => { i.mute = e.target.checked; }) }), ' Mute this clip');
    this.panel('Volume', h('div', null,
      this.sl('Volume', 0, 200, 1, () => Math.round(it.vol * 100), v => this.mut(i => { i.vol = v / 100; }, 'vol'), { unit: '%', def: 100 }),
      this.sl('Fade in', 0, 5, .1, () => it.fadeIn, v => this.mut(i => { i.fadeIn = Math.min(v, i.dur / 2); }, 'fi'), { unit: 's', def: 0 }),
      this.sl('Fade out', 0, 5, .1, () => it.fadeOut, v => this.mut(i => { i.fadeOut = Math.min(v, i.dur / 2); }, 'fo'), { unit: 's', def: 0 }),
      mute, h('div', { class: 'lbl-s' }, 'Sound effect'), this.afxChips(it)));
  },
  audioFxPanel() { const it = this.cur(); this.panel('Audio effects', h('div', null, this.afxChips(it), h('small', { class: 'muted' }, 'Applied live in preview and in the exported audio.'))); },

  /* ---------- beats / sync ---------- */
  beatsPanel() {
    const it = this.cur(); if (!it || it.type !== 'audio') return;
    const media = Model.mediaOf(it); let beats = null, every = 1;
    const info = h('div', { class: 'muted' }, 'Detects the beat of the music so you can place markers and cut clips on the rhythm.');
    const out = h('div');
    const tl = bt => it.start + (bt - it.in) / (it.speed || 1);
    const inside = () => beats.filter(b => b >= it.in && b <= it.out).map(tl);
    const run = h('button', { class: 'btn primary', onclick: async () => {
      const b = UI.busy('Analysing beats…');
      try { beats = await AudioUtil.beats(media.file); b.done(); } catch (e) { b.done(); UI.toast(e.message, 'error', 5000); return; }
      const n = inside().length; info.textContent = n + ' beats found in this clip.'; out.innerHTML = '';
      out.append(
        h('button', { class: 'btn', onclick: () => { Store.edit(p => { p.markers = p.markers || []; inside().forEach(t => { const r = +t.toFixed(2); if (!p.markers.includes(r)) p.markers.push(r); }); p.markers.sort((a, c) => a - c); }); UI.toast('Beat markers added', 'success'); } }, 'Add markers on beats'),
        h('div', { class: 'lbl-s' }, 'Auto-cut video to beats'),
        UI.chips([1, 2, 4].map(v => ({ label: 'Every ' + v, value: v })), 1, v => { every = v; }),
        h('button', { class: 'btn', onclick: () => {
          const times = inside().filter((_, k) => k % every === 0); let cuts = 0;
          Store.edit(p => { times.forEach(t => { const m = p.items.find(x => x.track === 'main' && t > x.start + .4 && t < x.start + x.dur - .4); if (m && Model.split(p, m.id, t)) { cuts++; Model.relayout(p); } }); });
          UI.toast(cuts + ' cuts made on the main track', cuts ? 'success' : 'info');
        } }, 'Cut main track on beats'));
    } }, 'Detect beats');
    this.panel('Beat sync', h('div', null, info, run, out));
  },
  syncPanel() {
    const it = this.cur(); if (!it) return;
    const nudge = d => this.mut(i => { i.start = Math.max(0, i.start + d); });
    const fps = Store.project.fps || 30;
    const row = h('div', { class: 'grid2' },
      [['−1 frame', -1 / fps], ['+1 frame', 1 / fps], ['−0.1 s', -.1], ['+0.1 s', .1]].map(([l, d]) => h('button', { class: 'btn', onclick: () => nudge(d) }, l)));
    const acts = h('div', { class: 'grid2' },
      h('button', { class: 'btn', onclick: () => { this.mut(i => { i.start = Engine.t; }); } }, 'Start at playhead'),
      h('button', { class: 'btn', onclick: () => {
        const p = Store.project, mainEnd = p.items.filter(i => i.track === 'main').reduce((m, i) => Math.max(m, Model.end(i)), 0); if (!mainEnd) { UI.toast('No video on the main track', 'error'); return; }
        this.mut(i => { const media = Model.mediaOf(i); const want = (mainEnd - i.start) * (i.speed || 1); i.out = Math.min(media ? media.dur : i.out, i.in + Math.max(.2, want)); i.dur = Model.calcDur(i); if (!i.fadeOut) i.fadeOut = Math.min(1.5, i.dur / 2); });
      } }, 'Trim to video length'),
      h('button', { class: 'btn', onclick: () => {
        const p = Store.project, mainEnd = p.items.filter(i => i.track === 'main').reduce((m, i) => Math.max(m, Model.end(i)), 0);
        Store.edit(q => { const base = Model.find(q, it.id); let t = Model.end(base), n = 0; while (t < mainEnd - .05 && n < 40) { const b = Model.dup(q, base.id); b.start = t; t += b.dur; n++; } });
        UI.toast('Looped to fill the video', 'success');
      } }, 'Loop to video end'));
    this.panel('Sync', h('div', null, h('div', { class: 'lbl-s' }, 'Nudge position'), row, acts));
  },

  /* ---------- text ---------- */
  textPanel() {
    const it = this.cur(); if (!it || it.type !== 'text') return;
    const PRE = {
      Classic: { color: '#ffffff', stroke: { c: '#000000', w: .08 }, shadow: { c: '#000000', b: 0, x: 0, y: 0 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, font: 'sans', bold: true, italic: false, upper: false },
      Neon: { color: '#00f0ff', stroke: { c: '#000000', w: 0 }, shadow: { c: '#00f0ff', b: .5, x: 0, y: 0 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, font: 'round', bold: true },
      Box: { color: '#ffffff', stroke: { c: '#000000', w: 0 }, shadow: { c: '#000000', b: 0, x: 0, y: 0 }, bg: { c: '#000000', op: .72, pad: .4, rad: .35 }, font: 'sans', bold: true },
      Yellow: { color: '#ffd60a', stroke: { c: '#000000', w: .12 }, shadow: { c: '#000000', b: 0, x: 0, y: 0 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, font: 'display', bold: false, upper: true },
      Pop: { color: '#ff3b30', stroke: { c: '#ffffff', w: .12 }, shadow: { c: '#000000', b: .1, x: .04, y: .06 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, font: 'display', bold: false, upper: true },
      Elegant: { color: '#ffffff', stroke: { c: '#000000', w: 0 }, shadow: { c: '#000000', b: .25, x: 0, y: .05 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, font: 'serif', bold: false, italic: true },
    };
    const T = () => this.cur().text;
    const m = (fn, k) => this.mut(i => fn(i.text, i), k || 'txt');
    const content = () => {
      const ta = h('textarea', { class: 'inp', rows: 3, value: T().str, placeholder: 'Type your text…' });
      ta.addEventListener('input', () => m((t, i) => { t.str = ta.value || ' '; i.name = ta.value.slice(0, 18); i.words = null; }, 'txtc'));
      setTimeout(() => ta.focus(), 120);
      return h('div', null, ta, h('div', { class: 'lbl-s' }, 'Style presets'), UI.chips(Object.keys(PRE).map(k => ({ label: k, value: k })), null, k => m(t => Object.assign(t, JSON.parse(JSON.stringify(PRE[k]))), 'pre'), 'scroll'));
    };
    const style = () => {
      const t = T(); const tg = (label, key) => h('button', { class: 'btn sm ' + (t[key] ? 'on' : ''), onclick: e => { m(x => { x[key] = !x[key]; }); e.currentTarget.classList.toggle('on'); } }, label);
      return h('div', null,
        h('div', { class: 'lbl-s' }, 'Font'),
        UI.chips(Object.keys(FONTS).map(k => ({ label: FONTS[k].name, value: k })), t.font, v => m(x => { x.font = v; }), 'scroll'),
        h('button', { class: 'btn sm', onclick: () => this.importFont() }, 'Import font file…'),
        this.sl('Size', 2, 25, .5, () => T().size * 100, v => m(x => { x.size = v / 100; }, 'tsz'), { unit: '%' }),
        h('div', { class: 'row' }, tg('B', 'bold'), tg('I', 'italic'), tg('U', 'underline'), tg('AA', 'upper'), UI.seg([{ label: '⟸', value: 'left' }, { label: '≡', value: 'center' }, { label: '⟹', value: 'right' }], t.align, v => m(x => { x.align = v; }))),
        h('div', { class: 'lbl-s' }, 'Colour'), UI.color(t.color, v => m(x => { x.color = v; }, 'tcol')),
        this.sl('Outline', 0, 20, .5, () => T().stroke.w * 100, v => m(x => { x.stroke.w = v / 100; }, 'tst'), { unit: '%' }),
        UI.color(t.stroke.c, v => m(x => { x.stroke.c = v; }, 'tstc')),
        this.sl('Shadow / glow', 0, 100, 1, () => T().shadow.b * 100, v => m(x => { x.shadow.b = v / 100; x.shadow.y = x.shadow.c === '#000000' ? v / 2500 : 0; }, 'tsh'), { unit: '%' }),
        UI.color(t.shadow.c, v => m(x => { x.shadow.c = v; }, 'tshc')),
        this.sl('Background box', 0, 100, 1, () => T().bg.op * 100, v => m(x => { x.bg.op = v / 100; }, 'tbg'), { unit: '%' }),
        UI.color(t.bg.c, v => m(x => { x.bg.c = v; if (!x.bg.op) x.bg.op = .7; }, 'tbgc')),
        this.sl('Letter spacing', -5, 30, 1, () => T().ls * 100, v => m(x => { x.ls = v / 100; }, 'tls'), { unit: '%' }),
        this.sl('Line height', 80, 200, 5, () => T().lh * 100, v => m(x => { x.lh = v / 100; }, 'tlh'), { unit: '%' }),
        it.words ? h('div', null, h('div', { class: 'lbl-s' }, 'Karaoke highlight'), UI.color(t.hl || '#ffd60a', v => m(x => { x.hl = v; }, 'thl'))) : null);
    };
    this.panel('Text', this.tabs([{ label: 'Text', value: 'c' }, { label: 'Style', value: 's' }, { label: 'Animation', value: 'a' }], 'c', v => v === 'c' ? content() : v === 's' ? style() : this.animBody(this.cur())));
  },
  async importFont() {
    const f = (await Files.pick({ accept: '.ttf,.otf,.woff,.woff2,font/*' }))[0]; if (!f) return;
    try {
      const name = 'cf_' + f.name.replace(/\W+/g, '_'); const face = new FontFace(name, await f.arrayBuffer()); await face.load(); document.fonts.add(face);
      FONTS[name] = { name: f.name.replace(/\.[^.]+$/, '').slice(0, 12), css: `"${name}", sans-serif` };
      this.mut(i => { i.text.font = name; }); UI.toast('Font loaded (this session only)', 'success'); this.textPanel();
    } catch (e) { UI.toast('Could not load font: ' + e.message, 'error'); }
  },

  /* ---------- animation ---------- */
  animBody(it) {
    return this.tabs([{ label: 'In', value: 'in' }, { label: 'Out', value: 'out' }, { label: 'Loop', value: 'loop' }], 'in', tab => {
      const cur = (this.cur().anim || {})[tab];
      const list = ANIMS[tab].filter(([id]) => id !== 'type' || it.type === 'text');
      const chips = UI.chips(list.map(([id, n]) => ({ label: n, value: id })), cur ? cur.id : 'none', v => {
        this.mut(i => { i.anim = i.anim || {}; i.anim[tab] = v === 'none' ? null : { id: v, dur: (i.anim[tab] && i.anim[tab].dur) || (tab === 'loop' ? 1 : .6), speed: 1 }; });
        const t = Math.max(0, tab === 'out' ? it.start + it.dur - 1 : it.start); if (!Engine.playing) { Engine.seek(t); Engine.play(); }
      }, 'wrap');
      const s = tab === 'loop'
        ? this.sl('Speed', .3, 3, .1, () => (this.cur().anim.loop && this.cur().anim.loop.speed) || 1, v => this.mut(i => { if (i.anim.loop) i.anim.loop.speed = v; }, 'as'), { unit: 'x', def: 1 })
        : this.sl('Duration', .1, 3, .1, () => (this.cur().anim[tab] && this.cur().anim[tab].dur) || .6, v => this.mut(i => { if (i.anim[tab]) i.anim[tab].dur = Math.min(v, i.dur); }, 'ad'), { unit: 's', def: .6 });
      return h('div', null, chips, s);
    });
  },
  animPanel() { const it = this.cur(); if (!it) return; this.panel('Animation', this.animBody(it)); },

  /* ---------- transform + keyframes ---------- */
  transformPanel() {
    const it = this.cur(); if (!it) return;
    const refs = {};
    const set = (tf, k) => { Store.push(k || 'tf'); this.applyTf(tf); };
    const mk = (key, label, min, max, step, to, from, unit, def) => { refs[key] = this.sl(label, min, max, step, () => from(this.baseTf(this.cur())[key]), v => set({ [key]: to(v) }, 'tf' + key), { unit, def }); return refs[key]; };
    const kfBtn = h('button', { class: 'btn' }, '');
    const upd = () => { const c = this.cur(); if (!c) return; const lt = U.clamp(Engine.t - c.start, 0, c.dur); kfBtn.textContent = Model.kfAt(c, lt) ? '◆ Remove keyframe' : '◇ Add keyframe at playhead'; kfBtn.classList.toggle('on', !!Model.kfAt(c, lt)); };
    kfBtn.onclick = () => {
      this.mut(i => {
        const lt = +U.clamp(Engine.t - i.start, 0, i.dur).toFixed(3); const ex = Model.kfAt(i, lt);
        if (ex) i.kf = i.kf.filter(k => k !== ex);
        else { const v = this.baseTf(i); i.kf.push({ t: lt, x: v.x, y: v.y, s: v.s, r: v.r, op: v.op }); i.kf.sort((a, b) => a.t - b.t); }
      }); upd();
    };
    const unsub = Bus.on('rendered', () => {
      if (document.activeElement && document.activeElement.type === 'range') return;
      const b = this.baseTf(this.cur()); if (!b) return;
      refs.s && refs.s.set(Math.round(b.s * 100)); refs.x && refs.x.set(Math.round(b.x * 100)); refs.y && refs.y.set(Math.round(b.y * 100)); refs.r && refs.r.set(Math.round(b.r)); refs.op && refs.op.set(Math.round(b.op * 100)); upd();
    });
    const fit = it.type === 'video' || it.type === 'image' ? UI.seg([{ label: 'Fit', value: 'contain' }, { label: 'Fill', value: 'cover' }], it.fit, v => this.mut(i => { i.fit = v; })) : null;
    const body = h('div', null,
      mk('s', 'Scale', 5, 400, 1, v => v / 100, v => Math.round(v * 100), '%', 100),
      mk('x', 'Position X', -100, 100, 1, v => v / 100, v => Math.round(v * 100), '', 0),
      mk('y', 'Position Y', -100, 100, 1, v => v / 100, v => Math.round(v * 100), '', 0),
      mk('r', 'Rotation', -180, 180, 1, v => v, v => Math.round(v), '°', 0),
      mk('op', 'Opacity', 0, 100, 1, v => v / 100, v => Math.round(v * 100), '%', 100),
      fit,
      h('div', { class: 'grid2' }, kfBtn, h('button', { class: 'btn', onclick: () => this.mut(i => { i.kf = []; }) }, 'Clear keyframes')),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => this.mut(i => { i.tf.fx = !i.tf.fx; }) }, 'Flip H'), h('button', { class: 'btn sm', onclick: () => this.mut(i => { i.tf.fy = !i.tf.fy; }) }, 'Flip V'), h('button', { class: 'btn sm', onclick: () => this.mut(i => { const d = Model.tfDef(); if (i.track === 'ovl' && Model.mediaOf(i)) d.s = .5; i.tf = d; i.kf = []; }) }, 'Reset')),
      h('small', { class: 'muted' }, 'Tip: drag the clip in the preview, pinch with two fingers to scale/rotate. Add keyframes at different times to animate position, scale, rotation and opacity.'));
    upd(); this.panel('Edit', body, { onClose: unsub });
  },
  rotate90() { this.mut(i => { i.rot90 = ((i.rot90 || 0) + 1) % 4; }); },

  /* ---------- crop ---------- */
  cropPanel() {
    const it = this.cur(); if (!it) return; const media = Model.mediaOf(it); if (!media) return;
    const refs = {};
    const sr = (k, label) => { refs[k] = this.sl(label, 0, 90, 1, () => Math.round(this.cur().crop[k] * 100), v => this.mut(i => { const o = { ...i.crop, [k]: v / 100 }; if (o.l + o.r < .95 && o.t + o.b < .95) i.crop = o; }, 'crop' + k), { unit: '%', def: 0 }); return refs[k]; };
    const ratio = (a) => this.mut(i => {
      const w = media.w, hh = media.h; let l = 0, t = 0;
      if (a > w / hh) t = (1 - (w / a) / hh) / 2; else l = (1 - (hh * a) / w) / 2;
      i.crop = { l, t, r: l, b: t };
    }, 'cropr');
    const chips = UI.chips([['Free', 0], ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:5', .8], ['3:4', .75]].map(([l, v]) => ({ label: l, value: v })), null, v => { if (v) ratio(v); else this.mut(i => { i.crop = { l: 0, t: 0, r: 0, b: 0 }; }); setTimeout(() => this.cropPanel(), 50); }, 'scroll');
    this.panel('Crop', h('div', null, chips, sr('l', 'Left'), sr('r', 'Right'), sr('t', 'Top'), sr('b', 'Bottom')));
  },

  /* ---------- filters / adjust / effects ---------- */
  filterPanel() {
    const it = this.cur(); if (!it) return;
    const strip = h('div', { class: 'fstrip' });
    const src = Engine.snapshot(220), cur = it.flt ? it.flt.id : 'none';
    FILTERS.forEach((f, idx) => {
      const tile = h('button', { class: 'ftile' + (f.id === cur ? ' on' : ''), onclick: () => { this.mut(i => { i.flt = f.id === 'none' ? null : { id: f.id, s: (i.flt && i.flt.s) || 1 }; }); $$('.ftile', strip).forEach(x => x.classList.remove('on')); tile.classList.add('on'); } }, h('span', null, f.name));
      strip.append(tile);
      setTimeout(() => { try { const cv = ColorGL.thumb(src, src.width, src.height, 64, 64, f.id); tile.prepend(cv); } catch (e) { } }, idx * 12);
    });
    this.panel('Filters', h('div', null, strip, this.sl('Intensity', 0, 100, 1, () => Math.round(((this.cur().flt && this.cur().flt.s) == null ? 1 : this.cur().flt.s) * 100), v => this.mut(i => { if (i.flt) i.flt.s = v / 100; }, 'fint'), { unit: '%', def: 100 })));
  },
  adjustPanel() {
    const it = this.cur(); if (!it) return;
    const G = [
      ['Light', [['exposure', 'Exposure'], ['brightness', 'Brightness'], ['contrast', 'Contrast'], ['highlights', 'Highlights'], ['shadows', 'Shadows']]],
      ['Colour', [['saturation', 'Saturation'], ['vibrance', 'Vibrance'], ['temp', 'Temperature'], ['tint', 'Tint'], ['hue', 'Hue']]],
      ['Effects', [['fade', 'Fade'], ['vignette', 'Vignette'], ['grain', 'Grain'], ['sharpen', 'Sharpen'], ['blur', 'Blur']]],
    ];
    const rng = { hue: [-180, 180], blur: [0, 100], grain: [0, 100], sharpen: [0, 100], fade: [0, 100] };
    const sliders = [];
    const body = this.tabs(G.map(([n]) => ({ label: n, value: n })), 'Light', name => {
      sliders.length = 0;
      const g = G.find(x => x[0] === name)[1];
      return h('div', null, g.map(([k, l]) => { const [a, b] = rng[k] || [-100, 100]; const s = this.sl(l, a, b, 1, () => (this.cur().adj && this.cur().adj[k]) || 0, v => this.mut(i => { i.adj = i.adj || {}; i.adj[k] = v; }, 'adj' + k), { def: 0 }); return s; }),
        h('button', { class: 'btn sm', onclick: () => { this.mut(i => { i.adj = null; }); this.adjustPanel(); } }, 'Reset all'));
    });
    this.panel('Adjust', body);
  },
  effectsPanel() {
    const it = this.cur(); if (!it) return;
    const sl = h('div');
    const draw = () => { sl.innerHTML = ''; (this.cur().fx || []).forEach(f => sl.append(this.sl((EFFECTS.find(e => e[0] === f.id) || [0, f.id])[1] + ' intensity', 0, 100, 1, () => Math.round((f.amt == null ? .5 : f.amt) * 100), v => this.mut(i => { const q = i.fx.find(x => x.id === f.id); if (q) q.amt = v / 100; }, 'fx' + f.id), { unit: '%', def: 50 }))); };
    const chips = h('div', { class: 'chips wrap' }, EFFECTS.map(([id, n]) => {
      const b = h('button', { class: 'chip' + ((it.fx || []).some(f => f.id === id) ? ' on' : ''), onclick: () => {
        this.mut(i => { i.fx = i.fx || []; const k = i.fx.findIndex(f => f.id === id); if (k >= 0) i.fx.splice(k, 1); else { if (i.fx.length >= 3) i.fx.shift(); i.fx.push({ id, amt: .5 }); } });
        $$('.chip', chips).forEach((x, q) => x.classList.toggle('on', (this.cur().fx || []).some(f => f.id === EFFECTS[q][0]))); draw();
        if (!Engine.playing) { Engine.seek(Math.max(0, this.cur().start)); Engine.play(); }
      } }, n); return b;
    }));
    draw();
    this.panel('Effects', h('div', null, chips, sl, h('button', { class: 'btn sm', onclick: () => { this.mut(i => { i.fx = []; }); this.effectsPanel(); } }, 'Clear effects'), h('small', { class: 'muted' }, 'Up to 3 effects. Tip: on an Effect layer, trim its length to apply it only where needed.')));
  },

  /* ---------- chroma key / mask / blend ---------- */
  chromaPanel() {
    const it = this.cur(); if (!it) return;
    const ck = () => this.cur().chroma || { on: false, color: '#00b140', sim: .35, smooth: .25 };
    const set = fn => this.mut(i => { i.chroma = i.chroma || { on: false, color: '#00b140', sim: .35, smooth: .25 }; fn(i.chroma); }, 'chroma');
    const col = UI.color(ck().color, v => set(c => { c.color = v; }));
    const body = h('div', null,
      UI.seg([{ label: 'Off', value: false }, { label: 'On', value: true }], !!ck().on, v => set(c => { c.on = v; })),
      h('div', { class: 'lbl-s' }, 'Key colour'),
      UI.chips([['Green', '#00b140'], ['Blue', '#0047bb'], ['White', '#ffffff'], ['Black', '#000000']].map(([l, v]) => ({ label: l, value: v })), null, v => { set(c => { c.color = v; c.on = true; }); col.set(v); }),
      col,
      h('button', { class: 'btn', onclick: () => {
        const was = !!ck().on; set(c => { c.on = false; });
        UI.toast('Tap the colour to remove in the preview'); this.pickCb = (x, y) => {
          requestAnimationFrame(() => {
            const d = Engine.ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
            set(c => { c.color = U.rgb2hex(d[0], d[1], d[2]); c.on = true; }); col.set(U.rgb2hex(d[0], d[1], d[2])); this.chromaPanel();
          });
        };
        if (!was) { /* nothing */ }
      } }, 'Pick colour from preview'),
      this.sl('Similarity', 0, 100, 1, () => Math.round(ck().sim * 100), v => set(c => { c.sim = v / 100; }), { unit: '%', def: 35 }),
      this.sl('Smoothness', 0, 100, 1, () => Math.round(ck().smooth * 100), v => set(c => { c.smooth = v / 100; }), { unit: '%', def: 25 }),
      it.track === 'main' ? h('button', { class: 'btn', onclick: () => { this.mut(i => { const s = i.start; i.track = 'ovl'; i.lane = 0; i.start = s; i.tf.s = 1; }); UI.toast('Moved to overlay. Now add a background clip on the main track.', 'success', 4000); } }, 'Move to overlay track (for background replacement)') : null,
      h('small', { class: 'muted' }, 'Background replacement: put the green-screen clip on an overlay track above a photo/video background, then turn Chroma key on.'));
    this.panel('Chroma key', body);
  },
  maskPanel() {
    const it = this.cur(); if (!it) return;
    const names = { none: 'None', circle: 'Circle', rounded: 'Rounded', heart: 'Heart', star: 'Star', triangle: 'Triangle', diamond: 'Diamond', hexagon: 'Hexagon', bars: 'Cinema bars' };
    this.panel('Mask', UI.chips(Object.keys(names).map(k => ({ label: names[k], value: k })), it.mask ? it.mask.shape : 'none', v => this.mut(i => { i.mask = v === 'none' ? null : { shape: v }; }), 'wrap'));
  },
  blendPanel() {
    const it = this.cur(); if (!it) return;
    const B = [['source-over', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['difference', 'Difference'], ['lighter', 'Add']];
    this.panel('Blend & opacity', h('div', null,
      this.sl('Opacity', 0, 100, 1, () => Math.round(this.baseTf(this.cur()).op * 100), v => { Store.push('op'); this.applyTf({ op: v / 100 }); }, { unit: '%', def: 100 }),
      UI.chips(B.map(([v, n]) => ({ label: n, value: v })), it.blend || 'source-over', v => this.mut(i => { i.blend = v; }), 'wrap')));
  },

  /* ---------- transitions ---------- */
  openTransition(id) {
    const p = Store.project, it = Model.find(p, id); if (!it) return;
    const mains = p.items.filter(i => i.track === 'main'), idx = mains.indexOf(it);
    if (idx < 0 || idx >= mains.length - 1) { UI.toast('Transitions go between two clips on the main track', 'info'); return; }
    this.sel = id; this.renderToolbar(); Bus.emit('select', id);
    const preview = () => { const c = Model.find(Store.project, id), nx = mains[idx + 1]; if (!c) return; Engine.seek(Math.max(0, (nx.start || c.start + c.dur) - (c._tr || 1) - .6)); Engine.play(); };
    const chips = UI.chips(TRANSITIONS.map(([v, n]) => ({ label: n, value: v })), it.trans ? it.trans.id : 'none', v => {
      this.mut(i => { i.trans = v === 'none' ? null : { id: v, dur: (i.trans && i.trans.dur) || .7 }; }); if (v !== 'none') setTimeout(preview, 80);
    }, 'wrap');
    this.panel('Transition', h('div', null, chips,
      this.sl('Duration', .2, 2, .1, () => (this.cur().trans && this.cur().trans.dur) || .7, v => this.mut(i => { if (i.trans) i.trans.dur = v; }, 'trd'), { unit: 's', def: .7 }),
      h('button', { class: 'btn sm', onclick: () => { const c = this.cur(); if (!c.trans) { UI.toast('Pick a transition first', 'error'); return; } const tr = { ...c.trans }; Store.edit(q => { const ms = q.items.filter(i => i.track === 'main'); ms.forEach((m, k) => { if (k < ms.length - 1) m.trans = { ...tr }; }); }); UI.toast('Applied to all cuts', 'success'); } }, 'Apply to all cuts')));
  },

  /* ---------- reverse / freeze / detach ---------- */
  async reverse() {
    const it = this.cur(); if (!it || it.type !== 'video') return;
    if (it.reverse) { this.mut(i => { i.reverse = false; }); UI.toast('Reverse off'); return; }
    const media = Model.mediaOf(it); const len = it.out - it.in;
    if (len > 120) { UI.toast('Reverse supports clips up to 2 minutes. Split or trim first.', 'error', 4000); return; }
    const key = Reverser.key(media, it.in, it.out);
    if (!Reverser.has(key)) {
      const ctrl = new AbortController(); const b = UI.busy('Reversing… (plays the clip once to capture frames)', { cancel: () => ctrl.abort() });
      try { await Reverser.build(media, it.in, it.out, { signal: ctrl.signal, onProgress: p => b.set(null, p) }); b.done(); }
      catch (e) { b.done(); if (e.message !== 'cancelled') UI.toast('Reverse failed: ' + e.message, 'error', 5000); return; }
    }
    this.mut(i => { i.reverse = true; i.rev = { key, a: i.in, b: i.out }; }); UI.toast('Reversed (original audio is muted for reversed clips)', 'success', 3500);
  },
  async freeze() {
    const it = this.cur(); if (!it || it.type !== 'video') return;
    if (Engine.t < it.start || Engine.t >= it.start + it.dur) { UI.toast('Move the playhead inside the clip', 'error'); return; }
    const b = UI.busy('Capturing frame…');
    try {
      const c = await Engine.frameOf(it, 1920); const blob = await U.canvasToBlob(c, 'image/jpeg', .92);
      const media = await Library.addBlob(blob, 'Freeze.jpg', 'image'); b.done();
      Store.edit(p => {
        p.media[media.id] = Library.meta(media);
        const fz = Model.makeFromMedia(media, { track: it.track, start: Engine.t }); fz.dur = 2; fz.out = 2; fz.tf = JSON.parse(JSON.stringify(it.tf)); fz.fit = it.fit; fz.name = 'Freeze';
        if (it.track === 'main') { const second = Model.split(p, it.id, Engine.t); const i0 = p.items.indexOf(it); p.items.splice(i0 + 1, 0, fz); if (!second) { /* at edge: freeze inserted after */ } }
        else p.items.push(fz);
      });
      UI.toast('Freeze frame added (2 s) – drag its edge to lengthen', 'success', 3500);
    } catch (e) { b.done(); UI.toast(e.message, 'error'); }
  },
  detachAudio() {
    const it = this.cur(); if (!it || it.type !== 'video') return;
    Store.edit(p => {
      const v = Model.find(p, it.id), a = JSON.parse(JSON.stringify(v));
      a.id = U.uid('i'); a.type = 'audio'; a.track = 'aud'; a.lane = 0; a.name = (v.name || 'Clip') + ' (audio)'; a.trans = null; a.reverse = false; a.rev = null;
      a.tf = Model.tfDef(); a.kf = []; a.adj = null; a.flt = null; a.fx = []; a.chroma = null; a.mask = null;
      v.mute = true; p.items.push(a);
    });
    UI.toast('Audio detached onto an audio track', 'success');
  },
});
