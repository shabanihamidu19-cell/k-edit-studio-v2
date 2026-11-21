'use strict';
/* K-EDIT STUDIO - GPU colour grading (WebGL) shared by video preview/export and the photo editor.
   One fragment shader handles exposure, contrast, saturation, temperature, highlights/shadows, curves,
   split-toning, vignette, grain, sharpen... Falls back to CSS-filter approximation if WebGL is unavailable. */

const FILTERS = [
  { id: 'none', name: 'Original', p: {} },
  { id: 'vivid', name: 'Vivid', p: { saturation: .35, contrast: .12, vibrance: .2 } },
  { id: 'pwani', name: 'Pwani', p: { temp: .25, saturation: .1, contrast: .05, tint: .03 } },
  { id: 'zanzibar', name: 'Zanzibar', p: { temp: -.25, saturation: .08, contrast: .05, vibrance: .1 } },
  { id: 'savana', name: 'Savana', p: { temp: .35, saturation: .2, contrast: .1, splitAmt: .4, splitH: [.65, .5, .4] } },
  { id: 'serengeti', name: 'Serengeti', p: { temp: .3, brightness: .04, saturation: .15, vibrance: .2, fade: .08 } },
  { id: 'kili', name: 'Kilimanjaro', p: { temp: -.08, saturation: .25, brightness: .04, vibrance: .3, tint: -.05 } },
  { id: 'vintage', name: 'Vintage', p: { sepia: .35, fade: .25, contrast: -.05, vignette: .3, saturation: -.15 } },
  { id: 'film', name: 'Film', p: { grain: .35, fade: .2, sepia: .1, saturation: -.1, contrast: .08 } },
  { id: 'cinema', name: 'Cinema', p: { contrast: .15, saturation: .1, splitAmt: .6, splitS: [.35, .55, .65], splitH: [.7, .55, .35] } },
  { id: 'drama', name: 'Drama', p: { contrast: .35, saturation: -.1, shadows: -.25, highlights: -.1, vignette: .35 } },
  { id: 'noir', name: 'Noir', p: { gray: 1, contrast: .35, vignette: .25 } },
  { id: 'bw', name: 'B&W', p: { gray: 1 } },
  { id: 'fade', name: 'Fade', p: { fade: .4, contrast: -.1, saturation: -.2 } },
  { id: 'matte', name: 'Matte', p: { fade: .35, contrast: .1, saturation: -.1, shadows: .2 } },
  { id: 'pastel', name: 'Pastel', p: { fade: .2, saturation: -.15, brightness: .08, temp: .05 } },
  { id: 'punch', name: 'Punch', p: { contrast: .3, saturation: .3, sharpen: .3 } },
  { id: 'cyber', name: 'Cyber', p: { hue: .5, saturation: .4, contrast: .2, splitAmt: .6, splitS: [.35, .45, .7], splitH: [.7, .4, .65] } },
  { id: 'dusk', name: 'Dusk', p: { temp: -.15, contrast: .2, saturation: -.1, shadows: -.2, splitAmt: .4, splitS: [.4, .45, .65] } },
];

const Curves = {
  monotone(pts) {
    pts = pts.slice().sort((a, b) => a[0] - b[0]);
    const n = pts.length; if (n < 2) return x => x;
    const x = pts.map(p => p[0]), y = pts.map(p => p[1]);
    const d = [], m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1] - y[i]) / ((x[i + 1] - x[i]) || 1e-6);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return v => {
      if (v <= x[0]) return y[0]; if (v >= x[n - 1]) return y[n - 1];
      let i = 0; while (v > x[i + 1]) i++;
      const hh = x[i + 1] - x[i], t = (v - x[i]) / hh, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * hh * m[i + 1];
    };
  },
  /* curve = {m:[[x,y]..], r:[..], g:[..], b:[..]} -> Uint8Array(256*4) */
  lut(curve) {
    const out = new Uint8Array(256 * 4);
    const fm = this.monotone(curve.m || [[0, 0], [1, 1]]), fr = this.monotone(curve.r || [[0, 0], [1, 1]]), fg = this.monotone(curve.g || [[0, 0], [1, 1]]), fb = this.monotone(curve.b || [[0, 0], [1, 1]]);
    for (let i = 0; i < 256; i++) {
      const v = i / 255, mv = U.clamp(fm(v), 0, 1);
      out[i * 4] = U.clamp(fr(mv), 0, 1) * 255; out[i * 4 + 1] = U.clamp(fg(mv), 0, 1) * 255; out[i * 4 + 2] = U.clamp(fb(mv), 0, 1) * 255; out[i * 4 + 3] = 255;
    }
    return out;
  },
  isIdentity(c) {
    if (!c) return true;
    const id = a => !a || (a.length === 2 && a[0][0] === 0 && a[0][1] === 0 && a[1][0] === 1 && a[1][1] === 1);
    return id(c.m) && id(c.r) && id(c.g) && id(c.b);
  },
};

const ColorGL = {
  ok: null, cv: null, gl: null, prog: null, U: {}, tex: null, lutTex: null, lutKey: '', tmp: null,
  VS: 'attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}',
  FS: `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;uniform sampler2D tex,lut;uniform vec2 px,res;
uniform float exposure,brightness,contrast,saturation,vibrance,temp,tint,highlights,shadows,hue,fade,vignette,grain,sharpen,gray,sepia,splitAmt,useLut,seed;
uniform vec3 splitS,splitH;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
 vec4 t=texture2D(tex,v);vec3 c=t.rgb;
 if(sharpen>0.){vec3 n=texture2D(tex,v+vec2(px.x,0.)).rgb+texture2D(tex,v-vec2(px.x,0.)).rgb+texture2D(tex,v+vec2(0.,px.y)).rgb+texture2D(tex,v-vec2(0.,px.y)).rgb;c+=(c*4.-n)*sharpen;}
 c*=pow(2.,exposure);
 c.r*=1.+temp*.3;c.b*=1.-temp*.3;c.g*=1.-tint*.2;c.r*=1.+tint*.08;c.b*=1.+tint*.08;
 c+=brightness;
 c=(c-.5)*(1.+contrast)+.5;
 float l=lum(c);
 c+=shadows*(1.-smoothstep(0.,.55,l))*.4;
 c+=highlights*smoothstep(.45,1.,l)*.4;
 l=lum(c);
 float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));
 c=mix(vec3(l),c,1.+saturation);
 c=mix(vec3(l),c,1.+vibrance*(1.-(mx-mn)));
 if(hue!=0.){float cs=cos(hue),sn=sin(hue);
  mat3 m=mat3(.299+.701*cs+.168*sn,.299-.299*cs-.328*sn,.299-.3*cs+1.25*sn,
              .587-.587*cs+.33*sn,.587+.413*cs+.035*sn,.587-.588*cs-1.05*sn,
              .114-.114*cs-.497*sn,.114-.114*cs+.292*sn,.114+.886*cs-.203*sn);c=m*c;}
 c=clamp(c,0.,1.);
 if(useLut>.5)c=vec3(texture2D(lut,vec2(c.r,.5)).r,texture2D(lut,vec2(c.g,.5)).g,texture2D(lut,vec2(c.b,.5)).b);
 if(splitAmt>0.){l=lum(c);c=mix(c,c*(splitS*1.5+.25),splitAmt*(1.-l));c=mix(c,c*(splitH*1.5+.25),splitAmt*l);}
 c=c*(1.-fade*.3)+fade*.12;
 float g=lum(c);c=mix(c,vec3(g),gray);
 vec3 sp=vec3(dot(c,vec3(.393,.769,.189)),dot(c,vec3(.349,.686,.168)),dot(c,vec3(.272,.534,.131)));c=mix(c,sp,sepia);
 if(vignette!=0.){float d=distance(v,vec2(.5))*1.414;float k=smoothstep(.3,1.05,d)*abs(vignette);c=vignette>0.?c*(1.-k*.9):mix(c,vec3(1.),k*.8);}
 if(grain>0.){float n=fract(sin(dot(gl_FragCoord.xy+seed,vec2(12.9898,78.233)))*43758.5453);c+=(n-.5)*grain*.3;}
 c=clamp(c,0.,1.);
 gl_FragColor=vec4(c*t.a,t.a);
}`,
  init() {
    if (this.ok !== null) return this.ok;
    try {
      const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
      const gl = cv.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: false, antialias: false, alpha: true });
      if (!gl) throw new Error('no webgl');
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, this.VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, this.FS));
      gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      ['tex', 'lut', 'px', 'res', 'exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temp', 'tint', 'highlights', 'shadows', 'hue', 'fade', 'vignette', 'grain', 'sharpen', 'gray', 'sepia', 'splitAmt', 'useLut', 'seed', 'splitS', 'splitH']
        .forEach(n => this.U[n] = gl.getUniformLocation(pr, n));
      const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
      gl.activeTexture(gl.TEXTURE0); this.tex = mk();
      gl.activeTexture(gl.TEXTURE1); this.lutTex = mk();
      gl.uniform1i(this.U.tex, 0); gl.uniform1i(this.U.lut, 1);
      this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.cv = cv; this.gl = gl; this.prog = pr; this.ok = true;
      cv.addEventListener('webglcontextlost', e => { e.preventDefault(); this.ok = null; });
    } catch (e) { console.warn('WebGL grading unavailable:', e.message || e); this.ok = false; }
    return this.ok;
  },
  /* Build shader params from adjustments + filter */
  params(adj, flt, seed = 0) {
    const a = adj || {};
    const p = {
      exposure: (a.exposure || 0) / 100 * 1.5, brightness: (a.brightness || 0) / 100 * .35, contrast: (a.contrast || 0) / 100, saturation: (a.saturation || 0) / 100,
      vibrance: (a.vibrance || 0) / 100, temp: (a.temp || 0) / 100, tint: (a.tint || 0) / 100, highlights: (a.highlights || 0) / 100, shadows: (a.shadows || 0) / 100,
      hue: (a.hue || 0) * Math.PI / 180, fade: (a.fade || 0) / 100, vignette: (a.vignette || 0) / 100, grain: (a.grain || 0) / 100, sharpen: (a.sharpen || 0) / 100 * 1.2,
      gray: 0, sepia: 0, splitAmt: 0, splitS: [.5, .5, .5], splitH: [.5, .5, .5], curve: a.curve || null, seed,
    };
    if (flt && flt.id && flt.id !== 'none') {
      const f = FILTERS.find(x => x.id === flt.id), s = flt.s == null ? 1 : flt.s;
      if (f) {
        for (const k in f.p) {
          if (k === 'splitS' || k === 'splitH') p[k] = f.p[k].map((v, i) => .5 + (v - .5) * s);
          else if (k === 'splitAmt') p[k] = f.p[k] * s;
          else p[k] += f.p[k] * s;
        }
      }
    }
    return p;
  },
  /* returns a canvas holding the graded image (shared canvas - copy/draw it immediately) */
  process(src, sw, sh, ow, oh, params) {
    if (!this.init()) return this.fallback(src, sw, sh, ow, oh, params);
    const gl = this.gl, cv = this.cv;
    ow = Math.max(1, Math.round(ow)); oh = Math.max(1, Math.round(oh));
    if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
    gl.viewport(0, 0, ow, oh);
    let s = src;
    if (sw > this.maxTex || sh > this.maxTex) {
      const k = this.maxTex / Math.max(sw, sh);
      this.tmp = this.tmp || document.createElement('canvas'); this.tmp.width = Math.floor(sw * k); this.tmp.height = Math.floor(sh * k);
      this.tmp.getContext('2d').drawImage(src, 0, 0, this.tmp.width, this.tmp.height); s = this.tmp; sw = this.tmp.width; sh = this.tmp.height;
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s); } catch (e) { return this.fallback(src, sw, sh, ow, oh, params); }
    const Uu = this.U, P = params;
    gl.uniform2f(Uu.px, 1 / sw, 1 / sh); gl.uniform2f(Uu.res, ow, oh);
    ['exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temp', 'tint', 'highlights', 'shadows', 'hue', 'fade', 'vignette', 'grain', 'sharpen', 'gray', 'sepia', 'splitAmt', 'seed']
      .forEach(k => gl.uniform1f(Uu[k], P[k] || 0));
    gl.uniform3fv(Uu.splitS, P.splitS); gl.uniform3fv(Uu.splitH, P.splitH);
    const useLut = P.curve && !Curves.isIdentity(P.curve);
    gl.uniform1f(Uu.useLut, useLut ? 1 : 0);
    if (useLut) {
      const key = JSON.stringify(P.curve);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
      if (key !== this.lutKey) { gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Curves.lut(P.curve)); this.lutKey = key; }
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return cv;
  },
  fallback(src, sw, sh, ow, oh, P) {
    const c = this.fb = this.fb || document.createElement('canvas');
    c.width = Math.round(ow); c.height = Math.round(oh);
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const br = Math.pow(2, P.exposure) * (1 + P.brightness), co = 1 + P.contrast, sa = (1 + P.saturation) * (1 - P.gray);
    x.filter = `brightness(${br}) contrast(${co}) saturate(${sa}) hue-rotate(${P.hue}rad) sepia(${P.sepia}) grayscale(${P.gray})`;
    x.drawImage(src, 0, 0, c.width, c.height); x.filter = 'none';
    return c;
  },
  /* small filter preview thumbnail into a new canvas */
  thumb(src, sw, sh, w, h, filterId, adj) {
    const cover = Math.max(w / sw, h / sh), cw = w / cover, ch = h / cover;
    const crop = U.canvas(w, h); const cx = crop.getContext('2d');
    cx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
    const g = this.process(crop, w, h, w, h, this.params(adj, filterId === 'none' ? null : { id: filterId, s: 1 }));
    const out = U.canvas(w, h); out.getContext('2d').drawImage(g, 0, 0);
    return out;
  },
};
window.FILTERS = FILTERS; window.Curves = Curves; window.ColorGL = ColorGL;
