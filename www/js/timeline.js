'use strict';
/* K-EDIT STUDIO - multi-track timeline UI (fixed centre playhead, pinch zoom, long-press move, trim handles, snapping) */

const Timeline = {
  pps: 60, host: null, content: null, rows: null, ruler: null, ptrs: new Map(), g: null, vel: 0,
  MINPPS: 6, MAXPPS: 700,

  init(host) {
    this.host = host;
    host.innerHTML = '';
    this.ruler = h('canvas', { class: 'tl-ruler' });
    this.content = h('div', { class: 'tl-content' });
    this.rows = h('div', { class: 'tl-rows' }, this.content);
    this.playhead = h('div', { class: 'tl-playhead' }, h('i'));
    this.snapLine = h('div', { class: 'tl-snap hidden' });
    this.tools = h('div', { class: 'tl-tools' },
      h('button', { class: 'ibtn sm', title: 'Zoom out', onclick: () => this.zoom(1 / 1.5), html: Icons.get('zoomout', 18) }),
      h('button', { class: 'ibtn sm', title: 'Zoom in', onclick: () => this.zoom(1.5), html: Icons.get('zoomin', 18) }),
      h('button', { class: 'ibtn sm', title: 'Fit', onclick: () => this.fit(), html: Icons.get('ratio', 18) }),
      h('button', { class: 'ibtn sm', title: 'Marker', onclick: () => Editor.addMarker(), html: Icons.get('flag', 18) }));
    host.append(this.ruler, this.rows, this.playhead, this.snapLine, this.tools);
    this.rows.addEventListener('pointerdown', e => this.down(e));
    this.ruler.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e));
    this.rows.addEventListener('click', e => {
      const tr = e.target.closest('.tl-tr'); if (tr) { Editor.openTransition(tr.dataset.id); return; }
      if (e.target.closest('.tl-add')) { Editor.addMediaMenu(); }
      if (e.target.closest('.tl-addaud')) { Editor.audioMenu(); }
    });
    new ResizeObserver(() => { this.drawRuler(); this.setTime(Engine.t); }).observe(host);
    const rr = U.raf(() => this.render()); Bus.on('change', () => rr());
    Bus.on('time', t => this.setTime(t));
    Bus.on('media:thumbs', U.debounce(() => this.render(), 150));
    Bus.on('media:peaks', U.debounce(() => this.render(), 150));
    Bus.on('select', () => this.render());
    this.render();
  },
  cx() { return (this.host.clientWidth || 360) / 2; },
  setTime(t) {
    this.content.style.transform = `translate3d(${this.cx() - t * this.pps}px,0,0)`;
    this.drawRuler();
  },
  zoom(f) { this.pps = U.clamp(this.pps * f, this.MINPPS, this.MAXPPS); this.render(); },
  fit() { const d = Math.max(1, Store.project ? Store.project.duration : 1); this.pps = U.clamp((this.host.clientWidth * .8) / d, this.MINPPS, this.MAXPPS); this.render(); },

  drawRuler() {
    const cv = this.ruler, w = this.host.clientWidth, hh = 22, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w) return;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = hh * dpr; cv.style.width = w + 'px'; cv.style.height = hh + 'px'; }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, hh);
    const t = Engine.t, c = this.cx(), pps = this.pps;
    const steps = [.1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find(s => s * pps >= 64) || 600;
    const tl = Math.max(0, t - c / pps), tr = t + (w - c) / pps;
    const minor = step / 5;
    x.fillStyle = 'rgba(255,255,255,.28)'; x.strokeStyle = 'rgba(255,255,255,.28)'; x.font = '10px sans-serif'; x.textBaseline = 'top'; x.lineWidth = 1;
    for (let s = Math.floor(tl / minor) * minor; s <= tr; s += minor) {
      if (s < 0) continue;
      const px = Math.round(c + (s - t) * pps) + .5; const major = Math.abs(s / step - Math.round(s / step)) < 1e-6;
      x.beginPath(); x.moveTo(px, hh); x.lineTo(px, hh - (major ? 9 : 4)); x.stroke();
      if (major) { x.fillStyle = 'rgba(255,255,255,.55)'; x.fillText(U.fmt(s, step < 1), px + 3, 2); }
    }
    const p = Store.project;
    if (p && p.markers) { x.fillStyle = '#ffd60a'; p.markers.forEach(m => { const px = c + (m - t) * pps; if (px > -5 && px < w + 5) { x.beginPath(); x.moveTo(px, 0); x.lineTo(px + 7, 4); x.lineTo(px, 8); x.fill(); } }); }
  },

  render() {
    const p = Store.project; if (!p || !this.content) return;
    const pps = this.pps, c = this.content; c.innerHTML = '';
    const total = Math.max(p.duration, 1) * pps + this.host.clientWidth;
    c.style.width = total + 'px';
    const maxL = tk => p.items.filter(i => i.track === tk).reduce((m, i) => Math.max(m, i.lane + 1), 0);
    const nO = maxL('ovl'), nA = maxL('aud');
    const mkRow = (group, lane, cls) => { const r = h('div', { class: 'tl-row ' + cls, 'data-group': group, 'data-lane': lane }); c.append(r); return r; };
    const rowsO = []; for (let l = nO - 1; l >= 0; l--) rowsO[l] = mkRow('ovl', l, 'ovl');
    const mainRow = mkRow('main', 0, 'main');
    const rowsA = []; for (let l = 0; l < Math.max(nA, 1); l++) rowsA[l] = mkRow('aud', l, 'aud');
    p.items.forEach(it => {
      const row = it.track === 'main' ? mainRow : it.track === 'ovl' ? rowsO[it.lane] : rowsA[it.lane];
      if (row) row.append(this.mkClip(it));
    });
    if (!nA) rowsA[0].append(h('div', { class: 'tl-addaud' }, ic('music', 16), ' Add audio'));
    const mains = p.items.filter(i => i.track === 'main');
    mains.forEach((it, i) => {
      const nx = mains[i + 1];
      if (nx) { const b = h('button', { class: 'tl-tr' + (it.trans ? ' on' : ''), 'data-id': it.id, html: Icons.get('transition', 14) }); b.style.left = (nx.start * pps) + 'px'; mainRow.append(b); }
    });
    const endX = (mains.length ? Model.end(mains[mains.length - 1]) : 0) * pps;
    mainRow.append(h('button', { class: 'tl-add', style: { left: (endX + 10) + 'px' }, html: Icons.get('plus', 22) }));
    this.setTime(Engine.t);
  },

  mkClip(it) {
    const pps = this.pps, w = Math.max(6, it.dur * pps), sel = Editor.sel === it.id;
    const el = h('div', { class: `clip t-${it.type}` + (sel ? ' sel' : ''), 'data-id': it.id, style: { left: it.start * pps + 'px', width: w + 'px' } });
    const media = Model.mediaOf(it);
    if ((it.type === 'video' || it.type === 'image') && media) {
      const tw = Math.max(40, 46 * ((media.w / media.h) || 1.78)), n = U.clamp(Math.ceil(w / tw), 1, 60);
      const tiles = h('div', { class: 'tiles' });
      for (let i = 0; i < n; i++) {
        const st = it.type === 'video' ? Model.srcAt(it, (i + .5) / n * it.dur) : 0;
        const url = Library.thumbAt(media, st);
        tiles.append(h('div', { class: 'tile', style: { width: (w / n) + 'px', backgroundImage: url ? `url(${url})` : 'none' } }));
      }
      el.append(tiles);
    } else if (it.type === 'audio') {
      const cv = h('canvas', { class: 'wf' }); el.append(cv);
      const pk = media && media.peaks; const W = Math.min(3000, Math.round(w)); cv.width = W; cv.height = 34;
      const x = cv.getContext('2d'); x.fillStyle = 'rgba(255,255,255,.75)';
      if (pk) {
        for (let i = 0; i < W; i++) {
          const lt = (i / W) * it.dur, s = Model.srcAt(it, lt), idx = Math.floor(s / media.dur * pk.length);
          const v = pk[U.clamp(idx, 0, pk.length - 1)] * (it.mute ? .1 : Math.min(1.4, it.vol)); const hh = Math.max(1, v * 30);
          x.fillRect(i, 17 - hh / 2, 1, hh);
        }
      } else { x.fillRect(0, 16, W, 2); }
      el.append(h('span', { class: 'lbl' }, ic('music', 12), it.name || 'Audio'));
    } else if (it.type === 'text') el.append(h('span', { class: 'lbl' }, ic('text', 14), (it.text.str || '').replace(/\n/g, ' ')));
    else if (it.type === 'sticker') el.append(h('span', { class: 'lbl' }, it.sticker.kind === 'emoji' ? it.sticker.v : ic('star', 14), it.sticker.kind === 'emoji' ? '' : it.sticker.v));
    else if (it.type === 'fxlayer') el.append(h('span', { class: 'lbl' }, ic('sparkles', 14), it.name || 'Effect'));
    else if (it.type === 'color') { el.style.background = it.color; el.append(h('span', { class: 'lbl' }, 'Color')); }
    const badges = [];
    if (it.speed && it.speed !== 1 && !it.ramp) badges.push(it.speed.toFixed(2).replace(/\.?0+$/, '') + 'x');
    if (it.ramp) badges.push('curve');
    if (it.reverse) badges.push('◀');
    if (it.mute && Model.hasAudio(it)) badges.push('🔇');
    if (it.kf && it.kf.length) badges.push('◆');
    if (it.chroma && it.chroma.on) badges.push('key');
    if (badges.length) el.append(h('span', { class: 'badge' }, badges.join(' ')));
    if (it.fadeIn > 0) el.append(h('span', { class: 'fade fi', style: { width: it.fadeIn * pps + 'px' } }));
    if (it.fadeOut > 0) el.append(h('span', { class: 'fade fo', style: { width: it.fadeOut * pps + 'px' } }));
    if (sel) el.append(h('div', { class: 'hnd l' }, h('i')), h('div', { class: 'hnd r' }, h('i')));
    if (it.kf && it.kf.length && Model.hasVisualKf !== false) it.kf.forEach(k => { el.append(h('i', { class: 'kfd', style: { left: (k.t * pps) + 'px' } })); });
    return el;
  },

  /* ---------------- gestures ---------------- */
  down(e) {
    if (e.target.closest('.tl-tr') || e.target.closest('.tl-add') || e.target.closest('.tl-addaud') || e.target.closest('.tl-tools')) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vel = 0; cancelAnimationFrame(this.inertia);
    if (this.ptrs.size === 2) {
      if (this.g) clearTimeout(this.g.lp);
      const ps = [...this.ptrs.values()];
      this.g = { mode: 'pinch', d0: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) || 1, pps0: this.pps }; return;
    }
    const clipEl = e.target.closest('.clip'), hnd = e.target.closest('.hnd');
    const fromRuler = e.target === this.ruler;
    this.g = { mode: null, x0: e.clientX, y0: e.clientY, t0: Engine.t, id: clipEl ? clipEl.dataset.id : null, el: clipEl, hnd: hnd ? (hnd.classList.contains('l') ? 'start' : 'end') : null, moved: false, last: [{ x: e.clientX, t: performance.now() }], ruler: fromRuler };
    if (clipEl && !hnd) this.g.lp = setTimeout(() => this.startMove(), 300);
    if (hnd) { this.g.mode = 'trim-pending'; }
    if (fromRuler) { this.g.mode = 'scrub'; }
  },
  startMove() {
    const g = this.g; if (!g || g.moved || !g.id) return;
    g.mode = 'move'; g.moved = true; Editor.select(g.id);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch (e) { }
    const p = Store.project, it = Model.find(p, g.id); if (!it) { this.g = null; return; }
    g.orig = JSON.parse(JSON.stringify(it));
    g.el = $(`.clip[data-id="${g.id}"]`, this.content); if (g.el) g.el.classList.add('lift');
  },
  move(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.g; if (!g) return;
    if (g.mode === 'pinch') {
      if (this.ptrs.size < 2) return;
      const ps = [...this.ptrs.values()], d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
      this.pps = U.clamp(g.pps0 * d / g.d0, this.MINPPS, this.MAXPPS); this.render(); return;
    }
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.mode && (Math.abs(dx) > 7 || Math.abs(dy) > 7)) { clearTimeout(g.lp); g.mode = 'scrub'; g.moved = true; }
    if (g.mode === 'trim-pending' && Math.abs(dx) > 3) {
      g.mode = 'trim'; g.moved = true;
      const it = Model.find(Store.project, g.id); if (!it) { this.g = null; return; }
      g.orig = JSON.parse(JSON.stringify(it)); Store.begin('trim');
    }
    if (g.mode === 'scrub') {
      const t = U.clamp(g.t0 - dx / this.pps, 0, Store.project.duration);
      const now = performance.now(); g.last.push({ x: e.clientX, t: now }); if (g.last.length > 5) g.last.shift();
      if (Engine.playing) Engine.pause(); Engine.seek(t);
    } else if (g.mode === 'trim') {
      let dt = dx / this.pps;
      const o = g.orig, edge = g.hnd === 'start' ? o.start + dt : o.start + o.dur + dt;
      const sn = this.snap([edge], g.id); if (sn != null) dt += sn;
      Store.live(p => {
        const it = Model.find(p, g.id); Object.assign(it, JSON.parse(JSON.stringify(o)));
        if (g.hnd === 'start') Model.trim(p, g.id, 'start', dt); else Model.trim(p, g.id, 'end', -dt);
      });
    } else if (g.mode === 'move') {
      const o = g.orig; let dt = dx / this.pps;
      if (o.track !== 'main') { const sn = this.snap([o.start + dt, o.start + o.dur + dt], g.id); if (sn != null) dt += sn; dt = Math.max(-o.start, dt); }
      g.dt = dt; g.dy = dy;
      if (g.el) { g.el.style.left = ((o.track === 'main' ? o.start : o.start) + dt) * this.pps + 'px'; g.el.style.transform = `translateY(${o.track === 'main' ? 0 : Math.max(-40, Math.min(40, dy))}px)`; }
    }
  },
  snap(edges, id) {
    const pts = Model.snapPoints(Store.project, id); pts.push(Engine.t);
    const th = 9 / this.pps; let best = null, bd = th;
    edges.forEach(ed => pts.forEach(pt => { const d = pt - ed; if (Math.abs(d) < bd) { bd = Math.abs(d); best = d; } }));
    if (best != null) { const x = this.cx() + (edges[0] + best - Engine.t) * this.pps; this.snapLine.style.left = x + 'px'; this.snapLine.classList.remove('hidden'); }
    else this.snapLine.classList.add('hidden');
    return best;
  },
  up(e) {
    if (!this.ptrs.has(e.pointerId)) return;
    this.ptrs.delete(e.pointerId);
    const g = this.g; this.snapLine.classList.add('hidden');
    if (!g) return;
    if (g.mode === 'pinch') { if (this.ptrs.size === 0) this.g = null; return; }
    clearTimeout(g.lp);
    if (g.mode === 'scrub') {
      const l = g.last; if (l.length >= 2) { const a = l[0], b = l[l.length - 1], dtm = Math.max(1, b.t - a.t); this.vel = (b.x - a.x) / dtm; }
      if (Math.abs(this.vel) > .25 && !g.ruler) this.runInertia();
    } else if (g.mode === 'move') {
      const o = g.orig;
      Store.edit(p => {
        const it = Model.find(p, g.id); if (!it) return;
        if (o.track === 'main') {
          const mains = p.items.filter(i => i.track === 'main' && i.id !== it.id), center = o.start + g.dt + o.dur / 2;
          let idx = 0; mains.forEach(m => { if (m.start + m.dur / 2 < center) idx++; });
          Model.moveMain(p, it.id, idx);
        } else {
          it.start = Math.max(0, o.start + g.dt);
          const rowEl = this.rowAt(e.clientY); if (rowEl && rowEl.dataset.group === it.track) it.lane = +rowEl.dataset.lane;
          else it.lane = o.lane;
        }
      }, 'move');
      this.g = null; return;
    } else if (g.mode === 'trim') { Bus.emit('change', {}); }
    else if (!g.moved) {
      if (g.id) { Editor.select(Editor.sel === g.id && !g.hnd ? Editor.sel : g.id); }
      else if (!g.ruler) Editor.select(null);
    }
    this.g = null;
  },
  rowAt(y) {
    const rs = $$('.tl-row', this.content);
    for (const r of rs) { const b = r.getBoundingClientRect(); if (y >= b.top && y <= b.bottom) return r; }
    return null;
  },
  runInertia() {
    const step = () => {
      this.vel *= .94; if (Math.abs(this.vel) < .02) return;
      const t = U.clamp(Engine.t - this.vel * 16 / this.pps, 0, Store.project.duration);
      Engine.seek(t); if (t <= 0 || t >= Store.project.duration) return;
      this.inertia = requestAnimationFrame(step);
    };
    this.inertia = requestAnimationFrame(step);
  },
};
window.Timeline = Timeline;
