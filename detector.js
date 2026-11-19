/*
 * RoadGuard AI - road damage detector (pure JavaScript, runs fully offline in the browser)
 *
 * Three analyses, all relative to the road's own look (so they adapt to asphalt, concrete, rough roads):
 *   - small scale  -> thin dark linear structures        => CRACKS
 *   - large scale  -> big compact dark regions           => POTHOLES
 *                  -> compact LIGHT puddles on dark road  => POTHOLES (water-filled)
 *   - texture map  -> patches far busier than the road   => OTHER (broken / damaged surface)
 * Dim frames are brightened first. Each candidate is classified by shape and size
 * and given a confidence score and severity.
 *
 * Input : RGBA pixel array (from canvas getImageData), width, height, options
 * Output: [{type:'crack'|'pothole'|'other', water?:true (pothole hidden under water), wet?:true (water-filled pothole / puddle), x,y,w,h (0..1), conf (0..1), severity:'low'|'medium'|'high'}]
 */
(function (root) {
  'use strict';

  function label(mask, W, H, dark, roiTop, gray) {
    const N = W * H;
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    const comps = [];
    for (let s = roiTop * W; s < N; s++) {
      if (!mask[s] || seen[s]) continue;
      let sp = 0;
      stack[sp++] = s;
      seen[s] = 1;
      let minx = W, maxx = 0, miny = H, maxy = 0, count = 0, dsum = 0, gsum = 0;
      while (sp) {
        const i = stack[--sp];
        const x = i % W, y = (i / W) | 0;
        count++;
        dsum += dark[i];
        if (gray) gsum += gray[i];
        if (x < minx) minx = x;
        if (x > maxx) maxx = x;
        if (y < miny) miny = y;
        if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < roiTop || ny >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            const j = ny * W + nx;
            if (mask[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
          }
        }
      }
      comps.push({ minx, maxx, miny, maxy, count, meanDark: dsum / count, meanGray: gray ? gsum / count : 0 });
    }
    return comps;
  }

  function dilate(mask, W, H, roiTop) {
    const out = new Uint8Array(W * H);
    for (let y = Math.max(1, roiTop); y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W] ||
            mask[i - W - 1] || mask[i - W + 1] || mask[i + W - 1] || mask[i + W + 1]) out[i] = 1;
      }
    }
    return out;
  }

  function detect(rgba, W, H, opt) {
    opt = opt || {};
    const sens = opt.sensitivity == null ? 55 : opt.sensitivity;
    const roiTop = opt.roi === 'full' ? 0 : Math.floor(H * 0.3);
    const N = W * H;
    const minDim = Math.min(W, H);
    const roiArea = W * (H - roiTop);

    const gray = new Float32Array(N);
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }

    // low-light boost: dim frames (evening, tunnel, night) are brightened so the contrast thresholds still work
    let gsum = 0;
    for (let i = roiTop * W; i < N; i++) gsum += gray[i];
    const gmean = gsum / Math.max(1, N - roiTop * W);
    if (gmean < 100) {
      const gain = Math.min(2.2, 110 / Math.max(gmean, 25));
      for (let i = 0; i < N; i++) gray[i] = Math.min(255, gray[i] * gain);
    }

    // integral image for fast box means
    const S = W + 1;
    const integ = new Float64Array(S * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += gray[y * W + x];
        integ[(y + 1) * S + x + 1] = integ[y * S + x + 1] + row;
      }
    }
    const mean = (x, y, r) => {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
      const x1 = Math.min(W - 1, x + r), y1 = Math.min(H - 1, y + r);
      const a = integ[(y1 + 1) * S + x1 + 1] - integ[y0 * S + x1 + 1] - integ[(y1 + 1) * S + x0] + integ[y0 * S + x0];
      return a / ((x1 - x0 + 1) * (y1 - y0 + 1));
    };

    const k = 2.5 - (sens / 100) * 1.5; // higher sensitivity -> lower threshold

    function darkMap(R, r, minThr, bright) {
      const dark = new Float32Array(N);
      let sum = 0, sum2 = 0, cnt = 0;
      for (let y = roiTop; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const d = bright ? mean(x, y, r) - mean(x, y, R) : mean(x, y, R) - mean(x, y, r);
          dark[y * W + x] = d;
          sum += d; sum2 += d * d; cnt++;
        }
      }
      const avg = sum / cnt;
      const std = Math.sqrt(Math.max(0, sum2 / cnt - avg * avg));
      const thr = Math.max(minThr, std * k);
      const mask = new Uint8Array(N);
      for (let i = roiTop * W; i < N; i++) if (dark[i] > thr) mask[i] = 1;
      return { dark, thr, mask };
    }

    const out = [];

    // ---- POTHOLES (large scale) ----
    const L = darkMap(Math.max(12, Math.round(minDim * 0.15)), 2, 14 + (100 - sens) * 0.1);
    const potholes = [];
    for (const c of label(L.mask, W, H, L.dark, roiTop)) {
      const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      const extent = c.count / (bw * bh);
      const elong = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      const frac = c.count / roiArea;
      const contrast = c.meanDark / L.thr;
      if (frac < 0.01 || frac > 0.25) continue;
      if (extent < 0.45 || elong > 2.6 || contrast < 1.1) continue;
      // a crack is a thin line; a pothole is a solid, wide patch (mean width = area / length)
      if (c.count / Math.max(bw, bh) < minDim * 0.04) continue;
      let conf = 0.5 + Math.min(0.25, frac * 8) + Math.min(0.2, (contrast - 1) * 0.25);
      conf = Math.max(0.4, Math.min(0.97, conf));
      const severity = frac > 0.04 ? 'high' : frac > 0.015 ? 'medium' : 'low';
      const d = { type: 'pothole', x: c.minx / W, y: c.miny / H, w: bw / W, h: bh / H, conf, severity };
      potholes.push(d);
      out.push(d);
    }

    // ---- WATER-FILLED POTHOLES: puddles look LIGHTER than the road, compact, with a darker rim ----
    // bright = clearly lighter than the road's typical (median) brightness, after a little smoothing
    const hist = new Uint32Array(256);
    for (let i = roiTop * W; i < N; i++) hist[Math.min(255, gray[i] | 0)]++;
    let acc = 0, roiMed = 0;
    const half = (N - roiTop * W) / 2;
    for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= half) { roiMed = t; break; } }
    // at night headlights and street lights make bright patches, so the bar is higher to avoid fake "water" puddles
    const bThr = 38 + (100 - sens) * 0.2 + (opt.night ? 25 : 0);
    const Bm = new Uint8Array(N);
    const Bd = new Float32Array(N);
    let bsum = 0, bcnt = 0;
    for (let y = roiTop; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = mean(x, y, 2) - roiMed;
        Bd[y * W + x] = d;
        if (d > bThr) { Bm[y * W + x] = 1; bsum += d; bcnt++; }
      }
    }
    const B = { mask: Bm, dark: Bd, thr: bThr };
    const rimDarker = (c) => {
      // sample points just outside the blob's box: most must be darker than the blob itself
      const m = Math.max(3, Math.round(minDim * 0.015));
      let tot = 0, dk = 0;
      const test = (x, y) => {
        if (x < 0 || y < roiTop || x >= W || y >= H) return;
        tot++;
        if (gray[y * W + x] < c.bmean - 6) dk++;
      };
      for (let x = c.minx; x <= c.maxx; x += 2) { test(x, c.miny - m); test(x, c.maxy + m); }
      for (let y = c.miny; y <= c.maxy; y += 2) { test(c.minx - m, y); test(c.maxx + m, y); }
      return tot ? dk / tot : 0;
    };
    const brightBlobs = [];
    for (const c of label(B.mask, W, H, B.dark, roiTop)) {
      const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      const extent = c.count / (bw * bh);
      const elong = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      const frac = c.count / roiArea;
      const contrast = c.meanDark / B.thr;
      if (c.miny <= 1 && roiTop === 0) continue;          // touches the top edge: sky, not road
      if (frac < 0.0012 || frac > 0.25) continue;
      if (extent < 0.45 || elong > 3 || contrast < 1.1) continue;
      let gs = 0;
      for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) gs += gray[y * W + x];
      c.bmean = gs / (bw * bh);
      if (rimDarker(c) < 0.6) continue;
      c.frac = frac; c.contrast = contrast; c.bw = bw; c.bh = bh;
      brightBlobs.push(c);
    }
    // a few separate puddles = a damaged, pot-holed stretch; one lone small bright blob is probably not a pothole
    const bigBlob = brightBlobs.some(c => c.frac > 0.01);
    if (brightBlobs.length >= 3 || bigBlob) {
      for (const c of brightBlobs) {
        let conf = 0.5 + Math.min(0.2, c.frac * 10) + Math.min(0.15, (c.contrast - 1) * 0.2) + Math.min(0.1, brightBlobs.length * 0.02);
        conf = Math.max(0.45, Math.min(0.92, conf));
        const severity = c.frac > 0.04 ? 'high' : c.frac > 0.015 ? 'medium' : 'low';
        const d = { type: 'pothole', x: c.minx / W, y: c.miny / H, w: c.bw / W, h: c.bh / H, conf, severity, wet: true };
        potholes.push(d);
        out.push(d);
      }
    }


    // ---- WATER-COVERED POTHOLES (rain puddles: a hole may hide under the water) ----
    // Standing water is smoother than asphalt (very low texture) and reflects the sky, so it is
    // lighter or darker than the road. Its edge, where water meets road, is busy again.
    // Ordinary puddles are reported as plain potholes; only large, deep-looking or flooded water is flagged "under water".
    {
      const pb = Math.max(4, Math.round(minDim / 40));
      const PW = Math.floor(W / pb), PH = Math.floor(H / pb);
      const py0 = Math.ceil(roiTop / pb);
      if (PW > 6 && PH - py0 > 6) {
        const en = new Float32Array(PW * PH), mg = new Float32Array(PW * PH);
        const ev = [];
        for (let by = py0; by < PH; by++) {
          for (let bx = 0; bx < PW; bx++) {
            let e = 0, g = 0, n = 0;
            for (let y = by * pb; y < by * pb + pb; y++) {
              for (let x = bx * pb; x < bx * pb + pb; x++) {
                if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
                const i = y * W + x;
                e += Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + W] - gray[i - W]);
                g += gray[i]; n++;
              }
            }
            if (!n) continue;
            en[by * PW + bx] = e / n; mg[by * PW + bx] = g / n;
            ev.push(e / n);
          }
        }
        ev.sort((a, b) => a - b);
        const medE = ev[ev.length >> 1] || 0;
        const smoothThr = Math.max(1.2, medE * (0.55 - (sens / 100) * 0.15));
        const usable = medE >= 3;   // a smooth/blurry road has no texture contrast to find water by
        const diffThr = 20 + (100 - sens) * 0.12;
        const pm = new Uint8Array(PW * PH);
        for (let by = py0; by < PH; by++) {
          for (let bx = 0; bx < PW; bx++) {
            const i = by * PW + bx;
            if (usable && en[i] < smoothThr && Math.abs(mg[i] - roiMed) > diffThr) pm[i] = 1;
          }
        }
        const ps = new Uint8Array(PW * PH);
        for (let s = py0 * PW; s < PW * PH; s++) {
          if (!pm[s] || ps[s]) continue;
          const st = [s]; ps[s] = 1;
          let minx = PW, maxx = 0, miny = PH, maxy = 0, cnt = 0, esum = 0;
          const cells = [];
          while (st.length) {
            const i = st.pop(); const x = i % PW, y = (i / PW) | 0;
            cnt++; esum += en[i]; cells.push(i);
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
            const nb = [x > 0 ? i - 1 : -1, x < PW - 1 ? i + 1 : -1, y > py0 ? i - PW : -1, y < PH - 1 ? i + PW : -1];
            for (const j of nb) if (j >= 0 && pm[j] && !ps[j]) { ps[j] = 1; st.push(j); }
          }
          const bw = maxx - minx + 1, bh = maxy - miny + 1;
          const extent = cnt / (bw * bh);
          const elong = Math.max(bw, bh) / Math.min(bw, bh);
          const frac = (cnt * pb * pb) / roiArea;
          if (cnt < 4 || frac < 0.004 || frac > 0.3 || extent < 0.5 || elong > 3.2) continue;
          if (roiTop === 0 && miny === 0) continue;                // touches top edge: sky, not road
          // rim: cells just outside the blob must be clearly more textured (road meets water)
          let rt = 0, rb = 0;
          for (let y = miny - 1; y <= maxy + 1; y++) {
            for (let x = minx - 1; x <= maxx + 1; x++) {
              if (x >= minx && x <= maxx && y >= miny && y <= maxy) continue;
              if (x < 0 || y < py0 || x >= PW || y >= PH) continue;
              rt++; if (en[y * PW + x] > (esum / cnt) * 1.8 + 1.5) rb++;
            }
          }
          if (!rt || rb / rt < 0.55) continue;
          const ox0 = (minx * pb) / W, oy0 = (miny * pb) / H, ow = (bw * pb) / W, oh = (bh * pb) / H;
          let dup = false;
          for (const p of potholes) {
            const ix = Math.max(0, Math.min(ox0 + ow, p.x + p.w) - Math.max(ox0, p.x));
            const iy = Math.max(0, Math.min(oy0 + oh, p.y + p.h) - Math.max(oy0, p.y));
            if ((ix * iy) / (ow * oh) > 0.4) { dup = true; break; }   // hole already visible (maybe a little water inside): stays a normal pothole
          }
          if (dup) continue;
          let conf = 0.48 + Math.min(0.2, frac * 6) + Math.min(0.15, (rb / rt - 0.55) * 0.5);
          conf = Math.max(0.45, Math.min(0.88, conf));
          const severity = frac > 0.05 ? 'high' : frac > 0.02 ? 'medium' : 'low';
          // "under water" only when the hole looks completely covered: a large, deep-looking
          // (darker than the road) water body, or a whole stretch of road flooded.
          // Ordinary shallow, bright puddles are reported as plain potholes.
          let gs2 = 0;
          for (const ci of cells) gs2 += mg[ci];
          const pMean = gs2 / cells.length;
          const hidden = frac > 0.05 && pMean < roiMed - 18 && rb / rt > 0.7;
          const d = { type: 'pothole', x: ox0, y: oy0, w: ow, h: oh, conf, severity, wet: true };
          if (hidden) d.water = true;
          potholes.push(d);
          out.push(d);
        }
      }
    }

    // ---- CRACKS (small scale) ----
    const Rs = Math.max(5, Math.round(minDim * 0.03));
    const Sm = darkMap(Rs, 1, 7 + (100 - sens) * 0.08);
    const cm = dilate(Sm.mask, W, H, roiTop);
    for (const c of label(cm, W, H, Sm.dark, roiTop, gray)) {
      const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      const extent = c.count / (bw * bh);
      const elong = Math.max(bw, bh) / Math.max(1, Math.min(bw, bh));
      const diag = Math.hypot(bw, bh);
      const frac = c.count / roiArea;
      if (frac > 0.2) continue;
      // a real crack is darker than the road itself; the flanks of a lane line or a horizon edge are not
      if (c.meanGray > roiMed - 6) continue;
      if (c.count < Math.max(40, roiArea * 0.0006)) continue;
      if (diag < minDim * 0.14) continue;
      if (!(elong >= 2 || extent < 0.3)) continue;
      // skip rings produced by a pothole's edge
      const cx0 = c.minx / W, cy0 = c.miny / H, cx1 = (c.maxx + 1) / W, cy1 = (c.maxy + 1) / H;
      const ca = (cx1 - cx0) * (cy1 - cy0);
      let covered = false;
      for (const p of potholes) {
        const ix = Math.max(0, Math.min(cx1, p.x + p.w) - Math.max(cx0, p.x));
        const iy = Math.max(0, Math.min(cy1, p.y + p.h) - Math.max(cy0, p.y));
        if ((ix * iy) / ca > 0.6) { covered = true; break; }
      }
      if (covered) continue;
      const contrast = c.meanDark / Sm.thr;
      let conf = 0.42 + Math.min(0.3, (diag / minDim) * 0.55) + Math.min(0.2, (contrast - 1) * 0.1);
      conf = Math.max(0.4, Math.min(0.97, conf));
      const severity = diag > minDim * 0.55 ? 'high' : diag > minDim * 0.3 ? 'medium' : 'low';
      out.push({ type: 'crack', x: cx0, y: cy0, w: bw / W, h: bh / H, conf, severity });
    }

    // ---- OTHER: rough / broken road surface ----
    // Blocks whose texture is much busier than the typical texture of THIS road. Because the
    // reference is the road's own median, it adapts to smooth asphalt, concrete and rough roads alike.
    const bs = Math.max(8, Math.round(minDim / 20));
    const GW = Math.floor(W / bs), GH = Math.floor(H / bs);
    const by0 = Math.ceil(roiTop / bs);
    const energy = new Float32Array(GW * GH);
    const vals = [];
    for (let by = by0; by < GH; by++) {
      for (let bx = 0; bx < GW; bx++) {
        let e = 0, n = 0;
        for (let y = by * bs + 1; y < by * bs + bs - 1; y++) {
          for (let x = bx * bs + 1; x < bx * bs + bs - 1; x++) {
            const i = y * W + x;
            e += Math.abs(gray[i + 1] - gray[i - 1]) + Math.abs(gray[i + W] - gray[i - W]);
            n++;
          }
        }
        const v = e / n;
        energy[by * GW + bx] = v;
        vals.push(v);
      }
    }
    if (vals.length > 20) {
      vals.sort((a, b) => a - b);
      const med = vals[vals.length >> 1];
      const thrE = med * (2.7 - (sens / 100) * 1.1) + 6;
      const gm = new Uint8Array(GW * GH), gs = new Uint8Array(GW * GH);
      for (let i = by0 * GW; i < GW * GH; i++) if (energy[i] > thrE) gm[i] = 1;
      for (let s = by0 * GW; s < GW * GH; s++) {
        if (!gm[s] || gs[s]) continue;
        const st = [s];
        gs[s] = 1;
        let minx = GW, maxx = 0, miny = GH, maxy = 0, cnt = 0, esum = 0;
        while (st.length) {
          const i = st.pop();
          const x = i % GW, y = (i / GW) | 0;
          cnt++; esum += energy[i];
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
          const nb = [x > 0 ? i - 1 : -1, x < GW - 1 ? i + 1 : -1, y > by0 ? i - GW : -1, y < GH - 1 ? i + GW : -1];
          for (const j of nb) if (j >= 0 && gm[j] && !gs[j]) { gs[j] = 1; st.push(j); }
        }
        const bw = maxx - minx + 1, bh = maxy - miny + 1;
        const extent = cnt / (bw * bh);
        const elong = Math.max(bw, bh) / Math.min(bw, bh);
        const frac = (cnt * bs * bs) / roiArea;
        if (cnt < 6 || frac < 0.02 || frac > 0.4 || extent < 0.55 || elong > 2.8) continue;
        const ox0 = (minx * bs) / W, oy0 = (miny * bs) / H, ow = (bw * bs) / W, oh = (bh * bs) / H;
        let covered = false;
        for (const p of out) {
          if (p.type !== 'pothole') continue;
          const ix = Math.max(0, Math.min(ox0 + ow, p.x + p.w) - Math.max(ox0, p.x));
          const iy = Math.max(0, Math.min(oy0 + oh, p.y + p.h) - Math.max(oy0, p.y));
          if ((ix * iy) / (ow * oh) > 0.5) { covered = true; break; }
        }
        if (covered) continue;
        let conf = 0.46 + Math.min(0.2, frac * 1.2) + Math.min(0.1, (esum / cnt / thrE - 1) * 0.1);
        conf = Math.max(0.45, Math.min(0.75, conf));
        const severity = frac > 0.15 ? 'high' : frac > 0.06 ? 'medium' : 'low';
        const o = { type: 'other', x: ox0, y: oy0, w: ow, h: oh, conf, severity };
        // thin "crack" fragments that are really part of this rough patch are dropped
        for (let k = out.length - 1; k >= 0; k--) {
          const c = out[k];
          if (c.type !== 'crack') continue;
          const ix = Math.max(0, Math.min(ox0 + ow, c.x + c.w) - Math.max(ox0, c.x));
          const iy = Math.max(0, Math.min(oy0 + oh, c.y + c.h) - Math.max(oy0, c.y));
          if ((ix * iy) / (c.w * c.h) > 0.7) out.splice(k, 1);
        }
        out.push(o);
      }
    }

    out.sort((a, b) => b.conf - a.conf);
    return out.slice(0, 12);
  }

  const api = { detect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoadDetector = api;
})(typeof window !== 'undefined' ? window : this);