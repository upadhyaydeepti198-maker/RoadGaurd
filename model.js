/*
 * RoadGuard - optional trained-model engine (YOLO / ONNX, runs in the browser)
 *
 * How it works
 *   - If  models/road-damage.onnx  exists, this module loads it with ONNX Runtime Web and the app
 *     uses it instead of the rule-based detector (Settings > Detection engine = Auto).
 *   - If the file is missing or anything fails, the app silently keeps using the rule-based engine.
 *   - Train the model with docs/train_road_damage_yolov8.ipynb (Google Colab), then drop the
 *     exported .onnx file into  models/  (and optionally edit models/classes.json).
 *   - For fully offline use also put onnxruntime-web files into  lib/  (see docs/MODEL_GUIDE.md).
 *
 * Supported output: YOLOv8 detection export, shape [1, 4+classes, anchors] (or transposed).
 */
(function (root) {
  'use strict';

  const M = {
    ready: false,
    status: 'Rules engine (no trained model loaded)',
   cfg: { input: 640, names: ['crack', 'crack', 'crack', 'pothole'], conf: 0.25, iou: 0.45, max: 30 },
    session: null,
    lastInfo: null
  };
  let warned = false;

  /* ---------- pure post-processing (unit-testable, no browser needed) ---------- */
  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = a.w * a.h + b.w * b.h - inter;
    return u > 0 ? inter / u : 0;
  }

  function severityOf(type, w, h) {
    if (type === 'crack') { const L = Math.max(w, h); return L > 0.5 ? 'high' : L > 0.3 ? 'medium' : 'low'; }
    const a = w * h;
    return a > 0.04 ? 'high' : a > 0.015 ? 'medium' : 'low';
  }

  /*
   * data: Float32Array output, dims: output dims, geo: {s, dx, dy, sw, sh, size}
   * returns detections in RoadGuard format (x,y,w,h in 0..1 of the ORIGINAL image)
   */
  function post(data, dims, geo, cfg) {
    const transposed = dims.length === 3 && dims[1] > dims[2];
    const A = transposed ? dims[2] : dims[1];       // attributes per anchor = 4 + classes
    const N = transposed ? dims[1] : dims[2];       // number of anchors
    const nc = A - 4;
    const get = (attr, i) => transposed ? data[i * A + attr] : data[attr * N + i];

    // if scores are raw logits (values above 1), convert them with sigmoid
    let mx = 0;
    for (let i = 0; i < N; i++) for (let c = 0; c < nc; c++) { const v = get(4 + c, i); if (v > mx) mx = v; }
    const logits = mx > 1.0001;

    const cand = [];
    for (let i = 0; i < N; i++) {
      let best = -1, bs = 0;
      for (let c = 0; c < nc; c++) {
        let sc = get(4 + c, i);
        if (logits) sc = 1 / (1 + Math.exp(-sc));
        if (sc > bs) { bs = sc; best = c; }
      }
      if (bs < cfg.conf) continue;
      const cx = get(0, i), cy = get(1, i), w = get(2, i), h = get(3, i);
      let x1 = (cx - w / 2 - geo.dx) / geo.s, y1 = (cy - h / 2 - geo.dy) / geo.s;
      let x2 = (cx + w / 2 - geo.dx) / geo.s, y2 = (cy + h / 2 - geo.dy) / geo.s;
      x1 = Math.max(0, x1); y1 = Math.max(0, y1); x2 = Math.min(geo.sw, x2); y2 = Math.min(geo.sh, y2);
      if (x2 <= x1 || y2 <= y1) continue;
      cand.push({ cls: best, conf: bs, x: x1 / geo.sw, y: y1 / geo.sh, w: (x2 - x1) / geo.sw, h: (y2 - y1) / geo.sh });
    }
    cand.sort((a, b) => b.conf - a.conf);
    const keep = [];
    for (const c of cand) {                                   // class-aware non-maximum suppression
      if (keep.every(k => k.cls !== c.cls || iou(k, c) < cfg.iou)) keep.push(c);
    }
    return keep.slice(0, cfg.max || 30).map(k => {
      const type = cfg.names[k.cls] || 'other';
      return { type, x: k.x, y: k.y, w: k.w, h: k.h, conf: Math.min(0.99, k.conf), severity: severityOf(type, k.w, k.h) };
    });
  }

  /* ---------- browser part ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('cannot load ' + src));
      document.head.appendChild(s);
    });
  }

  /* ---- a model file chosen by the user is kept in the browser (IndexedDB), no re-deploy needed ---- */
  const DB = 'roadguard-model', ST = 'files';
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(ST);
      open.onerror = () => rej(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(ST, mode), r = fn(tx.objectStore(ST));
        tx.oncomplete = () => res(r && r.result);
        tx.onerror = () => rej(tx.error);
      };
    });
  }

  async function loadRuntime() {
    if (root.ort) return;
    let base = 'lib/';
    try { await loadScript('lib/ort.min.js'); }
    catch (e) {
      base = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.1/dist/';
      await loadScript(base + 'ort.min.js');
    }
    root.ort.env.wasm.wasmPaths = base;
    root.ort.env.wasm.numThreads = 1;   // avoids the crossOriginIsolated warning
  }

  async function makeSession(source, label) {
    await loadRuntime();
    M.session = await root.ort.InferenceSession.create(source, { executionProviders: ['wasm'] });
    M.ready = true;
    M.status = 'Trained model active (' + label + ')';
  }

  M.init = async function () {
    try {
      try { const r = await fetch('models/classes.json'); if (r.ok) Object.assign(M.cfg, await r.json()); } catch (e) { /* defaults */ }
      let head = null;
      try { head = await fetch('models/road-damage.onnx', { method: 'HEAD' }); } catch (e) { head = null; }
      if (head && head.ok) { await makeSession('models/road-damage.onnx', 'models folder'); return true; }
      const saved = await idb('readonly', s => s.get('model')).catch(() => null);
      if (saved) { await makeSession(saved, 'uploaded file'); return true; }
      M.status = 'Rules engine (no trained model yet)';
      return false;
    } catch (e) {
      M.ready = false;
      M.status = 'Rules engine (model could not load - check internet for first use)';
      return false;
    }
  };

  M.useFile = async function (file) {
    const buf = await file.arrayBuffer();
    try {
      await makeSession(new Uint8Array(buf), 'uploaded file');
    } catch (e) {
      M.ready = false; M.status = 'Rules engine (that file is not a valid model or the runtime could not load)';
      throw e;
    }
    await idb('readwrite', s => s.put(new Uint8Array(buf), 'model')).catch(() => {});
    return true;
  };

  M.remove = async function () {
    await idb('readwrite', s => s.delete('model')).catch(() => {});
    M.ready = false; M.session = null; M.status = 'Rules engine (no trained model yet)';
  };

  /* opts (optional): { conf, iou, max } overrides the defaults for this call only */
  M.detect = async function (source, sw, sh, opts) {
    if (!M.ready) return null;
    const cfg = Object.assign({}, M.cfg, opts || {});
    const size = cfg.input;
    const s = Math.min(size / sw, size / sh);
    const nw = Math.round(sw * s), nh = Math.round(sh * s);
    const dx = (size - nw) / 2, dy = (size - nh) / 2;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#727272'; cx.fillRect(0, 0, size, size);
    cx.drawImage(source, dx, dy, nw, nh);
    const px = cx.getImageData(0, 0, size, size).data;
    const plane = size * size, t = new Float32Array(3 * plane);
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      t[i] = px[p] / 255; t[plane + i] = px[p + 1] / 255; t[2 * plane + i] = px[p + 2] / 255;
    }
    const out = await M.session.run({ [M.session.inputNames[0]]: new root.ort.Tensor('float32', t, [1, 3, size, size]) });
    const o = out[M.session.outputNames[0]];
    const dims = o.dims, tr = dims.length === 3 && dims[1] > dims[2];
    const nc = (tr ? dims[2] : dims[1]) - 4;
    M.lastInfo = { dims: Array.from(dims), classes: nc };
    if (!warned && nc !== cfg.names.length) {
      warned = true;
      console.warn('RoadModel: model has ' + nc + ' classes but names list has ' + cfg.names.length +
        ' (' + cfg.names.join(',') + '). Fix models/classes.json so the order matches training.');
    }
    return post(o.data, dims, { s, dx, dy, sw, sh, size }, cfg);
  };

  M._post = post;       // exposed for tests
  root.RoadModel = M;
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof window !== 'undefined' ? window : this);