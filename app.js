(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- storage ---------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const DEFAULTS = { warn: true, beep: true, voice: true, lang: 'en', sens: 55, minConf: 55, roi: 'lower', saveLive: true, geo: true, engine: 'auto', galleryLoc: 'current', rain: false, mode: 'auto', cloudName: 'bwppfsyy', cloudPreset: 'roadguard' };
  let settings = Object.assign({}, DEFAULTS, LS.get('rg.settings', {}));
  if (!settings.cloudName) settings.cloudName = DEFAULTS.cloudName;       // purani khali setting ho to default use ho
  if (!settings.cloudPreset) settings.cloudPreset = DEFAULTS.cloudPreset;
  let history = LS.get('rg.history', []);
  const saveSettings = () => LS.set('rg.settings', settings);
  function saveHistory() {
    if (history.length > 150) history.length = 150;
    if (!LS.set('rg.history', history)) {
      history = history.slice(0, Math.max(1, Math.floor(history.length / 2)));
      LS.set('rg.history', history);
    }
  }

  /* ---------- helpers ---------- */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  const fmtDate = ts => new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtShort = ts => new Date(ts).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const NAMES = { pothole: 'Pothole', crack: 'Crack', other: 'Other damage' };
  const nameOf = d => d.type === 'pothole' && d.water ? 'Pothole under water' : d.type === 'pothole' && d.wet ? 'Water-filled pothole' : NAMES[d.type];

  /* ---------- navigation ---------- */
  function show(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tabs [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view !== 'live') stopLive();
    if (view === 'history') renderHistory();
    if (view === 'scan') renderStats();
    if (view === 'insights' && window.RGInsights) RGInsights.render();
    if (view === 'settings') updateEngineStatus();
    window.scrollTo(0, 0);
  }
  $$('.tabs [data-view]').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  /* ---------- warnings (beep + voice in English AND Hindi) ---------- */
  let actx;
  function audio() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(times = 3) {
    const c = audio();
    if (!c) return;
    let t = c.currentTime;
    for (let i = 0; i < times; i++) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      o.frequency.value = i % 2 ? 740 : 988;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(c.destination);
      o.start(t); o.stop(t + 0.2);
      t += 0.25;
    }
  }
  /* P = pothole visible, W = pothole hidden under water, C = crack, O = other damage */
  const sigOf = dets => ({
    P: dets.some(d => d.type === 'pothole' && !d.water && !d.wet),
    S: dets.some(d => d.type === 'pothole' && d.wet && !d.water),
    W: dets.some(d => d.type === 'pothole' && d.water),
    C: dets.some(d => d.type === 'crack'),
    O: dets.some(d => d.type === 'other')
  });
  const sigKey = s => s === 'ok' ? 'ok' : (s.P ? 'P' : '') + (s.S ? 'S' : '') + (s.W ? 'W' : '') + (s.C ? 'C' : '') + (s.O ? 'O' : '');
  const sigRank = s => s === 'ok' ? 0 : (s.P || s.S || s.W) ? 3 : s.O ? 2 : 1;
  const joinEn = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];

  function textEn(s) {
    const hasPot = s.P || s.S || s.W;
    const out = [];
    if (s.C || hasPot) {
      const what = s.C && hasPot ? 'Crack and pothole are detected.' : s.C ? 'Cracks are detected.' : 'Potholes are detected.';
      out.push(what + ' Danger ahead. Please stop. Danger ahead.');
      if (s.W) out.push('A pothole is hidden under the water.');
      if (s.S || s.W) out.push('There is water on the road. Please slow down.');
      if (settings.rain) out.push('Rain mode is on. Drive slowly.');
      if (s.O) out.push('Other type of damage is also detected.');
    } else if (s.O) {
      out.push('Other type of damage is detected. Please stop.');
    }
    return out.join(' ');
  }
  function textHi(s) {
    const hasPot = s.P || s.S || s.W;
    const out = [];
    if (s.C || hasPot) {
      const what = s.C && hasPot ? 'दरार और गड्ढा मिले हैं।' : s.C ? 'दरारें मिली हैं।' : 'गड्ढे मिले हैं।';
      out.push(what + ' आगे खतरा है। कृपया रुकिए। आगे खतरा है।');
      if (s.W) out.push('गड्ढा पानी के नीचे छिपा है।');
      if (s.S || s.W) out.push('सड़क पर पानी भरा है। कृपया धीरे चलिए।');
      if (settings.rain) out.push('बारिश मोड चालू है। धीरे चलाइए।');
      if (s.O) out.push('दूसरी तरह की खराबी भी मिली है।');
    } else if (s.O) {
      out.push('दूसरी तरह की खराबी मिली है। कृपया रुकिए।');
    }
    return out.join(' ');
  }
  const OK_EN = 'No crack, pothole or other damage is detected. Please go ahead, move forward.';
  const OK_HI = 'कोई दरार, गड्ढा या दूसरी खराबी नहीं मिली। कृपया आगे बढ़िए।';
  const OK_TXT = 'No damage detected - you can go ahead';

  function speak(sig, done) {
    if (!('speechSynthesis' in window)) { if (done) done(); return; }
    const en = sig === 'ok' ? OK_EN : textEn(sig);
    const hi = sig === 'ok' ? OK_HI : textHi(sig);
    const u1 = new SpeechSynthesisUtterance(en); u1.lang = 'en-IN';
    const u2 = new SpeechSynthesisUtterance(hi); u2.lang = 'hi-IN';
    let finished = false;
    const fin = () => { if (finished) return; finished = true; if (done) done(); };
    u2.onend = fin; u2.onerror = fin;
    speechSynthesis.cancel();
    speechSynthesis.speak(u1);
    speechSynthesis.speak(u2);
  }
  const namesUpper = s => joinEn([s.C && 'cracks', s.P && 'potholes', s.S && 'water-filled potholes', s.W && 'pothole under water', s.O && 'other damage'].filter(Boolean)).toUpperCase();
  const alertLine = s => 'STOP! ' + namesUpper(s) + ' DETECTED - DANGER AHEAD';
  const dangerTitle = s => 'STOP! ' + namesUpper(s) + ' AHEAD';
  const alarm = { on: false, sig: null, key: '', timer: null, mutedUntil: 0, gen: 0 };
  function refreshAlertIdle() {
    const s = $('#alertState');
    $('#alertBox').classList.remove('alert');
    if (settings.warn) {
      s.className = 'state ok'; s.textContent = 'Standby';
      $('#alertText').textContent = 'Automatic beep and voice warning (English + Hindi) on damage detection. The alarm repeats until you press Stop.';
    } else {
      s.className = 'state off'; s.textContent = 'Muted';
      $('#alertText').textContent = 'Warnings are OFF. Turn them on with the bell button.';
    }
  }
  function flashAlert(sig) {
    const st = $('#alertState');
    if (sig === 'ok') {
      $('#alertBox').classList.remove('alert');
      st.className = 'state ok';
      st.textContent = 'GO AHEAD';
      $('#alertText').textContent = OK_TXT;
      return;
    }
    $('#alertBox').classList.add('alert');
    st.className = 'state alert';
    st.textContent = 'STOP';
    $('#alertText').textContent = alertLine(sig);
  }

  /* One alarm loop for everything: damage = beep + voice, all clear = voice only. Both repeat until Stop is pressed. */
  function alarmCycle() {
    if (!alarm.on) return;
    const g = ++alarm.gen;
    const isOk = alarm.sig === 'ok';
    if (settings.beep && !isOk) beep();
    clearTimeout(alarm.timer);
    if (!settings.voice) { alarm.timer = setTimeout(alarmCycle, 2000); return; }
    let next = false;
    const again = () => {
      if (next || g !== alarm.gen) return;
      next = true; clearTimeout(alarm.timer); alarm.timer = setTimeout(alarmCycle, 1200);
    };
    setTimeout(() => {
      if (!alarm.on || g !== alarm.gen) return;
      speak(alarm.sig, again);
      alarm.timer = setTimeout(again, 30000);
    }, settings.beep && !isOk ? 850 : 0);
  }
  function startAlarm(sig, force) {
    const key = sigKey(sig);
    if (alarm.on) {
      if (alarm.sig === 'ok' && sig !== 'ok') {
        // damage appeared while the "all clear" voice was running: switch to the danger alarm
        alarm.gen++;
        clearTimeout(alarm.timer);
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        alarm.sig = sig; alarm.key = key;
        flashAlert(sig);
        document.body.classList.add('alarm-on');
        alarmCycle();
        return;
      }
      if (sig === 'ok') return;
      if (sigRank(sig) > sigRank(alarm.sig) || (live.on && key !== alarm.key)) { alarm.sig = sig; alarm.key = key; flashAlert(sig); }
      return;
    }
    if (!force && Date.now() < alarm.mutedUntil) return;
    audio();
    alarm.on = true;
    alarm.sig = sig; alarm.key = key;
    flashAlert(sig);
    $('#stopAlarm').hidden = false;
    if (sig !== 'ok') document.body.classList.add('alarm-on');
    alarmCycle();
  }
  function stopAlarm(auto) {
    if (!alarm.on) return;
    const wasOk = alarm.sig === 'ok';
    alarm.on = false;
    alarm.gen++;
    clearTimeout(alarm.timer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    alarm.mutedUntil = (auto === true || wasOk) ? 0 : Date.now() + 10000;
    $('#stopAlarm').hidden = true;
    document.body.classList.remove('alarm-on');
    hideDanger();
    refreshAlertIdle();
    if (auto !== true) toast('Alarm stopped');
  }
  function warn(dets, force) {
    if ((!settings.warn && !force) || !dets.length) return;
    startAlarm(sigOf(dets), force);
  }
  function warnOk(force) {
    if (!settings.warn || !settings.voice) return;
    startAlarm('ok', force);
  }
  function updateWarnUI() {
    const b = $('#warnToggle');
    b.classList.toggle('on', settings.warn);
    b.innerHTML = `<svg class="ic"><use href="#${settings.warn ? 'i-bell' : 'i-bell-off'}"/></svg><span>Warnings ${settings.warn ? 'ON' : 'OFF'}</span>`;
    $('#setWarn').checked = settings.warn;
    if (!settings.warn && alarm.on) stopAlarm();
    refreshAlertIdle();
    updateRainUI();
  }
  function updateRainUI() {
    const b = $('#rainBtn'), c = $('#setRain');
    if (b) { b.classList.toggle('on', !!settings.rain); b.innerHTML = `<svg class="ic"><use href="#i-rain"/></svg> Rain mode ${settings.rain ? 'ON' : 'OFF'}`; }
    if (c) c.checked = !!settings.rain;
  }
  function toggleRain() {
    settings.rain = !settings.rain;
    saveSettings(); updateRainUI();
    toast(settings.rain ? 'Rain mode ON: earlier water warnings and "slow down" voice' : 'Rain mode OFF');
  }
  $('#warnToggle').addEventListener('click', () => {
    settings.warn = !settings.warn;
    saveSettings(); updateWarnUI();
    if (settings.warn) audio();
    toast(settings.warn ? 'Warnings turned ON' : 'Warnings turned OFF');
  });

  /* ---------- analysis ---------- */
  const COL = { pothole: '#ff5d73', crack: '#1de9d0', other: '#ffb84d' };
  let autoNight = false;
  const effSens = n => (settings.rain ? Math.min(95, settings.sens + 15) : settings.sens) + (n ? 10 : 0);
  const effMinConf = n => (settings.rain ? Math.max(30, settings.minConf - 5) : settings.minConf) - (n ? 5 : 0);

  function isNightFrame(cx, w, h) {
    if (settings.mode === 'day') return false;
    if (settings.mode === 'night') return true;
    const y0 = Math.floor(h * 0.3);
    const d = cx.getImageData(0, y0, w, Math.max(1, h - y0)).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 64) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    const lum = s / Math.max(1, n);
    autoNight = autoNight ? lum < 90 : lum < 65;
    return autoNight;
  }
  function brighten(cx, w, h) {
    const img = cx.getImageData(0, 0, w, h), d = img.data;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(i / 255, 0.5);
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    cx.putImageData(img, 0, 0);
  }

  /* allowNight = true only for live camera frames. Uploaded photos are never auto-brightened.
     The trained model always gets the ORIGINAL frame (same look as its training images);
     brighten() is used only for the rules engine at night. */
  async function analyze(source, sw, sh, maxW, allowNight) {
    const sc = Math.min(1, maxW / sw);
    const w = Math.max(1, Math.round(sw * sc)), h = Math.max(1, Math.round(sh * sc));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(source, 0, 0, w, h);
    const night = !!allowNight && isNightFrame(cx, w, h);
    let dets = null, engine = 'rules';
    if (settings.engine !== 'rules' && window.RoadModel && RoadModel.ready) {
      try { dets = await RoadModel.detect(source, sw, sh); engine = 'model'; } catch (e) { dets = null; }
    }
    if (!dets) {
      if (night) brighten(cx, w, h);
      const data = cx.getImageData(0, 0, w, h).data;
      dets = RoadDetector.detect(data, w, h, { sensitivity: effSens(night), roi: settings.roi, night });
      engine = 'rules';
    }
    dets = dets.filter(d => d.conf * 100 >= effMinConf(night));
    return { cv, dets, engine, night };
  }

  function drawBoxes(ctx, w, h, dets) {
    const fs = Math.max(12, Math.round(w / 38));
    ctx.lineWidth = Math.max(2, w / 220);
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    dets.forEach(d => {
      const x = d.x * w, y = d.y * h, bw = d.w * w, bh = d.h * h;
      ctx.strokeStyle = COL[d.type];
      ctx.strokeRect(x, y, bw, bh);
      const label = `${nameOf(d)} ${Math.round(d.conf * 100)}%`;
      const tw = ctx.measureText(label).width + 12, th = fs + 8;
      const ly = y - th < 0 ? y : y - th;
      ctx.fillStyle = COL[d.type];
      ctx.fillRect(x, ly, tw, th);
      ctx.fillStyle = '#06101f';
      ctx.fillText(label, x + 6, ly + th / 2);
    });
  }

  function thumb(cv) {
    const s = Math.min(1, 280 / cv.width);
    const t = document.createElement('canvas');
    t.width = Math.round(cv.width * s); t.height = Math.round(cv.height * s);
    t.getContext('2d').drawImage(cv, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.6);
  }

  function summarize(dets) {
    const count = t => dets.filter(d => d.type === t).length;
    const rank = { low: 1, medium: 2, high: 3 };
    const sev = dets.reduce((m, d) => rank[d.severity] > rank[m] ? d.severity : m, 'low');
    return { potholes: count('pothole'), waterPot: dets.filter(d => d.type === 'pothole' && d.water).length, wetPot: dets.filter(d => d.type === 'pothole' && d.wet && !d.water).length, cracks: count('crack'), others: count('other'), maxConf: dets.length ? Math.max(...dets.map(d => d.conf)) : 0, severity: dets.length ? sev : 'none' };
  }

  /* ---------- Cloudinary upload (permanent image link for reports) ---------- */
  const cloudOn = () => !!(settings.cloudName && settings.cloudPreset);
  const dataUrlToBlob = u => {
    const p = u.split(','), bin = atob(p[1]), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: 'image/jpeg' });
  };
  const canvasBlob = cv => new Promise(res => cv.toBlob(b => res(b), 'image/jpeg', 0.85));
  async function uploadBlob(blob) {
    if (!cloudOn() || !navigator.onLine || !blob) return null;
    try {
      const fd = new FormData();
      fd.append('file', blob);
      fd.append('upload_preset', settings.cloudPreset.trim());
      const r = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(settings.cloudName.trim()) + '/image/upload', { method: 'POST', body: fd });
      if (!r.ok) return null;
      const j = await r.json();
      return j.secure_url || null;
    } catch (e) { return null; }
  }
  async function uploadEntry(id, cv) {
    const e = history.find(x => x.id === id);
    if (!e || e.url || !((e.potholes || 0) + (e.cracks || 0) + (e.others || 0) > 0)) return;
    const blob = cv ? await canvasBlob(cv) : (e.thumb ? dataUrlToBlob(e.thumb) : null);
    const url = await uploadBlob(blob);
    if (url) {
      const h = history.find(x => x.id === id);
      if (h) { h.url = url; saveHistory(); }
    }
  }
  function syncUploads() {
    if (!cloudOn()) return Promise.resolve();
    const jobs = history.filter(e => !e.url && (e.potholes || 0) + (e.cracks || 0) + (e.others || 0) > 0).slice(0, 20).map(e => uploadEntry(e.id, null));
    return Promise.all(jobs);
  }

  function addHistory(src, name, dets, cv, loc) {
    const e = Object.assign({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), src, name, thumb: thumb(cv)
    }, summarize(dets));
    if (loc) e.loc = loc;
    history.unshift(e);
    saveHistory();
    uploadEntry(e.id, cv);                                     // background upload, link is saved in e.url
    return e.id;
  }

  function chipsFor(e) {
    let h = '';
    if (e.potholes) h += `<span class="chip pothole">${e.potholes} Pothole${e.potholes > 1 ? 's' : ''}</span>`;
    if (e.waterPot) h += `<span class="chip pothole">${e.waterPot} under water</span>`;
    if (e.wetPot) h += `<span class="chip wet">${e.wetPot} water-filled</span>`;
    if (e.cracks) h += `<span class="chip crack">${e.cracks} Crack${e.cracks > 1 ? 's' : ''}</span>`;
    if (e.others) h += `<span class="chip other">${e.others} Other damage</span>`;
    if (e.severity !== 'none') h += `<span class="chip sev ${e.severity}">${e.severity.toUpperCase()} severity</span>`;
    if (e.maxConf) h += `<span class="chip sev">${Math.round(e.maxConf * 100)}% confidence</span>`;
    return h;
  }

  /* ---------- stats ---------- */
  function renderStats() {
    $('#stScans').textContent = history.length;
    $('#stPot').textContent = history.reduce((a, e) => a + (e.potholes || 0), 0);
    $('#stCrk').textContent = history.reduce((a, e) => a + (e.cracks || 0), 0);
    $('#stOth').textContent = history.reduce((a, e) => a + (e.others || 0), 0);
    $('#stLast').textContent = history.length ? fmtShort(history[0].ts) : '--';
  }

  /* ---------- scan (camera + gallery) ---------- */
  function loadImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }

  function setProgress(i, n, name) {
    $('#progressBar').style.width = Math.round((i / n) * 100) + '%';
    $('#progressText').textContent = `Analysing ${i + 1} of ${n}: ${name}`;
  }

  function updateResultsSummary() {
    const cards = $$('#results .result');
    if (!cards.length) { $('#resultsHead').hidden = true; return; }
    const bad = cards.filter(c => c.dataset.bad === '1').length;
    $('#resultsSummary').textContent = `${cards.length} image${cards.length > 1 ? 's' : ''} scanned, damage found in ${bad}`;
  }

  function verdictText(dets) {
    const s = sigOf(dets);
    const t = [];
    if (s.C) t.push('Cracks'); if (s.P) t.push('Potholes'); if (s.S) t.push('Water-filled potholes'); if (s.W) t.push('Pothole under water'); if (s.O) t.push('Other damage');
    return joinEn(t) + (s.O && t.length === 1 ? ' is' : ' are') + ' detected';
  }

  function addCard(name, cv, dets, hid, loc) {
    const e = summarize(dets);
    const card = document.createElement('article');
    card.className = 'card result';
    card.dataset.bad = dets.length ? '1' : '0';
    const verdict = dets.length
      ? `<div class="verdict bad"><svg class="ic"><use href="#i-alert"/></svg> ${verdictText(dets)}</div>`
      : `<div class="verdict ok"><svg class="ic"><use href="#i-shield"/></svg> ${OK_TXT}</div>`;
    card.innerHTML = `<div class="meta"><div class="top"><div><div class="name"></div><div class="when">${fmtDate(Date.now())}</div></div>
      <button class="icon-btn" title="Delete this result" aria-label="Delete this result"><svg class="ic"><use href="#i-trash"/></svg></button></div>
      ${verdict}<div class="chips">${chipsFor(e)}</div></div>`;
    $('.name', card).textContent = name;
    if (loc) { const w = $('.when', card); w.textContent += ' \u00b7 location: ' + loc.lat + ', ' + loc.lng + (loc.src === 'exif' ? ' (from photo)' : ' (your position)'); }
    card.insertBefore(cv, card.firstChild);
    if (dets.length) {
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'btn small ghost rp-btn';
      rb.innerHTML = '<svg class="ic"><use href="#i-send"/></svg> Report to authority';
      rb.addEventListener('click', () => {
        const ent = history.find(x => x.id === hid);
        if (ent && window.RGReport) RGReport.open([ent], 'single', cv); else toast('Report is not available');
      });
      $('.meta', card).appendChild(rb);
    }
    $('.icon-btn', card).addEventListener('click', () => {
      card.remove();
      history = history.filter(x => x.id !== hid);
      saveHistory(); renderStats(); updateResultsSummary();
      toast('Result deleted');
    });
    $('#results').appendChild(card);
  }

  async function handleFiles(fileList, tagGeo, append) {
    const files = [...fileList].filter(f => f.type.startsWith('image/'));
    if (!files.length) { toast('Please choose image files'); return; }
    audio();
    if (!append) $('#results').innerHTML = '';
    $('#resultsHead').hidden = false;
    $('#progress').hidden = false;
    const found = [];
    let nowLoc, nowLocDone = false;
    const getNow = async () => { if (!nowLocDone) { nowLoc = await Geo.current(); nowLocDone = true; } return nowLoc ? Object.assign({ src: 'gps' }, nowLoc) : null; };

    if (settings.geo && (tagGeo || settings.galleryLoc === 'current')) {
      $('#progressText').textContent = 'Please allow location access to continue...';
      await getNow();
    }

    for (let i = 0; i < files.length; i++) {
      setProgress(i, files.length, files[i].name);
      await new Promise(r => setTimeout(r, 30));
      try {
        const img = await loadImg(files[i]);
        const { cv, dets } = await analyze(img, img.naturalWidth, img.naturalHeight, 720, false);   // photos: no auto-brighten
        drawBoxes(cv.getContext('2d'), cv.width, cv.height, dets);
        let loc = null;
        if (settings.geo) {
          loc = await ExifGPS.read(files[i]);
          if (!loc && (tagGeo || settings.galleryLoc === 'current')) loc = await getNow();
        }
        const hid = addHistory('photo', files[i].name || 'Camera photo', dets, cv, loc);
        addCard(files[i].name || 'Camera photo', cv, dets, hid, loc);
        found.push(...dets);
      } catch (e) {
        toast('Could not read ' + files[i].name);
      }
    }
    $('#progressBar').style.width = '100%';
    setTimeout(() => { $('#progress').hidden = true; $('#progressBar').style.width = '0'; }, 400);
    updateResultsSummary(); renderStats();
    if (found.length) { warn(found); toast(`${verdictText(found)} (${found.length} spot${found.length > 1 ? 's' : ''})`); }
    else {
      toast(OK_TXT);
      warnOk();
    }
    $('#resultsHead').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  ['#inGallery', '#inScan'].forEach(s => { const el = $(s); if (el) el.multiple = true; });

  (function setupAddMore() {
    const head = $('#resultsHead');
    if (!head) return;
    let inp = $('#inAdd');
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file'; inp.id = 'inAdd'; inp.accept = 'image/*'; inp.hidden = true;
      head.appendChild(inp);
    }
    inp.multiple = true;
    let btn = $('#addMore');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'addMore'; btn.className = 'btn';
      btn.textContent = '+ Add more photos';
      head.appendChild(btn);
    }
    btn.addEventListener('click', () => inp.click());
    inp.addEventListener('change', e => { handleFiles(e.target.files, false, true); e.target.value = ''; });
  })();

  $('#inCamera').addEventListener('change', e => { handleFiles(e.target.files, true); e.target.value = ''; });
  $('#inGallery').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  $('#inScan').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  $('#tileLive').addEventListener('click', () => { show('live'); startLive(); });
  $('#clearScreen').addEventListener('click', () => { $('#results').innerHTML = ''; $('#resultsHead').hidden = true; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  /* ---------- live monitoring ---------- */
  const live = { on: false, stream: null, timer: null, lastWarn: 0, lastSave: 0, hits: [], hideAt: 0 };
  let torchOn = false;
  let torchBtn = null;

  function hideDanger() { $('#dangerBanner').hidden = true; }
  function showDanger(dets) {
    const sig = sigOf(dets);
    const b = $('#dangerBanner');
    b.classList.remove('caution');
    $('#dangerTitle').textContent = dangerTitle(sig);
    $('#dangerSub').textContent = dets.slice(0, 2).map(d => `${nameOf(d)} ${Math.round(d.conf * 100)}%`).join('  |  ');
    b.hidden = false;
  }

  function updateGpsStatus() {
    const el = $('#gpsStatus');
    if (!el) return;
    const s = settings.geo ? Geo.status() : { state: 'off', text: 'GPS tagging is OFF (Settings)' };
    el.textContent = s.text; el.className = 'gps-status ' + s.state;
  }

  function updateLiveUI() {
    const btn = $('#liveBtn');
    btn.classList.toggle('stop', live.on);
    btn.classList.toggle('primary', !live.on);
    btn.innerHTML = live.on
      ? '<svg class="ic"><use href="#i-stop"/></svg> Stop Monitoring'
      : '<svg class="ic"><use href="#i-play"/></svg> Start Live Monitoring';
    $('.live-card').classList.toggle('on', live.on);
    $('#liveStatus').hidden = !live.on;
  }

  async function startLive() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Camera not available. Open this app over HTTPS or localhost.');
      return;
    }
    try {
      audio();
      if (settings.geo) {
        toast('Please allow location access');
        await Geo.current();
        Geo.start();
        updateGpsStatus();
      }
      live.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
      });
      const v = $('#liveVideo');
      v.srcObject = live.stream;
      await v.play();
      checkTorch();
      live.on = true; live.lastWarn = 0; live.lastSave = 0; live.hits = []; live.hideAt = 0; live.wasDamage = false; live.clear = 0;
      updateLiveUI();
      liveLoop();
    } catch (e) {
      toast('Camera permission denied or camera unavailable');
      stopLive();
    }
  }

  function stopLive() {
    live.on = false;
    torchOn = false;
    if (torchBtn) { torchBtn.hidden = true; torchBtn.style.outline = ''; }
    Geo.stop();
    clearTimeout(live.timer);
    if (live.stream) { live.stream.getTracks().forEach(t => t.stop()); live.stream = null; }
    const v = $('#liveVideo');
    if (v) v.srcObject = null;
    const ov = $('#liveOverlay');
    if (ov) ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
    const mb = $('#modeBadge'); if (mb) mb.textContent = '';
    hideDanger();
    if (alarm.on && alarm.sig === 'ok') stopAlarm(true);       // "all clear" voice ends with live monitoring
    updateLiveUI();
  }

  async function liveLoop() {
    if (!live.on) return;
    const v = $('#liveVideo');
    if (v.videoWidth) {
      const { cv, dets, night } = await analyze(v, v.videoWidth, v.videoHeight, 360, true);   // live: night mode allowed
      if (!live.on) return;
      const mb = $('#modeBadge'); if (mb) mb.textContent = night ? '\uD83C\uDF19 Night active' : '\u2600 Day active';
      updateGpsStatus();
      const ov = $('#liveOverlay');
      ov.width = v.videoWidth; ov.height = v.videoHeight;
      const cx = ov.getContext('2d');
      cx.clearRect(0, 0, ov.width, ov.height);
      drawBoxes(cx, ov.width, ov.height, dets);
      const st = $('#liveStatus');
      live.hits.push(dets.length > 0);
      if (live.hits.length > 3) live.hits.shift();
      const confirmed = live.hits.filter(Boolean).length >= 2;
      const now = Date.now();
      if (dets.length && confirmed) {
        st.textContent = verdictText(dets).replace(' detected', ' detected ahead');
        live.clear = 0;
        st.classList.add('alert');
        showDanger(dets);
        live.hideAt = now + 1500;
        live.wasDamage = true;
        warn(dets);
        if (settings.saveLive && now - live.lastSave > 8000) {
          live.lastSave = now;
          drawBoxes(cv.getContext('2d'), cv.width, cv.height, dets);
          addHistory('live', 'Live camera', dets, cv, settings.geo ? Geo.last() : null);
        }
      } else {
        st.textContent = dets.length ? 'Checking...' : OK_TXT;
        st.classList.remove('alert');
        if (!dets.length) live.clear++;
        if (!dets.length && live.clear >= 4) {
          if (alarm.on && alarm.sig !== 'ok') { stopAlarm(true); live.wasDamage = true; }
          // road is clear again after damage: "all clear" voice repeats (English + Hindi) until Stop is pressed
          if (!alarm.on && live.wasDamage) {
            live.wasDamage = false;
            warnOk(true);
          }
        }
        if (now > live.hideAt) hideDanger();
      }
    }
    live.timer = setTimeout(liveLoop, 500);
  }

  /* Auto / Day / Night buttons + torch */
  const modeBar = document.createElement('div');
  modeBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0';
  modeBar.innerHTML = '<button type="button" class="btn small ghost" data-m="auto">Auto</button>' +
    '<button type="button" class="btn small ghost" data-m="day">\u2600 Day</button>' +
    '<button type="button" class="btn small ghost" data-m="night">\uD83C\uDF19 Night</button>' +
    '<button type="button" id="torchBtn" class="btn small ghost" hidden>\uD83D\uDD26 Torch</button>' +
    '<span id="modeBadge" style="font-size:.8rem;opacity:.8"></span>';
  $('#rainBtn').parentNode.insertBefore(modeBar, $('#rainBtn'));
  torchBtn = $('#torchBtn');
  function paintModes() {
    $$('[data-m]', modeBar).forEach(b => { b.style.outline = b.dataset.m === settings.mode ? '2px solid #1de9d0' : ''; });
  }
  paintModes();
  $$('[data-m]', modeBar).forEach(b => b.addEventListener('click', () => {
    settings.mode = b.dataset.m; saveSettings(); paintModes();
    toast('Mode: ' + b.textContent.trim());
  }));
  function checkTorch() {
    const tr = live.stream && live.stream.getVideoTracks()[0];
    const caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
    torchBtn.hidden = !caps.torch;
  }
  torchBtn.addEventListener('click', async () => {
    try {
      torchOn = !torchOn;
      await live.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn }] });
      torchBtn.style.outline = torchOn ? '2px solid #ffb84d' : '';
    } catch (e) { torchOn = false; torchBtn.style.outline = ''; toast('Torch not supported'); }
  });

  $('#liveBtn').addEventListener('click', () => live.on ? stopLive() : startLive());
  $('#rainBtn').addEventListener('click', toggleRain);
  $('#liveReport').addEventListener('click', () => {
    const e = history.find(x => (x.potholes || 0) + (x.cracks || 0) + (x.others || 0) > 0);
    if (!e) { toast('No damage found yet to report'); return; }
    if (window.RGReport) RGReport.open([e], 'single');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopLive(); });

  /* ---------- history ---------- */
  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';
    $('#historyEmpty').hidden = history.length > 0;
    $('#clearHistory').hidden = history.length === 0;
    history.forEach(e => {
      const el = document.createElement('div');
      el.className = 'item';
      const clean = !e.potholes && !e.cracks && !e.others;
      el.innerHTML = `<img alt="" src="${e.thumb}"><div class="info"><div class="t"></div><div class="d">${fmtDate(e.ts)} &middot; ${e.src === 'live' ? 'Live' : 'Photo'}${e.loc ? ` &middot; <a class="loc" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${e.loc.lat}&mlon=${e.loc.lng}#map=18/${e.loc.lat}/${e.loc.lng}">${e.loc.lat}, ${e.loc.lng}</a>` : ''}</div>
        <div class="chips">${clean ? '<span class="chip sev">No damage</span>' : chipsFor(e)}</div></div>
        <button class="icon-btn" title="Delete" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button>`;
      $('.t', el).textContent = e.name;
      if (!clean) {
        const rb = document.createElement('button');
        rb.type = 'button'; rb.className = 'btn small ghost rp-btn';
        rb.innerHTML = '<svg class="ic"><use href="#i-send"/></svg> Report to authority';
        rb.addEventListener('click', () => { if (window.RGReport) RGReport.open([e], 'single'); });
        $('.info', el).appendChild(rb);
      }
      $('.icon-btn', el).addEventListener('click', () => {
        history = history.filter(x => x.id !== e.id);
        saveHistory(); renderHistory(); renderStats();
        toast('Deleted');
      });
      list.appendChild(el);
    });
  }
  function clearAllHistory() {
    if (!history.length) { toast('History is already empty'); return; }
    if (!confirm('Delete all detection history? This cannot be undone.')) return;
    history = []; saveHistory(); renderHistory(); renderStats();
    toast('History cleared');
  }
  $('#clearHistory').addEventListener('click', clearAllHistory);
  $('#clearHistory2').addEventListener('click', clearAllHistory);

  /* ---------- settings ---------- */
  function bindSettings() {
    const map = [['#setWarn', 'warn'], ['#setBeep', 'beep'], ['#setVoice', 'voice'], ['#setSaveLive', 'saveLive'], ['#setGeo', 'geo'], ['#setRain', 'rain']];
    map.forEach(([sel, key]) => {
      const el = $(sel);
      el.checked = !!settings[key];
      el.addEventListener('change', () => { settings[key] = el.checked; saveSettings(); updateWarnUI(); if (key === 'warn' && el.checked) audio(); });
    });
    const sel = [['#setLang', 'lang'], ['#setRoi', 'roi'], ['#setEngine', 'engine'], ['#setGalleryLoc', 'galleryLoc']];
    sel.forEach(([s, key]) => {
      const el = $(s);
      el.value = settings[key];
      el.addEventListener('change', () => { settings[key] = el.value; saveSettings(); if (key === 'engine') updateEngineStatus(); });
    });
    const rng = [['#setSens', 'sens', '#outSens'], ['#setConf', 'minConf', '#outConf']];
    rng.forEach(([s, key, out]) => {
      const el = $(s);
      el.value = settings[key]; $(out).textContent = settings[key] + '%';
      el.addEventListener('input', () => { settings[key] = +el.value; $(out).textContent = el.value + '%'; saveSettings(); });
    });
    updateWarnUI();
  }

  /* Cloudinary settings card (added to the Settings tab by code, no HTML change needed) */
  function setupCloudSettings() {
    const host = $('#view-settings');
    if (!host) return;
    const card = document.createElement('div');
    card.className = 'card';
    const inStyle = 'width:100%;margin:6px 0;padding:10px;border-radius:8px;border:1px solid #3a4a63;background:#0b1a30;color:#e8f0ff;font-size:1rem;box-sizing:border-box';
    card.innerHTML = '<h4>Image links (Cloudinary)</h4>' +
      '<p class="muted">Damage photos are uploaded here so the report gets a permanent Image Link. Leave empty to skip upload.</p>' +
      '<input id="setCloudName" type="text" placeholder="Cloud name" autocomplete="off" style="' + inStyle + '">' +
      '<input id="setCloudPreset" type="text" placeholder="Unsigned upload preset" autocomplete="off" style="' + inStyle + '">' +
      '<small class="hint" id="cloudState"></small>';
    host.appendChild(card);
    const n = $('#setCloudName'), p = $('#setCloudPreset');
    const paint = () => {
      n.value = settings.cloudName || ''; p.value = settings.cloudPreset || '';
      const done = history.filter(e => e.url).length;
      $('#cloudState').textContent = cloudOn() ? 'Upload is ON (' + done + ' photos uploaded)' : 'Upload is OFF (fill both fields to turn it on)';
    };
    const store = () => { settings.cloudName = n.value.trim(); settings.cloudPreset = p.value.trim(); saveSettings(); paint(); };
    n.addEventListener('change', () => { store(); syncUploads(); });
    p.addEventListener('change', () => { store(); syncUploads(); });
    setupCloudSettings.paint = paint;
    paint();
  }

  $('#testWarn').addEventListener('click', () => { audio(); warn([{ type: 'pothole', wet: true }, { type: 'crack' }], true); });
  $('#stopAlarm').addEventListener('click', () => stopAlarm());
  $('#resetSettings').addEventListener('click', () => {
    settings = Object.assign({}, DEFAULTS, { cloudName: settings.cloudName, cloudPreset: settings.cloudPreset });   // keep Cloudinary details
    saveSettings();
    bindSettingsValues(); paintModes(); toast('Settings reset');
  });
  function bindSettingsValues() {
    $('#setWarn').checked = settings.warn; $('#setBeep').checked = settings.beep;
    $('#setVoice').checked = settings.voice; $('#setSaveLive').checked = settings.saveLive; $('#setGeo').checked = settings.geo; $('#setEngine').value = settings.engine; $('#setGalleryLoc').value = settings.galleryLoc;
    $('#setLang').value = settings.lang; $('#setRoi').value = settings.roi;
    $('#setSens').value = settings.sens; $('#outSens').textContent = settings.sens + '%';
    $('#setConf').value = settings.minConf; $('#outConf').textContent = settings.minConf + '%';
    updateWarnUI();
  }

  /* ---------- detection engine status ---------- */
  function updateEngineStatus() {
    const el = $('#engineStatus');
    if (!el) return;
    el.textContent = settings.engine === 'rules' ? 'Rules engine (forced)' : (window.RoadModel ? RoadModel.status : 'Rules engine');
  }
  $('#modelPick').addEventListener('click', () => $('#modelFile').click());
  $('#modelFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    toast('Loading model...');
    try { await RoadModel.useFile(f); toast('Trained model loaded'); }
    catch (err) { toast('Could not load model (needs internet once for the runtime)'); }
    updateEngineStatus();
  });
  $('#modelRemove').addEventListener('click', async () => { await RoadModel.remove(); updateEngineStatus(); toast('Model removed'); });
  window.RG = { history: () => history, toast, fmtDate, nameOf, syncUploads };

  /* ---------- init ---------- */
  bindSettings();
  setupCloudSettings();
  if (window.RoadModel) RoadModel.init().then(updateEngineStatus); else updateEngineStatus();
  renderStats();
  updateLiveUI();
  syncUploads();                                               // upload older damage photos that have no link yet
  window.addEventListener('online', syncUploads);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
