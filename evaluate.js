/*
 * RoadGuard - evaluation tool. Runs the detector on labelled images and reports
 * precision / recall / F1 per class (IoU matching), image-level accuracy and speed.
 */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const TYPES = ['pothole', 'crack', 'other'];
  let last = null;

  function iou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const u = a.w * a.h + b.w * b.h - inter;
    return u > 0 ? inter / u : 0;
  }

  /* greedy matching, highest confidence first */
  function matchSet(P, G, thr) {
    P = P.slice().sort((a, b) => b.conf - a.conf);
    const used = new Set();
    let tp = 0;
    P.forEach(p => {
      let best = -1, bi = 0;
      G.forEach((g, i) => { if (used.has(i)) return; const v = iou(p, g); if (v > bi) { bi = v; best = i; } });
      if (best >= 0 && bi >= thr) { used.add(best); tp++; }
    });
    return { tp, fp: P.length - tp, fn: G.length - tp };
  }

  /* per class */
  function match(preds, gts, thr) {
    const res = {};
    TYPES.forEach(t => {
      res[t] = matchSet(preds.filter(p => p.type === t), gts.filter(g => g.type === t), thr);
    });
    return res;
  }

  /* class ignored (diagnostic: separates box problems from class-order problems) */
  function matchAny(preds, gts, thr) { return matchSet(preds, gts, thr); }

  function parseYolo(text, classes) {
    return text.split(/\r?\n/).map(l => l.trim().split(/\s+/).map(Number)).filter(a => a.length >= 5 && a.every(isFinite)).map(a => {
      const [c, cx, cy, w, h] = a;
      return { type: classes[c] || 'other', x: cx - w / 2, y: cy - h / 2, w, h };
    });
  }

  function loadImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image ' + file.name)); };
      img.src = url;
    });
  }

  const pct = v => (v * 100).toFixed(1) + '%';
  const f2 = v => v.toFixed(3);
  function prf(tp, fp, fn) {
    const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0;
    return { p, r, f: p + r ? 2 * p * r / (p + r) : 0 };
  }
  const num = (sel, def) => { const v = parseFloat($(sel).value); return isFinite(v) ? v : def; };

  async function run() {
    const files = [...$('#files').files];
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { $('#progress').textContent = 'Please choose image files first.'; return; }
    const classes = $('#classes').value.split(',').map(s => s.trim().toLowerCase());
    const thr = num('#iou', 0.5) || 0.5, sens = num('#sens', 55), minConf = num('#conf', 55);
    const useModel = $('#engine').value === 'model';

    // ground truth: labels.json and/or YOLO txt files
    const gt = {};
    let haveLabels = false;
    for (const f of files) {
      if (/\.json$/i.test(f.name)) {
        try { Object.entries(JSON.parse(await f.text())).forEach(([k, v]) => { gt[k.toLowerCase()] = v; }); haveLabels = true; } catch (e) { /* ignore */ }
      } else if (/\.txt$/i.test(f.name)) {
        gt[f.name.replace(/\.txt$/i, '').toLowerCase()] = parseYolo(await f.text(), classes); haveLabels = true;
      }
    }
    const gtFor = name => gt[name.toLowerCase()] || gt[name.replace(/\.[^.]+$/, '').toLowerCase()];
    if (useModel && window.RoadModel && !RoadModel.ready) await RoadModel.init();
    const modelOn = !!(useModel && window.RoadModel && RoadModel.ready);

    const tot = {}; TYPES.forEach(t => { tot[t] = { tp: 0, fp: 0, fn: 0 }; });
    const any = { tp: 0, fp: 0, fn: 0 };
    const img = { tp: 0, fp: 0, fn: 0, tn: 0 };
    const preds = {};
    let ms = 0, n = 0, labelled = 0, fallbacks = 0;
    for (let i = 0; i < imgs.length; i++) {
      $('#progress').textContent = `Analysing ${i + 1} of ${imgs.length}: ${imgs[i].name}`;
      await new Promise(r => setTimeout(r, 0));
      let im;
      try { im = await loadImg(imgs[i]); } catch (e) { continue; }
      const sc = Math.min(1, 720 / im.naturalWidth);
      const w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, w, h);
      const t0 = performance.now();
      let dets = null;
      if (modelOn) {
        try {
          // pass the page's minimum confidence to the model (it was fixed at 0.25 before)
          dets = await RoadModel.detect(im, im.naturalWidth, im.naturalHeight, { conf: minConf / 100 });
        } catch (e) { console.error('Model failed on ' + imgs[i].name, e); dets = null; fallbacks++; }
      }
      if (!dets) dets = RoadDetector.detect(cx.getImageData(0, 0, w, h).data, w, h, { sensitivity: sens, roi: 'lower' });
      ms += performance.now() - t0; n++;
      dets = dets.filter(d => d.conf * 100 >= minConf);
      preds[imgs[i].name] = dets.map(d => ({ type: d.type, x: +d.x.toFixed(4), y: +d.y.toFixed(4), w: +d.w.toFixed(4), h: +d.h.toFixed(4), conf: +d.conf.toFixed(2) }));
      const g = gtFor(imgs[i].name);
      if (!g) continue;
      labelled++;
      const m = match(dets, g, thr);
      TYPES.forEach(t => { tot[t].tp += m[t].tp; tot[t].fp += m[t].fp; tot[t].fn += m[t].fn; });
      const a = matchAny(dets, g, thr);
      any.tp += a.tp; any.fp += a.fp; any.fn += a.fn;
      const hasG = g.length > 0, hasP = dets.length > 0;
      if (hasG && hasP) img.tp++; else if (!hasG && hasP) img.fp++; else if (hasG && !hasP) img.fn++; else img.tn++;
    }
    $('#progress').textContent = 'Done.';
    let engine = modelOn ? 'trained model' : 'rules engine';
    let warn = '';
    if (useModel && !modelOn) warn = ' WARNING: trained model could not load, rules engine was used.';
    else if (fallbacks) warn = ` WARNING: model failed on ${fallbacks} image(s), rules engine was used for those.`;
    last = { tot, any, img, preds, ms: n ? ms / n : 0, n, labelled, thr, haveLabels, engine, warn, minConf };
    show();
  }

  function rows() {
    const out = [];
    let mp = 0, mr = 0, mf = 0, k = 0, stp = 0, sfp = 0, sfn = 0;
    TYPES.forEach(t => {
      const { tp, fp, fn } = last.tot[t], s = prf(tp, fp, fn);
      out.push({ cls: t, p: s.p, r: s.r, f: s.f, tp, fp, fn, support: tp + fn });
      if (tp + fn > 0) { mp += s.p; mr += s.r; mf += s.f; k++; }
      stp += tp; sfp += fp; sfn += fn;
    });
    const mi = prf(stp, sfp, sfn);
    out.push({ cls: 'macro avg', p: k ? mp / k : 0, r: k ? mr / k : 0, f: k ? mf / k : 0, tp: '', fp: '', fn: '', support: stp + sfn });
    out.push({ cls: 'micro avg', p: mi.p, r: mi.r, f: mi.f, tp: stp, fp: sfp, fn: sfn, support: stp + sfn });
    return out;
  }

  function show() {
    $('#out').hidden = false;
    if (!last.labelled) {
      $('#summary').textContent = `${last.n} images analysed in ${last.ms.toFixed(0)} ms per image on average. No label files were found, so accuracy cannot be computed. Use "Download predicted labels" to start labelling.`;
      $('#tbl').innerHTML = ''; $('#tbl2').innerHTML = '';
      $('#dlPred').disabled = false; $('#dlCsv').disabled = true; $('#dlMd').disabled = true;
      return;
    }
    const R = rows();
    const A = last.any;
    $('#summary').textContent = `${last.labelled} labelled images (of ${last.n}), IoU >= ${last.thr}, min confidence ${last.minConf}%, engine: ${last.engine}, average ${last.ms.toFixed(0)} ms per image. ` +
      `Class ignored: TP ${A.tp}, FP ${A.fp}, FN ${A.fn}.` + last.warn;
    $('#tbl').innerHTML = '<tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th><th>TP</th><th>FP</th><th>FN</th><th>Support</th></tr>' +
      R.map(r => `<tr><td>${r.cls}</td><td>${f2(r.p)}</td><td>${f2(r.r)}</td><td>${f2(r.f)}</td><td>${r.tp}</td><td>${r.fp}</td><td>${r.fn}</td><td>${r.support}</td></tr>`).join('');
    const I = last.img, tot = I.tp + I.fp + I.fn + I.tn, ip = prf(I.tp, I.fp, I.fn);
    $('#tbl2').innerHTML = '<tr><th>Accuracy</th><th>Precision</th><th>Recall</th><th>TP</th><th>FP</th><th>FN</th><th>TN</th></tr>' +
      `<tr><td>${pct(tot ? (I.tp + I.tn) / tot : 0)}</td><td>${f2(ip.p)}</td><td>${f2(ip.r)}</td><td>${I.tp}</td><td>${I.fp}</td><td>${I.fn}</td><td>${I.tn}</td></tr>`;
    ['#dlCsv', '#dlMd', '#dlPred'].forEach(s => { $(s).disabled = false; });
  }

  function dl(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  $('#run').addEventListener('click', () => run().catch(e => { $('#progress').textContent = 'Error: ' + e.message; }));
  $('#dlCsv').addEventListener('click', () => {
    const R = rows();
    dl('roadguard-metrics.csv', 'class,precision,recall,f1,tp,fp,fn,support\n' + R.map(r => [r.cls, f2(r.p), f2(r.r), f2(r.f), r.tp, r.fp, r.fn, r.support].join(',')).join('\n'), 'text/csv');
  });
  $('#dlMd').addEventListener('click', async () => {
    const R = rows();
    const md = '| Class | Precision | Recall | F1-score | Support |\n| --- | --- | --- | --- | --- |\n' + R.map(r => `| ${r.cls} | ${f2(r.p)} | ${f2(r.r)} | ${f2(r.f)} | ${r.support} |`).join('\n');
    try { await navigator.clipboard.writeText(md); $('#progress').textContent = 'Markdown table copied.'; } catch (e) { $('#progress').textContent = md; }
  });
  $('#dlPred').addEventListener('click', () => dl('predicted-labels.json', JSON.stringify(last.preds, null, 2), 'application/json'));

  window.RGEval = { iou, match, matchAny, parseYolo, prf };
})();