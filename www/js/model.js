'use strict';
/* K-EDIT STUDIO - project / timeline data model
   Items live in one array. track: 'main' (magnetic, order = array order), 'ovl' (video/image/text/sticker/fxlayer), 'aud'.
   Time mapping supports constant speed, speed ramps and reverse. */

const Model = {
  RATIOS: { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '3:4': [3, 4], '4:3': [4, 3], '21:9': [21, 9] },
  ADJ_KEYS: ['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temp', 'tint', 'highlights', 'shadows', 'hue', 'fade', 'vignette', 'grain', 'sharpen', 'blur'],
  RAMPS: {
    montage: [{ a: 0, b: .2, s: 1 }, { a: .2, b: .4, s: .35 }, { a: .4, b: .7, s: 3 }, { a: .7, b: 1, s: 1 }],
    hero: [{ a: 0, b: .3, s: 1.6 }, { a: .3, b: .6, s: .25 }, { a: .6, b: 1, s: 1.6 }],
    bullet: [{ a: 0, b: .4, s: 3 }, { a: .4, b: .6, s: .15 }, { a: .6, b: 1, s: 3 }],
    flashin: [{ a: 0, b: .3, s: .3 }, { a: .3, b: 1, s: 2 }],
    flashout: [{ a: 0, b: .7, s: 2 }, { a: .7, b: 1, s: .3 }],
  },

  dims(p, short = 1080) {
    const [rw, rh] = this.RATIOS[p.ratio] || [16, 9];
    const k = short / Math.min(rw, rh);
    return { w: U.even(rw * k), h: U.even(rh * k) };
  },

  newProject({ name = 'Untitled', kind = 'video', ratio = '16:9' } = {}) {
    return { id: U.uid('p'), name, kind, ratio, fps: 30, bg: { mode: 'color', color: '#000000' }, items: [], media: {}, markers: [], duration: 0, created: Date.now(), updated: Date.now(), v: 2 };
  },

  tfDef: () => ({ x: 0, y: 0, s: 1, r: 0, fx: false, fy: false, op: 1 }),
  base(type, track) {
    return {
      id: U.uid('i'), type, track, lane: 0, start: 0, dur: 3, in: 0, out: 3, speed: 1, ramp: null, reverse: false, rev: null,
      vol: 1, mute: false, fadeIn: 0, fadeOut: 0, afx: null,
      tf: this.tfDef(), fit: 'contain', crop: { l: 0, t: 0, r: 0, b: 0 }, blend: 'source-over', mask: null,
      adj: null, flt: null, fx: [], chroma: null, anim: { in: null, out: null, loop: null }, kf: [], trans: null,
    };
  },
  textDef() {
    return { str: 'Text', font: 'sans', size: .07, color: '#ffffff', bold: true, italic: false, underline: false, align: 'center', stroke: { c: '#000000', w: 0 }, shadow: { c: '#000000', b: 0, x: 0, y: 0 }, bg: { c: '#000000', op: 0, pad: .3, rad: .25 }, ls: 0, lh: 1.15, upper: false, hl: null };
  },
  find(p, id) { return p.items.find(i => i.id === id) || null; },
  isSrc: it => it.type === 'video' || it.type === 'audio',
  isVisual: it => it.type === 'video' || it.type === 'image' || it.type === 'text' || it.type === 'sticker' || it.type === 'color',
  hasAudio: it => (it.type === 'video' || it.type === 'audio'),
  mediaOf(it) { return it.mediaId && window.Library ? Library.get(it.mediaId) : null; },
  end: it => it.start + it.dur,

  makeFromMedia(media, { track = 'main', start = 0 } = {}) {
    const it = this.base(media.kind, track);
    it.mediaId = media.id; it.name = media.name; it.start = start;
    if (media.kind === 'image') { it.dur = Settings.get('imageDur', 4); it.out = it.dur; }
    else { it.in = 0; it.out = media.dur || 5; it.dur = it.out; }
    if (media.kind === 'audio') { it.track = 'aud'; }
    else if (track === 'ovl') { it.tf.s = .5; }
    return it;
  },
  makeText(str = 'Text', start = 0, dur = 3) {
    const it = this.base('text', 'ovl'); it.start = start; it.dur = dur; it.out = dur; it.text = this.textDef(); it.text.str = str; it.name = str.slice(0, 18); it.anim.in = { id: 'fade', dur: .3 };
    return it;
  },
  makeSticker(kind, v, start = 0, dur = 3, color = '#ffd60a') {
    const it = this.base('sticker', 'ovl'); it.start = start; it.dur = dur; it.out = dur; it.sticker = { kind, v, color }; it.name = kind === 'emoji' ? v : v; it.tf.s = 1;
    it.anim.in = { id: 'pop', dur: .35 };
    return it;
  },
  makeColor(color = '#222222', start = 0, dur = 3, track = 'main') {
    const it = this.base('color', track); it.start = start; it.dur = dur; it.out = dur; it.color = color; it.name = 'Color'; return it;
  },
  makeFxLayer(start = 0, dur = 5) {
    const it = this.base('fxlayer', 'ovl'); it.start = start; it.dur = dur; it.out = dur; it.name = 'Effect'; return it;
  },

  /* ---- time mapping ---- */
  segs: it => (it.ramp && it.ramp.segs) || [{ a: 0, b: 1, s: it.speed || 1 }],
  calcDur(it) {
    if (!this.isSrc(it)) return it.dur;
    const len = Math.max(0.001, it.out - it.in);
    return this.segs(it).reduce((s, g) => s + (g.b - g.a) * len / g.s, 0);
  },
  walk(it, lt) {
    const len = it.out - it.in, rev = it.reverse;
    const order = rev ? this.segs(it).slice().reverse() : this.segs(it);
    let acc = 0;
    for (let i = 0; i < order.length; i++) {
      const g = order[i], tl = (g.b - g.a) * len / g.s;
      if (lt <= acc + tl || i === order.length - 1) {
        const f = U.clamp((lt - acc) / (tl || 1), 0, 1);
        return { u: rev ? g.b - f * (g.b - g.a) : g.a + f * (g.b - g.a), s: g.s };
      }
      acc += tl;
    }
    return { u: 0, s: 1 };
  },
  srcAt(it, lt) { return it.in + this.walk(it, lt).u * (it.out - it.in); },
  speedAt(it, lt) { return this.walk(it, lt).s; },
  clipSegs(segs, a, b) {
    const out = [];
    segs.forEach(g => {
      const lo = Math.max(a, g.a), hi = Math.min(b, g.b);
      if (hi - lo > 1e-6) out.push({ a: (lo - a) / (b - a), b: (hi - a) / (b - a), s: g.s });
    });
    return out;
  },
  ramped: it => !!it.ramp,

  /* cut at local time lt -> partial props for left & right halves */
  cut(it, lt) {
    const dur = it.dur;
    if (!this.isSrc(it)) {
      const kf = it.kf || [];
      return { L: { dur: lt, out: lt, kf: kf.filter(k => k.t <= lt).map(k => ({ ...k })) }, R: { dur: dur - lt, out: dur - lt, kf: kf.filter(k => k.t >= lt).map(k => ({ ...k, t: k.t - lt })) } };
    }
    const len = it.out - it.in, u = this.walk(it, lt).u, sb = it.in + u * len;
    const segs = this.segs(it), rev = it.reverse;
    let Lr, Rr, Ls, Rs;
    if (!rev) { Lr = [it.in, sb]; Rr = [sb, it.out]; Ls = this.clipSegs(segs, 0, u); Rs = this.clipSegs(segs, u, 1); }
    else { Lr = [sb, it.out]; Rr = [it.in, sb]; Ls = this.clipSegs(segs, u, 1); Rs = this.clipSegs(segs, 0, u); }
    const mk = (r, s, kf) => {
      const o = { in: r[0], out: r[1], kf };
      if (it.ramp) { o.ramp = { segs: s }; } else { o.ramp = null; o.speed = it.speed; }
      return o;
    };
    const kf = it.kf || [];
    const L = mk(Lr, Ls, kf.filter(k => k.t <= lt).map(k => ({ ...k })));
    const R = mk(Rr, Rs, kf.filter(k => k.t >= lt).map(k => ({ ...k, t: k.t - lt })));
    return { L, R };
  },
  applyPart(it, part) {
    Object.assign(it, part);
    it.dur = this.isSrc(it) ? this.calcDur(it) : part.dur;
    if (!this.isSrc(it)) it.out = it.dur;
  },
  split(p, id, t) {
    const it = this.find(p, id); if (!it) return null;
    const lt = t - it.start;
    if (lt < 0.1 || lt > it.dur - 0.1) return null;
    const { L, R } = this.cut(it, lt);
    const b = JSON.parse(JSON.stringify(it)); b.id = U.uid('i');
    this.applyPart(b, R);
    this.applyPart(it, L);
    b.start = it.start + it.dur;
    if (it.track !== 'main') b.start = it.start + lt;
    b.fadeIn = 0; it.fadeOut = 0; b.anim.in = null; it.anim.out = null; b.name = (it.name || '') ;
    b.trans = it.trans; it.trans = null;
    p.items.splice(p.items.indexOf(it) + 1, 0, b);
    return b;
  },
  /* trim one side by dt seconds (positive = shrink) */
  trim(p, id, side, dt) {
    const it = this.find(p, id); if (!it) return;
    const media = this.mediaOf(it);
    const minD = 0.1;
    if (dt > 0) {
      dt = Math.min(dt, it.dur - minD); if (dt <= 0) return;
      if (side === 'start') {
        const { R } = this.cut(it, dt); this.applyPart(it, R);
        if (it.track !== 'main') it.start += dt;
        (it.kf || []).forEach(k => k.t = k.t); it.fadeIn = Math.min(it.fadeIn, it.dur / 2);
      } else {
        const { L } = this.cut(it, it.dur - dt); this.applyPart(it, L); it.fadeOut = Math.min(it.fadeOut, it.dur / 2);
      }
    } else if (dt < 0) {
      let ext = -dt;
      if (this.isSrc(it)) {
        if (it.ramp) return;
        const sp = it.speed || 1, mdur = media ? media.dur : it.out;
        let srcExt = ext * sp;
        const growIn = (side === 'start') !== !!it.reverse;
        if (growIn) { srcExt = Math.min(srcExt, it.in); it.in -= srcExt; } else { srcExt = Math.min(srcExt, mdur - it.out); it.out += srcExt; }
        ext = srcExt / sp;
        it.dur = this.calcDur(it);
      } else {
        it.dur += ext; it.out = it.dur;
      }
      if (side === 'start' && it.track !== 'main') it.start = Math.max(0, it.start - ext);
    }
  },
  remove(p, id) { p.items = p.items.filter(i => i.id !== id); },
  dup(p, id) {
    const it = this.find(p, id); if (!it) return null;
    const b = JSON.parse(JSON.stringify(it)); b.id = U.uid('i'); b.trans = null;
    if (it.track === 'main') p.items.splice(p.items.indexOf(it) + 1, 0, b);
    else { b.start = it.start + it.dur; p.items.push(b); }
    return b;
  },
  moveMain(p, id, toIndex) {
    const mains = p.items.filter(i => i.track === 'main');
    const it = this.find(p, id); if (!it) return;
    const from = mains.indexOf(it);
    toIndex = U.clamp(toIndex, 0, mains.length - 1);
    if (from === toIndex) return;
    mains.splice(from, 1); mains.splice(toIndex, 0, it);
    const rest = p.items.filter(i => i.track !== 'main');
    p.items = mains.concat(rest);
  },

  relayout(p) {
    const main = p.items.filter(i => i.track === 'main');
    let t = 0;
    main.forEach((it, i) => {
      it.dur = Math.max(0.05, +it.dur || 0.05);
      it.start = t;
      const nx = main[i + 1];
      let tr = 0;
      if (it.trans && nx) tr = U.clamp(it.trans.dur || .6, 0.1, Math.max(0.1, Math.min(it.dur, nx.dur) * .5));
      it._tr = tr;
      t += it.dur - tr;
    });
    ['ovl', 'aud'].forEach(tk => {
      const arr = p.items.filter(i => i.track === tk).sort((a, b) => ((a.lane || 0) - (b.lane || 0)) || (a.start - b.start));
      const lanes = [];
      arr.forEach(it => {
        it.start = Math.max(0, it.start);
        let L = it.lane || 0;
        const clash = (ln) => (lanes[ln] || []).some(o => it.start < o.start + o.dur - 1e-4 && o.start < it.start + it.dur - 1e-4);
        while (clash(L)) L++;
        (lanes[L] = lanes[L] || []).push(it); it.lane = L;
      });
      const used = [...new Set(arr.map(i => i.lane))].sort((a, b) => a - b);
      arr.forEach(i => i.lane = used.indexOf(i.lane));
    });
    let d = 0;
    p.items.forEach(i => { d = Math.max(d, i.start + i.dur); });
    p.duration = d;
  },

  activeAt(p, t, filter) { return p.items.filter(i => t >= i.start - 1e-6 && t < i.start + i.dur - 1e-6 && (!filter || filter(i))); },
  mainAt(p, t) {
    const act = p.items.filter(i => i.track === 'main' && t >= i.start - 1e-6 && t < i.start + i.dur - 1e-6);
    if (!act.length) {
      const mains = p.items.filter(i => i.track === 'main');
      if (mains.length && t >= p.duration - 1e-3) return { a: mains[mains.length - 1], b: null, prog: 0, hold: true };
      return { a: null, b: null, prog: 0 };
    }
    if (act.length === 1) return { a: act[0], b: null, prog: 0 };
    const a = act[0], b = act[1];
    return { a, b, prog: U.clamp((t - b.start) / (a._tr || .5), 0, 1) };
  },
  adjOf(it) { return it.adj || null; },
  hasGrade(it) {
    if (it.flt && it.flt.id && it.flt.id !== 'none') return true;
    const a = it.adj; if (!a) return false;
    return this.ADJ_KEYS.some(k => k !== 'blur' && a[k]);
  },
  snapPoints(p, excludeId) {
    const pts = [0];
    p.items.forEach(i => { if (i.id !== excludeId) { pts.push(i.start, i.start + i.dur); } });
    (p.markers || []).forEach(m => pts.push(m));
    return pts;
  },
  /* keyframes */
  kfProps: ['x', 'y', 's', 'r', 'op'],
  kfAt(it, lt) { return (it.kf || []).find(k => Math.abs(k.t - lt) < 0.04) || null; },
};
window.Model = Model;
