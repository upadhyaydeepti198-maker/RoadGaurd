/*
 * RoadGuard AI - GPS helper
 * Gives every detection a location so damage can be mapped, exported and reported.
 * Location stays on the device (localStorage); nothing is uploaded anywhere.
 * Place names come from OpenStreetMap Nominatim (only the coordinates are sent).
 */
(function (root) {
  'use strict';
  const G = { fix: null, watchId: null, err: 0 };
  const conv = p => ({
    lat: +p.coords.latitude.toFixed(6),
    lng: +p.coords.longitude.toFixed(6),
    acc: Math.round(p.coords.accuracy || 0),
    ts: Date.now()
  });

  G.supported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // last known fix, only if it is fresh (< 60 s)
  G.last = () => (G.fix && Date.now() - G.fix.ts < 60000 ? { lat: G.fix.lat, lng: G.fix.lng, acc: G.fix.acc } : null);

  // permission state: 'granted' | 'prompt' | 'denied' | 'unknown'
  const permState = () => {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        return navigator.permissions.query({ name: 'geolocation' }).then(s => s.state, () => 'unknown');
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve('unknown');
  };

  // one-shot fix (used for photos).
  G.current = (timeout = 4000) => new Promise(res => {
    if (!G.supported()) return res(null);
    let done = false, timer = null;
    const fin = v => { if (!done) { done = true; clearTimeout(timer); res(v); } };
    permState().then(state => {
      if (state === 'denied') { G.err = 1; return fin(G.last()); }
      const browserTimeout = state === 'granted' ? timeout : 60000;
      timer = setTimeout(() => fin(G.last()), browserTimeout + 4000);
      try {
        navigator.geolocation.getCurrentPosition(
          p => { G.fix = conv(p); G.err = 0; fin(G.last()); },
          e => { G.err = e && e.code || 0; fin(G.last()); },
          { enableHighAccuracy: true, timeout: browserTimeout, maximumAge: 15000 }
        );
      } catch (e) { fin(null); }
    });
  });

  // human-readable state for the live screen
  G.status = () => {
    if (!G.supported()) return { state: 'off', text: 'GPS not supported on this device' };
    if (G.err === 1) return { state: 'denied', text: 'Location blocked - allow it in the browser (lock icon) and reload' };
    const f = G.last();
    if (f) return { state: 'ok', text: 'GPS ' + f.lat + ', ' + f.lng + (f.acc ? ' (\u00b1' + f.acc + ' m)' : '') };
    return { state: 'wait', text: 'GPS searching for location...' };
  };

  // continuous tracking (used in live monitoring)
  G.start = () => {
    if (!G.supported() || G.watchId != null) return;
    try {
      G.watchId = navigator.geolocation.watchPosition(p => { G.fix = conv(p); G.err = 0; }, e => { G.err = e && e.code || 0; },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    } catch (e) { G.watchId = null; }
  };
  G.stop = () => {
    if (G.watchId != null) { try { navigator.geolocation.clearWatch(G.watchId); } catch (e) {} }
    G.watchId = null;
  };

  // ---- place name from coordinates (OpenStreetMap Nominatim), cached on device ----
  const PK = 'rg.placeNames';
  const pcache = (() => { try { return JSON.parse(localStorage.getItem(PK)) || {}; } catch (e) { return {}; } })();
  const pkey = (la, ln) => (+la).toFixed(4) + ',' + (+ln).toFixed(4); // ~11 m, nearby points share one lookup
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let pq = Promise.resolve(); // queue: Nominatim allows 1 request/second

  // instant, no network: returns '' if not looked up yet
  G.cachedPlace = (la, ln) => pcache[pkey(la, ln)] || '';

  // returns Promise<string>; '' if offline or not found
  G.place = (la, ln) => {
    if (!isFinite(la) || !isFinite(ln)) return Promise.resolve('');
    const key = pkey(la, ln);
    if (pcache[key]) return Promise.resolve(pcache[key]);
    const job = pq.then(async () => {
      if (pcache[key]) return pcache[key];
      try {
        const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=en&lat=' + la + '&lon=' + ln);
        if (!r.ok) return '';
        const a = (await r.json()).address || {};
        const n = [a.road, a.neighbourhood || a.suburb, a.city || a.town || a.village || a.state_district]
          .filter((x, i, arr) => x && arr.indexOf(x) === i).join(', ');
        if (n) { pcache[key] = n; try { localStorage.setItem(PK, JSON.stringify(pcache)); } catch (e) {} }
        await sleep(1100);
        return n;
      } catch (e) { return ''; }
    });
    pq = job.catch(() => {});
    return job;
  };

  root.Geo = G;
})(typeof window !== 'undefined' ? window : this);