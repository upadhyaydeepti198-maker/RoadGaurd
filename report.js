/*
 * RoadGuard AI - "Report to authority"
 * Builds a ready complaint (message + photo + map link) for Nagar Nigam / PWD / any authority and
 * sends it through the phone's share sheet, WhatsApp, e-mail or a printable PDF.
 * Authority contact details are kept only on this device (localStorage). Nothing is uploaded by the app.
 */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  if (!$('#rpModal')) return;

  const LSK = 'rg.authority';
  const FIELDS = [['rpAuth', 'auth'], ['rpEmail', 'email'], ['rpPhone', 'phone'], ['rpName', 'name']];
  const load = () => { try { return JSON.parse(localStorage.getItem(LSK)) || {}; } catch (e) { return {}; } };
  const save = o => { try { localStorage.setItem(LSK, JSON.stringify(o)); } catch (e) { /* ignore */ } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = n => (n === 1 ? '' : 's');
  const gmaps = (la, ln) => 'https://maps.google.com/?q=' + la + ',' + ln;
  const toast = m => { if (window.RG && window.RG.toast) window.RG.toast(m); };
  const val = id => ($('#' + id) ? $('#' + id).value.trim() : '');
  const st = { entries: [], mode: 'single', photoUrl: null };

  function damageLine(e) {
    const wet = e.wetPot || 0, hid = e.waterPot || 0;
    const dry = Math.max(0, (e.potholes || 0) - wet - hid);
    const p = [];
    if (dry) p.push(dry + ' pothole' + plural(dry));
    if (wet) p.push(wet + ' water-filled pothole' + plural(wet));
    if (hid) p.push(hid + ' pothole' + plural(hid) + ' hidden under water');
    if (e.cracks) p.push(e.cracks + ' crack' + plural(e.cracks));
    if (e.others) p.push(e.others + ' other damage');
    return p.join(', ') || 'road damage';
  }

  function buildText(f) {
    const E = st.entries, L = [];
    L.push('ROAD DAMAGE COMPLAINT / सड़क की खराबी की शिकायत');
    if (f.auth) L.push('To: ' + f.auth);
    L.push('');
    if (st.mode === 'hotspots') {
      L.push('Priority locations (most serious first):');
      E.forEach((g, i) => L.push((i + 1) + '. ' + g.pot + ' pothole' + plural(g.pot) + ', ' + g.crk + ' crack' + plural(g.crk) + ', ' + g.oth +
        ' other, seen in ' + g.n + ' scan' + plural(g.n) + ' - ' + gmaps(g.lat, g.lng)));
    } else if (E[0]) {
      const e = E[0];
      L.push('Damage: ' + damageLine(e));
      if (e.severity && e.severity !== 'none') L.push('Severity: ' + e.severity.toUpperCase());
      L.push('Detected on: ' + new Date(e.ts).toLocaleString());
      if (e.loc && isFinite(e.loc.lat) && isFinite(e.loc.lng)) L.push('Location: ' + e.loc.lat + ', ' + e.loc.lng + ' - ' + gmaps(e.loc.lat, e.loc.lng));
      else L.push('Location: (GPS not available - see landmark)');
    }
    if (f.land) L.push('Landmark: ' + f.land);
    if (f.note) L.push('Note: ' + f.note);
    L.push('');
    L.push('Request: Please inspect this spot and repair it as soon as possible. Water-filled potholes and open manholes are a serious risk for two-wheelers and pedestrians, especially in rain.');
    L.push('कृपया इस जगह का निरीक्षण करके जल्द से जल्द मरम्मत करवाएं। बारिश में पानी भरे गड्ढे और खुले गटर दोपहिया वाहनों और पैदल चलने वालों के लिए बहुत खतरनाक हैं।');
    L.push('');
    L.push('Reported via RoadGuard AI (automatic image analysis, please verify on site).');
    if (f.name) L.push('Reporter: ' + f.name);
    return L.join('\n');
  }

  const fields = () => ({ auth: val('rpAuth'), email: val('rpEmail'), phone: val('rpPhone'), name: val('rpName'), land: val('rpLand'), note: val('rpNote') });
  const refreshText = () => { $('#rpText').value = buildText(fields()); };

  function open(entries, mode, canvas) {
    st.entries = entries || [];
    st.mode = mode || 'single';
    st.photoUrl = null;
    const first = st.entries[0];
    if (st.mode === 'single' && first) {
      if (canvas) { try { st.photoUrl = canvas.toDataURL('image/jpeg', 0.85); } catch (e) { /* ignore */ } }
      if (!st.photoUrl && first.thumb) st.photoUrl = first.thumb;
    }
    const saved = load();
    FIELDS.forEach(([id, k]) => { $('#' + id).value = saved[k] || ''; });
    $('#rpLand').value = ''; $('#rpNote').value = '';
    const img = $('#rpPhoto');
    if (st.photoUrl) { img.src = st.photoUrl; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }
    $('#rpPhotoBtn').hidden = !st.photoUrl;
    $('#rpTitle').textContent = st.mode === 'hotspots' ? 'Complaint for top hotspots' : 'Report to authority';
    const noGps = st.mode === 'single' && first && !(first.loc && isFinite(first.loc.lat));
    $('#rpHint').textContent = (noGps ? 'No GPS location was saved for this photo, so add a landmark. ' : '') +
      'WhatsApp and Email links send the text only. To send the photo too, press Share and pick WhatsApp or Gmail, or save the photo and attach it. Authority details are saved on this device.';
    refreshText();
    $('#rpModal').hidden = false;
    document.body.classList.add('modal-open');
  }

  function close() { $('#rpModal').hidden = true; document.body.classList.remove('modal-open'); }

  async function share() {
    const data = { title: 'Road damage complaint', text: $('#rpText').value };
    try {
      if (st.photoUrl) {
        const blob = await (await fetch(st.photoUrl)).blob();
        const file = new File([blob], 'road-damage.jpg', { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
      }
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    await copy();
    toast('Sharing is not supported here. Message copied, paste it in your app');
  }

  const waNumber = p => { let d = String(p || '').replace(/\D/g, '').replace(/^0+/, ''); if (d.length === 10) d = '91' + d; return d; };
  function whatsapp() {
    window.open('https://wa.me/' + waNumber(val('rpPhone')) + '?text=' + encodeURIComponent($('#rpText').value), '_blank');
  }
  function email() {
    const f = fields();
    const subject = 'Road damage complaint' + (f.land ? ' - ' + f.land : '');
    location.href = 'mailto:' + f.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent($('#rpText').value);
  }
  async function copy() {
    const t = $('#rpText');
    try { await navigator.clipboard.writeText(t.value); toast('Message copied'); }
    catch (e) { t.select(); try { document.execCommand('copy'); toast('Message copied'); } catch (e2) { toast('Select the text and copy it'); } }
  }
  function savePhoto() {
    if (!st.photoUrl) return;
    const a = document.createElement('a');
    a.href = st.photoUrl; a.download = 'road-damage-' + new Date().toISOString().slice(0, 10) + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  }
  function printReport() {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to open the report'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Road damage complaint</title>' +
      '<style>body{font-family:system-ui,Arial,sans-serif;margin:28px;color:#111;max-width:760px}img{max-width:100%;max-height:420px;border:1px solid #bbb;margin:12px 0}pre{white-space:pre-wrap;font:inherit;line-height:1.5}</style></head><body>' +
      (st.photoUrl ? '<img src="' + st.photoUrl + '" alt="">' : '') + '<pre>' + esc($('#rpText').value) + '</pre></body></html>');
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* user can print manually */ } }, 400);
  }

  FIELDS.forEach(([id, k]) => $('#' + id).addEventListener('input', () => { const o = load(); o[k] = $('#' + id).value.trim(); save(o); refreshText(); }));
  ['rpLand', 'rpNote'].forEach(id => $('#' + id).addEventListener('input', refreshText));
  $('#rpClose').addEventListener('click', close);
  $('#rpModal').addEventListener('click', e => { if (e.target === $('#rpModal')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#rpModal').hidden) close(); });
  $('#rpShare').addEventListener('click', share);
  $('#rpWa').addEventListener('click', whatsapp);
  $('#rpMail').addEventListener('click', email);
  $('#rpCopy').addEventListener('click', copy);
  $('#rpPhotoBtn').addEventListener('click', savePhoto);
  $('#rpPrint').addEventListener('click', printReport);

  window.RGReport = { open, close, buildText, _waNumber: waNumber };
})();
