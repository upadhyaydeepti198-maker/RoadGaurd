/*
 * RoadGuard AI - reads the GPS position stored inside a JPEG photo (EXIF).
 * Phone cameras save the place where the photo was TAKEN, so a photo clicked at home or on a
 * road shows that exact spot, even if you scan it later from the gallery.
 * Note: WhatsApp / social apps remove this data; send as "Document" or copy the file by cable.
 */
(function (root) {
  'use strict';

  function rational(dv, off, little) {
    const n = dv.getUint32(off, little), d = dv.getUint32(off + 4, little);
    return d ? n / d : 0;
  }

  function readGps(buf) {
    const dv = new DataView(buf);
    if (dv.byteLength < 12 || dv.getUint16(0) !== 0xFFD8) return null;          // not a JPEG
    let p = 2;
    while (p + 4 < dv.byteLength) {
      if (dv.getUint8(p) !== 0xFF) return null;
      const marker = dv.getUint8(p + 1), len = dv.getUint16(p + 2);
      if (marker === 0xE1 && dv.getUint32(p + 4) === 0x45786966) {               // "Exif"
        const t = p + 10;                                                        // TIFF header
        const little = dv.getUint16(t) === 0x4949;
        const u16 = o => dv.getUint16(o, little), u32 = o => dv.getUint32(o, little);
        const ifd0 = t + u32(t + 4);
        let gps = 0;
        const n0 = u16(ifd0);
        for (let i = 0; i < n0; i++) {
          const e = ifd0 + 2 + i * 12;
          if (u16(e) === 0x8825) gps = t + u32(e + 8);
        }
        if (!gps) return null;
        const n = u16(gps);
        let latRef = 'N', lngRef = 'E', lat = null, lng = null;
        const dms = e => {
          const o = t + u32(e + 8);
          return rational(dv, o, little) + rational(dv, o + 8, little) / 60 + rational(dv, o + 16, little) / 3600;
        };
        for (let i = 0; i < n; i++) {
          const e = gps + 2 + i * 12, tag = u16(e);
          if (tag === 1) latRef = String.fromCharCode(dv.getUint8(e + 8));
          else if (tag === 3) lngRef = String.fromCharCode(dv.getUint8(e + 8));
          else if (tag === 2) lat = dms(e);
          else if (tag === 4) lng = dms(e);
        }
        if (lat == null || lng == null || (lat === 0 && lng === 0)) return null;
        if (latRef === 'S') lat = -lat;
        if (lngRef === 'W') lng = -lng;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
        return { lat: +lat.toFixed(6), lng: +lng.toFixed(6), acc: 0, src: 'exif' };
      }
      p += 2 + len;
    }
    return null;
  }

  async function read(file) {
    try {
      if (!/jpe?g/i.test(file.type || file.name)) return null;
      return readGps(await file.slice(0, 262144).arrayBuffer());
    } catch (e) { return null; }
  }

  root.ExifGPS = { read, _parse: readGps };
})(typeof window !== 'undefined' ? window : this);
