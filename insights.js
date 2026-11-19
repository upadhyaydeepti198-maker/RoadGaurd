/*
 * RoadGuard AI - Insights tab: statistics, REAL MAP (OpenStreetMap via Leaflet), hotspots, CSV / GeoJSON export and printable report.
 * Reads the detection history through window.RG (set up by app.js).
 * If there is no internet (or Leaflet cannot load) it falls back to the old offline plot.
 */
(() => {
  'use strict';
  console.log('RGInsights v3 loaded');
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hist = () => (window.RG ? window.RG.history() : []);
  const hasLoc = e => e.loc && isFinite(e.loc.lat) && isFinite(e.loc.lng);
  const mapLink = (lat, lng) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
  const SEV = { none: 0, low: 1, medium: 2, high: 3 };
  const damaged = e => (e.potholes || 0) + (e.cracks || 0) + (e.others || 0) > 0;
  const risk = e => ((e.potholes || 0) * 3 + (e.cracks || 0) * 2 + (e.others || 0)) * (SEV[e.severity] || 0);
  const dominant = e => (e.potholes ? 'pothole' : e.cracks ? 'crack' : e.others ? 'other' : 'clean');
  const COLORS = { pothole: '#ff5d73', crack: '#1de9d0', other: '#ffb84d', clean: '#34d399' };
  const LABELS = { pothole: 'Pothole', crack: 'Crack', other: 'Other damage', clean: 'No damage' };
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  const placeKey = (la, ln) => (+la).toFixed(4) + ',' + (+ln).toFixed(4);
  const cachedPlace = (la, ln) => (window.Geo && window.Geo.cachedPlace ? window.Geo.cachedPlace(la, ln) : '');

  function bar(label, value, max, color) {
    const w = max ? Math.round((value / max) * 100) : 0;
    return `<div class="bar-row"><span class="bl">${label}</span><div class="bt"><i style="width:${w}%;background:${color}"></i></div><b>${value}</b></div>`;
  }

  /* hotspots: group detections that are within ~25 m of each other */
  function hotspots(list) {
    const cell = 0.00025, map = new Map();
    list.filter(hasLoc).filter(damaged).forEach(e => {
      const k = Math.round(e.loc.lat / cell) + ':' + Math.round(e.loc.lng / cell);
      const g = map.get(k) || { n: 0, score: 0, lat: 0, lng: 0, pot: 0, crk: 0, oth: 0, best: null };
      if (!g.best || risk(e) > risk(g.best)) g.best = e;
      g.n++; g.score += risk(e); g.lat += e.loc.lat; g.lng += e.loc.lng;
      g.pot += e.potholes || 0; g.crk += e.cracks || 0; g.oth += e.others || 0;
      map.set(k, g);
    });
    return [...map.values()].map(g => Object.assign(g, { lat: +(g.lat / g.n).toFixed(6), lng: +(g.lng / g.n).toFixed(6) }))
      .sort((a, b) => b.score - a.score || b.n - a.n);
  }

  /* ---------- offline plot (fallback when there is no internet) ---------- */
  function drawMap(cv, list) {
    const pts = list.filter(hasLoc);
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1a30'; ctx.fillRect(0, 0, W, H);
    if (!pts.length) {
      ctx.fillStyle = '#8fa6c4'; ctx.font = '600 15px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No GPS-tagged detections yet', W / 2, H / 2 - 6);
      ctx.font = '13px system-ui,sans-serif';
      ctx.fillText('Use Live Monitoring or "Take Photo" with location allowed', W / 2, H / 2 + 16);
      return;
    }
    const lat0 = pts.reduce((a, e) => a + e.loc.lat, 0) / pts.length;
    const kx = Math.cos(lat0 * Math.PI / 180);
    const X = e => e.loc.lng * kx, Y = e => e.loc.lat;
    let minX = Math.min(...pts.map(X)), maxX = Math.max(...pts.map(X));
    let minY = Math.min(...pts.map(Y)), maxY = Math.max(...pts.map(Y));
    const minSpan = 0.0006;
    if (maxX - minX < minSpan) { const c = (maxX + minX) / 2; minX = c - minSpan / 2; maxX = c + minSpan / 2; }
    if (maxY - minY < minSpan) { const c = (maxY + minY) / 2; minY = c - minSpan / 2; maxY = c + minSpan / 2; }
    const pad = 36, sx = (W - 2 * pad) / (maxX - minX), sy = (H - 2 * pad) / (maxY - minY), s = Math.min(sx, sy);
    const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s) / 2;
    const px = e => ox + (X(e) - minX) * s, py = e => H - (oy + (Y(e) - minY) * s);
    ctx.strokeStyle = 'rgba(143,166,196,.15)'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(W * i / 8, 0); ctx.lineTo(W * i / 8, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, H * i / 8); ctx.lineTo(W, H * i / 8); ctx.stroke();
    }
    pts.slice().reverse().forEach(e => {
      const d = dominant(e), r = 5 + (SEV[e.severity] || 0) * 2;
      ctx.beginPath(); ctx.arc(px(e), py(e), r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[d] + 'cc'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#04121f'; ctx.stroke();
    });
    const metres = (maxX - minX) * 111320 * (W - 2 * pad) / ((maxX - minX) * s);
    ctx.fillStyle = '#8fa6c4'; ctx.font = '12px system-ui,sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('N ↑   width ≈ ' + (metres >= 1000 ? (metres / 1000).toFixed(1) + ' km' : Math.round(metres) + ' m'), 12, H - 12);
  }

  /* ---------- real map (Leaflet + OpenStreetMap) ---------- */
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
  let leafletP = null, lmap = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = LEAFLET_JS;
      s.onload = () => res();
      s.onerror = () => { leafletP = null; rej(new Error('leaflet')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }

  function popupHtml(e) {
    const d = dominant(e);
    const parts = [];
    if (e.potholes) parts.push(e.potholes + ' pothole' + (e.potholes > 1 ? 's' : ''));
    if (e.cracks) parts.push(e.cracks + ' crack' + (e.cracks > 1 ? 's' : ''));
    if (e.others) parts.push(e.others + ' other');
    return `<b>${LABELS[d]}</b><br>${parts.length ? esc(parts.join(', ')) + '<br>' : ''}` +
      `${e.severity && e.severity !== 'none' ? 'Severity: ' + esc(e.severity) + '<br>' : ''}` +
      `${e.maxConf ? 'Confidence: ' + Math.round(e.maxConf * 100) + '%<br>' : ''}` +
      `${esc(new Date(e.ts).toLocaleString())}<br><small>${esc(e.name || '')}</small>`;
  }

  function showRealMap(box, cv, list) {
    const pts = list.filter(hasLoc);
    if (!pts.length) { drawMap(cv, list); return; }
    if (!navigator.onLine) { drawMap(cv, list); return; }
    loadLeaflet().then(() => {
      if (!box.isConnected) return;
      if (lmap) { lmap.remove(); lmap = null; }
      box.hidden = false; cv.hidden = true;
      lmap = L.map(box, { zoomControl: true, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
      }).addTo(lmap);
      const group = L.featureGroup();
      pts.slice().reverse().forEach(e => {
        const d = dominant(e);
        L.circleMarker([e.loc.lat, e.loc.lng], {
          radius: 7 + (SEV[e.severity] || 0) * 2,
          color: '#04121f', weight: 2, fillColor: COLORS[d], fillOpacity: 0.85
        }).bindPopup(popupHtml(e)).addTo(group);
      });
      group.addTo(lmap);
      lmap.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 18 });
      setTimeout(() => { if (lmap) lmap.invalidateSize(); }, 200);
    }).catch(() => {
      if (!box.isConnected) return;
      box.hidden = true; cv.hidden = false;
      drawMap(cv, list);
    });
  }

  function render() {
    const root = $('#insightsBody');
    if (!root) return;
    if (lmap) { lmap.remove(); lmap = null; }
    const list = hist();
    if (!list.length) {
      root.innerHTML = '<div class="card empty">No data yet. Scan a road or start live monitoring, then come back here for statistics, the map and reports.</div>';
      return;
    }
    const sum = k => list.reduce((a, e) => a + (e[k] || 0), 0);
    const bad = list.filter(damaged).length, gps = list.filter(hasLoc).length;
    const pot = sum('potholes'), crk = sum('cracks'), oth = sum('others');
    const sevCount = { high: 0, medium: 0, low: 0 };
    list.filter(damaged).forEach(e => { if (sevCount[e.severity] != null) sevCount[e.severity]++; });
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dayKey(d.getTime())); }
    const perDay = days.map(k => list.filter(e => damaged(e) && dayKey(e.ts) === k).length);
    const mt = Math.max(1, pot, crk, oth), ms = Math.max(1, ...Object.values(sevCount)), md = Math.max(1, ...perDay);
    const hs = hotspots(list).slice(0, 5);

    root.innerHTML = `
      <div class="card insights-sum">
        <div class="sum-grid">
          <div><b>${list.length}</b><span>Scans</span></div>
          <div><b class="r">${bad}</b><span>With damage</span></div>
          <div><b class="r">${pot}</b><span>Potholes</span></div>
          <div><b class="w">${crk}</b><span>Cracks</span></div>
          <div><b>${oth}</b><span>Other</span></div>
          <div><b class="t">${gps}</b><span>GPS-tagged</span></div>
        </div>
      </div>
      <div class="two">
        <div class="card"><h4>Damage by type</h4>
          ${bar('Potholes', pot, mt, '#ff5d73')}${bar('Cracks', crk, mt, '#1de9d0')}${bar('Other', oth, mt, '#ffb84d')}
        </div>
        <div class="card"><h4>Severity (damaged scans)</h4>
          ${bar('High', sevCount.high, ms, '#ff5d73')}${bar('Medium', sevCount.medium, ms, '#ffb84d')}${bar('Low', sevCount.low, ms, '#8fa6c4')}
        </div>
      </div>
      <div class="card"><h4>Last 7 days (scans with damage)</h4>
        <div class="days">${days.map((k, i) => `<div class="day"><i style="height:${Math.round(perDay[i] / md * 100)}%"></i><b>${perDay[i]}</b><span>${k.slice(5)}</span></div>`).join('')}</div>
      </div>
      <div class="card"><h4>Damage map <small>(red = pothole, turquoise = crack, amber = other, green = clean. Tap a dot for details. Needs internet for the street map)</small></h4>
        <div id="realMap" hidden style="height:380px;width:100%;border-radius:12px;position:relative;z-index:0;isolation:isolate;overflow:hidden"></div>
        <canvas id="mapCanvas" width="720" height="380"></canvas>
      </div>
      <div class="card"><h4>Hotspots <small>(damage within about 25 m, ranked by risk)</small></h4>
        ${hs.length ? hs.map((g, i) => `<div class="hot"><span class="rank">${i + 1}</span><div><b>${g.pot} pothole${g.pot === 1 ? '' : 's'}, ${g.crk} crack${g.crk === 1 ? '' : 's'}, ${g.oth} other</b>
          <small>${g.n} scan${g.n === 1 ? '' : 's'} &middot; risk ${g.score} &middot; ${g.lat}, ${g.lng}</small></div>
          <a class="btn small ghost" target="_blank" rel="noopener" href="${mapLink(g.lat, g.lng)}">Open map</a></div>`).join('')
          : '<p class="muted">No GPS-tagged damage yet.</p>'}
      </div>
      <div class="card"><h4>Report to authority</h4>
        <p class="muted">Make a ready complaint for the top hotspots (with map links) and send it to Nagar Nigam / PWD by WhatsApp, email or share.</p>
        <div class="actions" style="margin-top:12px"><button id="exAuth" class="btn small primary">Complaint for top hotspots</button></div>
      </div>
      <div class="card"><h4>Export and report</h4>
        <div class="actions">
          <button id="exCsv" class="btn small primary">Download CSV</button>
          <button id="exGeo" class="btn small ghost">Download GeoJSON</button>
          <button id="exRep" class="btn small ghost">Print / Save PDF report</button>
        </div>
        <small class="hint">GeoJSON opens in QGIS, Google My Maps and geojson.io. The report can be saved as PDF from the print dialog. Place names and image links in the report need internet.</small>
      </div>`;
    showRealMap($('#realMap'), $('#mapCanvas'), list);
    $('#exCsv').addEventListener('click', exportCsv);
    $('#exGeo').addEventListener('click', exportGeo);
    $('#exRep').addEventListener('click', report);
    $('#exAuth').addEventListener('click', () => {
      const top = hotspots(list).slice(0, 10);
      if (!top.length) { window.RG.toast('No GPS-tagged damage yet'); return; }
      if (window.RGReport) window.RGReport.open(top, 'hotspots');
    });
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  function exportCsv() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const head = ['id', 'datetime', 'source', 'name', 'potholes', 'water_potholes', 'cracks', 'other', 'severity', 'max_confidence', 'lat', 'lng', 'gps_accuracy_m'];
    const rows = hist().map(e => [e.id, new Date(e.ts).toISOString(), e.src, e.name, e.potholes || 0, e.waterPot || 0, e.cracks || 0, e.others || 0,
      e.severity, e.maxConf ? e.maxConf.toFixed(2) : '', hasLoc(e) ? e.loc.lat : '', hasLoc(e) ? e.loc.lng : '', hasLoc(e) ? e.loc.acc : '']);
    download('roadguard-detections-' + stamp() + '.csv', [head.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n'), 'text/csv');
    window.RG.toast('CSV downloaded');
  }

  function exportGeo() {
    const feats = hist().filter(hasLoc).map(e => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.loc.lng, e.loc.lat] },
      properties: { id: e.id, time: new Date(e.ts).toISOString(), source: e.src, potholes: e.potholes || 0, cracks: e.cracks || 0, other: e.others || 0,
        severity: e.severity, confidence: e.maxConf ? +e.maxConf.toFixed(2) : null, accuracy_m: e.loc.acc }
    }));
    if (!feats.length) { window.RG.toast('No GPS-tagged detections to export'); return; }
    download('roadguard-detections-' + stamp() + '.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 2), 'application/geo+json');
    window.RG.toast('GeoJSON downloaded');
  }

  /* ---------- report cells ---------- */
  const locName = (lat, lng) =>
    `<div class="pn" data-key="${placeKey(lat, lng)}" data-la="${lat}" data-ln="${lng}">${esc(cachedPlace(lat, lng))}</div>`;
  const locLink = (lat, lng) => `<a href="${mapLink(lat, lng)}" target="_blank">View location</a>`;

  /* ---------- image links (Cloudinary) ----------
   * Pehle app.js se aaya e.url (Cloudinary link) use hota hai.
   * Agar wo nahi hai to report banate waqt thumbnail Cloudinary par upload hota hai
   * aur neela "View image" link ban jata hai.
   */
  const CLOUD_NAME = 'bwppfsyy';
  const UPLOAD_PRESET = 'roadguard';
  const imgKey = e => (e && e.id != null ? 'id' + e.id : (e ? e.ts + '_' + (e.name || '') : ''));
  const thumbs = new Map();

  const urlCache = {
    get(k) { try { return localStorage.getItem('rg_img_' + k) || ''; } catch (_) { return ''; } },
    set(k, v) { try { localStorage.setItem('rg_img_' + k, v); } catch (_) { /* ignore */ } }
  };

  const viewImageHtml = url => `<a href="${esc(url)}" target="_blank">View image</a>`;

  function uploadThumb(dataUrl) {
    const fd = new FormData();
    fd.append('file', dataUrl);
    fd.append('upload_preset', UPLOAD_PRESET);
    return fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/image/upload', { method: 'POST', body: fd })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('upload failed'))))
      .then(j => j.secure_url || '');
  }

  const isCloud = u => typeof u === 'string' && u.indexOf('https://res.cloudinary.com/') === 0;

  function imgLink(e) {
    if (!e) return '-';
    if (isCloud(e.url)) return viewImageHtml(e.url);
    const k = imgKey(e);
    const cached = urlCache.get(k);
    if (isCloud(cached)) return viewImageHtml(cached);
    const t = e.thumb;
    if (t) {
      thumbs.set(k, t);
      return `<span class="im" data-k="${esc(k)}"><img src="${esc(t)}" alt="detection photo" style="width:70px;height:auto;border-radius:4px;display:block"></span>`;
    }
    return '-';
  }
  function report() {
    const list = hist();
    const sum = k => list.reduce((a, e) => a + (e[k] || 0), 0);
    const hs = hotspots(list).slice(0, 10);
    const w = window.open('', '_blank');
    if (!w) { window.RG.toast('Allow pop-ups to open the report'); return; }
    thumbs.clear();
    const rows = list.map(e => `<tr><td>${esc(new Date(e.ts).toLocaleString())}</td><td>${e.src === 'live' ? 'Live' : 'Photo'}</td>
      <td>${e.potholes || 0}</td><td>${e.cracks || 0}</td><td>${e.others || 0}</td><td>${esc(e.severity)}</td>
      <td>${hasLoc(e) ? locName(e.loc.lat, e.loc.lng) : '-'}</td><td>${hasLoc(e) ? locLink(e.loc.lat, e.loc.lng) : '-'}</td><td>${imgLink(e)}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>RoadGuard AI Road Condition Report</title>
      <style>body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#111}h1{margin:0 0 4px}h2{margin:26px 0 8px;font-size:1.1rem}
      table{border-collapse:collapse;width:100%;font-size:.82rem}th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#eef3f8}
      a{color:#0b5bd3;text-decoration:underline}
      img{max-width:100%}
      .k{display:flex;gap:26px;margin:14px 0}.k div b{display:block;font-size:1.6rem}.note{color:#555;font-size:.8rem;margin-top:18px}
      .pn{font-weight:600;margin-bottom:2px}.pn:empty{display:none}.status{background:#fff7e0;border:1px solid #e6c766;padding:6px 10px;margin:10px 0;font-size:.85rem}
      @media print{.noprint{display:none}}</style></head><body>
      <h1>Road Condition Report</h1><div>Generated by RoadGuard AI on ${esc(new Date().toLocaleString())}</div>
      <div id="st" class="status noprint" hidden></div>
      <div class="k"><div><b>${list.length}</b>scans</div><div><b>${list.filter(damaged).length}</b>with damage</div><div><b>${sum('potholes')}</b>potholes</div>
      <div><b>${sum('cracks')}</b>cracks</div><div><b>${sum('others')}</b>other damage</div></div>
      <h2>Priority locations (risk-ranked)</h2>
      ${hs.length ? `<table><tr><th>#</th><th>Location</th><th>Location Link</th><th>Image</th><th>Potholes</th><th>Cracks</th><th>Other</th><th>Scans</th><th>Risk</th></tr>${hs.map((g, i) =>
        `<tr><td>${i + 1}</td><td>${locName(g.lat, g.lng)}</td><td>${locLink(g.lat, g.lng)}</td><td>${imgLink(g.best)}</td><td>${g.pot}</td><td>${g.crk}</td><td>${g.oth}</td><td>${g.n}</td><td>${g.score}</td></tr>`).join('')}</table>` : '<p>No GPS-tagged damage recorded.</p>'}
      <h2>All detections</h2>
      <table><tr><th>Date and time</th><th>Source</th><th>Potholes</th><th>Cracks</th><th>Other</th><th>Severity</th><th>Location</th><th>Location Link</th><th>Image</th></tr>${rows}</table>
      <p class="note">Automatic screening result from image analysis. Confirm each location on site before planning repair work.</p></body></html>`);
    w.document.close();

    const doPrint = () => setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* user can print manually */ } }, 400);

    const G = window.Geo;
    const nodes = [...w.document.querySelectorAll('.pn')];
    const need = new Map();
    nodes.forEach(n => { if (!n.textContent && !need.has(n.dataset.key)) need.set(n.dataset.key, n); });
    const canPlaces = !!(G && G.place && need.size);

    const imgNodes = [...w.document.querySelectorAll('.im')];
    const imgKeys = [...new Set(imgNodes.map(n => n.dataset.k))].filter(k => thumbs.has(k));

    if (!navigator.onLine || (!canPlaces && !imgKeys.length)) { doPrint(); return; }

    const st = w.document.getElementById('st');
    const total = (canPlaces ? need.size : 0) + imgKeys.length;
    let done = 0;
    st.hidden = false;
    const tick = () => { st.textContent = done < total ? 'Preparing report (place names and image links)... ' + done + ' / ' + total + ' (print dialog opens after this)' : 'Done'; };
    tick();

    const jobs = [];

    if (canPlaces) {
      need.forEach((n, key) => {
        jobs.push(G.place(+n.dataset.la, +n.dataset.ln).then(name => {
          done++;
          if (!w.closed) {
            if (name) nodes.filter(x => x.dataset.key === key).forEach(x => { x.textContent = name; });
            tick();
          }
        }).catch(() => { done++; }));
      });
    }

    imgKeys.forEach(k => {
      jobs.push(uploadThumb(thumbs.get(k)).then(url => {
        done++;
        if (url) {
          urlCache.set(k, url);
          if (!w.closed) imgNodes.filter(x => x.dataset.k === k).forEach(x => { x.innerHTML = viewImageHtml(url); });
        }
        if (!w.closed) tick();
      }).catch(() => { done++; }));
    });

    const timeout = new Promise(r => setTimeout(r, 60000));
    Promise.race([Promise.all(jobs), timeout]).then(() => {
      if (w.closed) return;
      st.hidden = true;
      doPrint();
    });
  }

  window.RGInsights = { render, hotspots, drawMap };
})();