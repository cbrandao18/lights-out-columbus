/* Collision Log: a field front-end for the Lights Out Columbus v2.0 Survey123 layer. */
(function () {
  "use strict";

  // ---- Config -------------------------------------------------------------
  var LIVE_LAYER = "https://services6.arcgis.com/tuxY7TQIaDhLWARO/arcgis/rest/services/service_a0bd32db2eb9405aac5082db25de5724/FeatureServer/0";
  var params = new URLSearchParams(location.search);
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // A different layer can only be set when testing on this computer.
  var LAYER = (isLocal && params.get("layer")) || LIVE_LAYER;
  var DEFAULT_CENTER = [39.9625, -83.0007]; // downtown Columbus
  var MAX_EDGE = 2560;                      // longest photo side after conversion, in px
  var JPEG_QUALITY = 0.85;
  var CODED = ["found_as", "species_common_name", "building_name_and_address", "which_side_of_the_building_was", "percent_glass_on_building_facad"];
  var TEXT = ["random_int", "species_common_name_other", "building_name_and_address_other", "names", "notes"];

  // ---- Small helpers ------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowTime(d) { d = d || new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- IndexedDB ----------------------------------------------------------
  var dbp = new Promise(function (res, rej) {
    var r = indexedDB.open("collision-log", 1);
    r.onupgradeneeded = function () {
      var db = r.result;
      db.createObjectStore("records", { keyPath: "id" });
      var p = db.createObjectStore("photos", { keyPath: "id" });
      p.createIndex("recId", "recId");
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
  function tx(storeName, mode, fn) {
    return dbp.then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(storeName, mode), s = t.objectStore(storeName), out;
        var req = fn(s);
        if (req) req.onsuccess = function () { out = req.result; };
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
      });
    });
  }
  var DB = {
    allRecords: function () { return tx("records", "readonly", function (s) { return s.getAll(); }); },
    getRecord: function (id) { return tx("records", "readonly", function (s) { return s.get(id); }); },
    putRecord: function (r) { r.updated = Date.now(); return tx("records", "readwrite", function (s) { return s.put(r); }); },
    delRecord: function (id) { return tx("records", "readwrite", function (s) { return s.delete(id); }); },
    photosFor: function (recId) { return tx("photos", "readonly", function (s) { return s.index("recId").getAll(recId); }); },
    putPhoto: function (p) { return tx("photos", "readwrite", function (s) { return s.put(p); }); },
    delPhoto: function (id) { return tx("photos", "readwrite", function (s) { return s.delete(id); }); }
  };

  // ---- Answer lists (live from the layer, with a bundled fallback) --------
  var domains = window.FALLBACK_DOMAINS;
  var domainSource = "bundled copy from 20 Oct 2026";
  try {
    var cached = JSON.parse(store("domains") || "null");
    if (cached && cached.lists && cached.lists.species_common_name) { domains = cached.lists; domainSource = "survey, checked " + new Date(cached.at).toLocaleDateString(); }
  } catch (e) { /* use fallback */ }
  function refreshDomains() {
    if (!navigator.onLine) return;
    fetch(LAYER + "?f=json").then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.fields) return;
      var lists = {};
      j.fields.forEach(function (f) {
        if (CODED.indexOf(f.name) >= 0 && f.domain && f.domain.codedValues) lists[f.name] = f.domain.codedValues.map(function (c) { return [String(c.code), c.name]; });
      });
      if (CODED.every(function (k) { return lists[k] && lists[k].length; })) {
        domains = lists; domainSource = "survey, checked " + new Date().toLocaleDateString();
        store("domains", JSON.stringify({ at: Date.now(), lists: lists }));
        $("domainsrc").textContent = "Answer lists: " + domainSource + ".";
      }
    }).catch(function () { /* offline or blocked: keep what we have */ });
  }
  function labelFor(field, code) {
    var hit = (domains[field] || []).find(function (c) { return c[0] === code; });
    return hit ? hit[1] : code;
  }

  // ---- State --------------------------------------------------------------
  var cur = null;        // record being edited
  var curPhotos = [];    // its photos
  var map = null, marker = null;

  function practice() { return store("practice") !== "off"; }

  function newRecord(base) {
    var r = {
      id: uuid(), globalid: "{" + uuid().toUpperCase() + "}", created: Date.now(), status: "draft",
      random_int: "", found_as: "", species_common_name: "", species_common_name_other: "",
      _date: todayStr(), time: nowTime(), building_name_and_address: "", building_name_and_address_other: "",
      which_side_of_the_building_was: "", percent_glass_on_building_facad: "",
      names: store("names") || "", notes: "", lat: null, lon: null, acc: null
    };
    if (base) {
      ["found_as", "species_common_name", "species_common_name_other", "_date", "building_name_and_address", "building_name_and_address_other",
        "which_side_of_the_building_was", "percent_glass_on_building_facad", "names", "lat", "lon", "acc"].forEach(function (k) { r[k] = base[k]; });
      r.time = nowTime();
    }
    return r;
  }
  function genId() { return String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)); }
  function locked() { return cur && (cur.status === "sent" || cur.status === "partial"); }

  // ---- Home list ----------------------------------------------------------
  function renderHome() {
    return DB.allRecords().then(function (all) {
      all.sort(function (a, b) { return b.updated - a.updated; });
      var box = $("records"); box.textContent = "";
      if (!all.length) {
        box.appendChild(el("div", { class: "empty", html: "No birds logged on this phone yet.<br>Tap <b>+ New bird</b> to start one." }));
      }
      all.forEach(function (r) {
        var st = r.status === "sent" ? (r.practice ? ["draft", "Practice"] : ["sent", "Sent"]) : r.status === "partial" ? ["partial", "Photos pending"] : ["draft", "Draft"];
        var sp = r.species_common_name === "other" ? (r.species_common_name_other || "Other") : (r.species_common_name ? labelFor("species_common_name", r.species_common_name) : "Species not set");
        var bld = r.building_name_and_address === "other" ? r.building_name_and_address_other : (r.building_name_and_address || "").split("/")[0];
        box.appendChild(el("button", { type: "button", class: "rec", onclick: function () { openRecord(r.id); } }, [
          el("span", { class: "id", text: r.random_int ? "#" + r.random_int : "No ID yet" }),
          el("span", { class: "pill " + st[0], text: st[1] }),
          el("span", { class: "meta", text: [sp, bld, r._date].filter(Boolean).join(" · ") })
        ]));
      });
      $("domainsrc").textContent = "Answer lists: " + domainSource + ".";
      renderPracticeToggle();
    });
  }
  function renderPracticeToggle() {
    var on = practice();
    var b = $("practiceBtn");
    if (!b) {
      b = el("button", { type: "button", id: "practiceBtn", class: "ghost" });
      b.addEventListener("click", function () { store("practice", practice() ? "off" : "on"); renderPracticeToggle(); updateNet(); });
      $("clearSent").parentNode.insertBefore(b, $("clearSent"));
    }
    b.textContent = on ? "Practice mode is on: tap to send for real" : "Sending for real: tap for practice mode";
  }

  // ---- Form widgets -------------------------------------------------------
  function renderSeg(field) {
    var box = $("seg_" + field); box.textContent = "";
    (domains[field] || []).forEach(function (c) {
      box.appendChild(el("button", { type: "button", "aria-pressed": String(cur[field] === c[0]), text: c[1], onclick: function () {
        if (locked()) return;
        cur[field] = cur[field] === c[0] ? "" : c[0]; renderSeg(field); save();
      } }));
    });
  }
  function renderPicker(field) {
    var box = $("pick_" + field), other = $(field + "_other");
    box.textContent = "";
    other.hidden = cur[field] !== "other";
    other.value = cur[field + "_other"] || "";
    other.disabled = locked();
    if (cur[field]) {
      var changeBtn = locked() ? null : el("button", { type: "button", class: "ghost", text: "Change", onclick: function () { cur[field] = ""; renderPicker(field); save(); var s = box.querySelector("input"); if (s) s.focus(); } });
      box.appendChild(el("div", { class: "picked" }, [el("span", { text: labelFor(field, cur[field]) }), changeBtn]));
      return;
    }
    if (!locked()) { var qc = quickChips(field); if (qc) box.appendChild(qc); }
    var input = el("input", { type: "search", class: "search", placeholder: field === "species_common_name" ? "Search species, or type other" : "Search building or street", autocomplete: "off", id: "q_" + field });
    var opts = el("div", { class: "opts" });
    function draw() {
      var q = input.value.trim().toLowerCase();
      opts.textContent = "";
      var list = domains[field] || [];
      var hits = q ? list.filter(function (c) { return c[1].toLowerCase().indexOf(q) >= 0; }) : list;
      // Words that start with the query rank first.
      if (q) hits.sort(function (a, b) {
        var sa = (" " + a[1].toLowerCase()).indexOf(" " + q) >= 0 ? 0 : 1, sb = (" " + b[1].toLowerCase()).indexOf(" " + q) >= 0 ? 0 : 1;
        return sa - sb;
      });
      var otherOpt = list.find(function (c) { return c[0] === "other"; });
      if (otherOpt && hits.indexOf(otherOpt) < 0) hits.push(otherOpt);
      hits.slice(0, 60).forEach(function (c) {
        var lab = esc(c[1]);
        if (q) { var i = c[1].toLowerCase().indexOf(q); if (i >= 0) lab = esc(c[1].slice(0, i)) + "<mark>" + esc(c[1].slice(i, i + q.length)) + "</mark>" + esc(c[1].slice(i + q.length)); }
        opts.appendChild(el("button", { type: "button", html: lab, onclick: function () {
          cur[field] = c[0]; remember(field, c[0]);
          if (field === "building_name_and_address") $("bldSuggest").hidden = true;
          if (c[0] === "other" && q && !cur[field + "_other"]) cur[field + "_other"] = input.value.trim();
          renderPicker(field); save();
          if (c[0] === "other") other.focus();
        } }));
      });
    }
    input.addEventListener("input", draw);
    box.appendChild(input); box.appendChild(opts);
    draw();
  }

  function fillForm() {
    TEXT.forEach(function (k) { $(k).value = cur[k] || ""; });
    $("_date").value = cur._date || ""; $("time").value = cur.time || "";
    ["found_as", "which_side_of_the_building_was", "percent_glass_on_building_facad"].forEach(renderSeg);
    ["species_common_name", "building_name_and_address"].forEach(renderPicker);
    var lock = locked();
    ["random_int", "names", "notes", "_date", "time", "genId", "gps", "pickLib", "pickCam"].forEach(function (k) { $(k).disabled = lock; });
    $("reviewBtn").textContent = cur.status === "partial" ? "Retry photos" : lock ? "Already sent" : "Review & send";
    $("reviewBtn").disabled = cur.status === "sent";
    $("delBtn").textContent = lock ? "Remove from this phone" : "Delete this record";
    $("bldSuggest").hidden = true; $("compassBtn").disabled = lock; $("timeNow").disabled = lock;
    renderLocation(); renderPhotos();
  }

  // ---- Location -----------------------------------------------------------
  function ensureMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView(DEFAULT_CENTER, 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    map.on("click", function (e) { if (locked()) return; setLoc(e.latlng.lat, e.latlng.lng, null); });
  }
  function setLoc(lat, lon, acc) {
    cur.lat = +lat.toFixed(7); cur.lon = +lon.toFixed(7); cur.acc = acc; renderLocation(true); save();
  }
  function renderLocation(pan) {
    ensureMap();
    var c = $("coords");
    if (cur.lat == null) {
      c.textContent = "No location yet. Tap the button, or tap the map to drop a pin.";
      if (marker && map) { map.removeLayer(marker); marker = null; }
      if (map) map.setView(DEFAULT_CENTER, 15);
    } else {
      c.textContent = cur.lat.toFixed(6) + ", " + cur.lon.toFixed(6) + (cur.acc ? "  ±" + Math.round(cur.acc) + " m" : "  (pin placed by hand)");
      if (map) {
        if (!marker) {
          marker = L.marker([cur.lat, cur.lon], { draggable: !locked() }).addTo(map);
          marker.on("dragend", function () { var p = marker.getLatLng(); setLoc(p.lat, p.lng, null); });
        } else marker.setLatLng([cur.lat, cur.lon]);
        if (pan !== false) map.setView([cur.lat, cur.lon], Math.max(map.getZoom(), 18));
      }
    }
    if (map) setTimeout(function () { map.invalidateSize(); }, 50);
  }
  function useGps() {
    if (!navigator.geolocation) { toast("This browser can't share location. Tap the map instead."); return; }
    var b = $("gps"); b.disabled = true; b.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(function (p) {
      b.disabled = false; b.textContent = "Use my current location";
      setLoc(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
      lookupBuilding(p.coords.latitude, p.coords.longitude);
    }, function (err) {
      b.disabled = false; b.textContent = "Use my current location";
      toast(err.code === 1 ? "Location is blocked. Allow it in Settings › Safari › Location, or tap the map." : "Couldn't get a fix. Try again or tap the map.");
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 });
  }

  // ---- Photos -------------------------------------------------------------
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return decodeImg(file); });
    }
    return decodeImg(file);
  }
  function decodeImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("unreadable")); };
      img.src = url;
    });
  }
  function toJpeg(file) {
    return decode(file).then(function (src) {
      var w = src.width, h = src.height, s = Math.min(1, MAX_EDGE / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      if (src.close) src.close();
      return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, "image/jpeg", JPEG_QUALITY); });
    }).catch(function (e) {
      // Already a JPEG/PNG the browser can't redraw: send it as is.
      if (/^image\/(jpeg|png)$/.test(file.type)) return file;
      throw e;
    });
  }
  // Tags printed from cards.html carry a QR code with the app link and ?id=NNNNNN.
  function idFromText(t) {
    t = String(t || "").trim();
    try { var u = new URL(t); var q = u.searchParams.get("id"); if (q && /^\d{4,10}$/.test(q)) return q; } catch (e) { /* not a link */ }
    return /^\d{4,10}$/.test(t) ? t : null;
  }
  function scanQr(blob) {
    if (!window.jsQR) return Promise.resolve(null);
    return decode(blob).then(function (src) {
      var s = Math.min(1, 1600 / Math.max(src.width, src.height));
      var c = document.createElement("canvas"); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
      var g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(src, 0, 0, c.width, c.height);
      var d = g.getImageData(0, 0, c.width, c.height);
      var hit = jsQR(d.data, c.width, c.height, { inversionAttempts: "dontInvert" });
      return hit ? idFromText(hit.data) : null;
    }).catch(function () { return null; });
  }
  function addFiles(files) {
    var list = Array.from(files || []);
    if (!list.length) return;
    toast("Adding " + list.length + " photo" + (list.length > 1 ? "s" : "") + "…");
    var n = curPhotos.length, failed = 0;
    list.reduce(function (p, f) {
      return p.then(function () {
        return toJpeg(f).then(function (blob) {
          if (cur.random_int) return blob;
          return scanQr(blob).then(function (id) {
            if (id && !cur.random_int) { cur.random_int = id; $("random_int").value = id; save(); toast("Read ID " + id + " from the tag in the photo."); }
            return blob;
          });
        }).then(function (blob) {
          n += 1;
          var base = (cur.random_int || "bird").replace(/[^\w-]/g, "");
          var ph = { id: uuid(), recId: cur.id, blob: blob, name: base + "_" + n + (blob.type === "image/png" ? ".png" : ".jpg"), type: blob.type || "image/jpeg", uploaded: false, added: Date.now() };
          curPhotos.push(ph);
          return DB.putPhoto(ph);
        }).catch(function () { failed += 1; });
      });
    }, Promise.resolve()).then(function () {
      renderPhotos();
      if (failed) toast(failed + " photo" + (failed > 1 ? "s" : "") + " couldn't be read. Try Choose photos › Photo Library.");
    });
  }
  function renderPhotos() {
    var box = $("photos"); box.textContent = "";
    (box._urls || []).forEach(URL.revokeObjectURL); box._urls = [];
    curPhotos.sort(function (a, b) { return a.added - b.added; }).forEach(function (ph) {
      var u = URL.createObjectURL(ph.blob); box._urls.push(u);
      var kids = [el("img", { src: u, alt: ph.name })];
      if (ph.uploaded) kids.push(el("span", { class: "st", text: "Sent" }));
      else if (cur.status === "partial") kids.push(el("span", { class: "st", text: "Not sent yet" }));
      if (!ph.uploaded) kids.push(el("button", { type: "button", class: "x", "aria-label": "Remove photo", text: "×", onclick: function () {
        curPhotos = curPhotos.filter(function (x) { return x !== ph; }); DB.delPhoto(ph.id).then(renderPhotos);
      } }));
      box.appendChild(el("div", { class: "ph" }, kids));
    });
  }

  // ---- Navigation ---------------------------------------------------------
  function show(view) {
    $("home").hidden = view !== "home"; $("edit").hidden = view !== "edit"; $("resources").hidden = view !== "res"; $("shift").hidden = view !== "shift";
    $("barHome").hidden = view !== "home"; $("barEdit").hidden = view !== "edit";
    document.querySelector(".bar").hidden = view === "res" || view === "shift";
    document.querySelector(".tabs").hidden = view === "edit";
    $("tabLog").setAttribute("aria-selected", String(view === "home"));
    $("tabRes").setAttribute("aria-selected", String(view === "res"));
    $("tabShift").setAttribute("aria-selected", String(view === "shift"));
    if (view === "shift") renderShift();
    if (view !== "edit") stopCompass();
    if (view !== "edit") store("tab", view);
    window.scrollTo(0, 0);
  }
  $("tabLog").addEventListener("click", function () { show("home"); });
  $("tabRes").addEventListener("click", function () { show("res"); });
  $("tabShift").addEventListener("click", function () { show("shift"); });
  // Keep one resource section open at a time so the list stays short.
  $("resources").addEventListener("toggle", function (e) {
    var d = e.target;
    if (d.tagName === "DETAILS" && d.open) document.querySelectorAll("#resources details").forEach(function (o) { if (o !== d) o.open = false; });
  }, true);
  function openRecord(id) {
    return Promise.all([DB.getRecord(id), DB.photosFor(id)]).then(function (r) {
      cur = r[0]; curPhotos = r[1] || []; show("edit"); fillForm();
    });
  }
  function startNew(base) {
    cur = newRecord(base); curPhotos = [];
    return DB.putRecord(cur).then(function () { show("edit"); fillForm(); if (!base) $("random_int").focus(); });
  }
  function save() { if (cur && !locked()) return DB.putRecord(cur); return Promise.resolve(); }
  function closeEdit() { return save().then(function () { cur = null; curPhotos = []; show("home"); return renderHome(); }); }

  // ---- Validation & payload ----------------------------------------------
  function problems(r) {
    var p = [];
    if (!String(r.random_int || "").trim()) p.push("Unique specimen ID");
    if (!r.found_as) p.push("Found as");
    if (!r.species_common_name) p.push("Species");
    if (r.species_common_name === "other" && !r.species_common_name_other.trim()) p.push("Species name (you picked Other)");
    if (r.building_name_and_address === "other" && !r.building_name_and_address_other.trim()) p.push("Building name (you picked Other)");
    if (!r._date) p.push("Date found");
    if (r.lat == null) p.push("Location");
    return p;
  }
  function dateValue(s) { var a = s.split("-").map(Number); return new Date(a[0], a[1] - 1, a[2], 12, 0, 0).getTime(); } // Survey123 stores picked dates at noon
  function attributes(r) {
    var a = {
      globalid: r.globalid,
      random_int: String(r.random_int).trim(),
      found_as: r.found_as || null,
      species_common_name: r.species_common_name || null,
      species_common_name_other: r.species_common_name === "other" ? r.species_common_name_other.trim() : null,
      _date: dateValue(r._date),
      time: r.time || null,
      building_name_and_address: r.building_name_and_address || null,
      building_name_and_address_other: r.building_name_and_address === "other" ? r.building_name_and_address_other.trim() : null,
      which_side_of_the_building_was: r.which_side_of_the_building_was || null,
      percent_glass_on_building_facad: r.percent_glass_on_building_facad || null,
      names: (r.names || "").trim() || null,
      notes: (r.notes || "").trim() || null
    };
    return a;
  }
  function feature(r) { return { geometry: { x: r.lon, y: r.lat, spatialReference: { wkid: 4326 } }, attributes: attributes(r) }; }

  // ---- Sending ------------------------------------------------------------
  function post(url, body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl && setTimeout(function () { ctl.abort(); }, ms || 60000);
    return fetch(url, { method: "POST", body: body, signal: ctl && ctl.signal }).then(function (r) {
      return r.text().then(function (txt) {
        var j; try { j = JSON.parse(txt); } catch (e) { throw new Error("Unexpected reply from the survey (HTTP " + r.status + ")"); }
        if (j.error) throw Object.assign(new Error(j.error.message + (j.error.details && j.error.details.length ? ": " + j.error.details.join(" ") : "")), { code: j.error.code });
        return j;
      });
    }).catch(function (e) {
      if (e.name === "AbortError") throw new Error("Timed out. Check signal and try again.");
      if (e instanceof TypeError) throw new Error("Couldn't reach the survey. Check signal and try again.");
      throw e;
    }).finally(function () { if (t) clearTimeout(t); });
  }
  function sendFeature(r, log) {
    if (r.remote && r.remote.objectId) return Promise.resolve(r.remote);
    log("Sending bird #" + r.random_int + "…");
    var body = new URLSearchParams();
    body.set("f", "json");
    body.set("adds", JSON.stringify([feature(r)]));
    body.set("useGlobalIds", "true");
    body.set("rollbackOnFailure", "true");
    return post(LAYER + "/applyEdits", body).then(function (j) {
      var res = j.addResults && j.addResults[0];
      if (!res || !res.success) {
        var msg = res && res.error ? res.error.description : "The survey didn't accept the record.";
        throw new Error(msg);
      }
      r.remote = { objectId: res.objectId, globalId: res.globalId || r.globalid, at: Date.now() };
      log("Bird saved in the survey (record " + res.objectId + ").");
      return DB.putRecord(r).then(function () { return r.remote; });
    }).catch(function (e) {
      // Each record carries its own GlobalID, so a resend after a dropped reply is refused instead of duplicated.
      if (/duplicate|unique|already exist|primary key/i.test(e.message)) {
        throw new Error("The survey already has this exact record (an earlier send went through but the reply was lost). It was not entered twice. Photos for it need to go to the survey's admin.");
      }
      throw e;
    });
  }
  function sendPhoto(r, ph, i, total, log) {
    log("Uploading photo " + i + " of " + total + " (" + Math.round(ph.blob.size / 1024) + " KB)…");
    var fd = new FormData();
    fd.append("f", "json");
    fd.append("attachment", ph.blob, ph.name);
    return post(LAYER + "/" + r.remote.objectId + "/addAttachment", fd, 120000).then(function (j) {
      var res = j.addAttachmentResult;
      if (!res || !res.success) throw new Error((res && res.error && res.error.description) || "Photo was not accepted.");
      ph.uploaded = true; ph.attachmentId = res.objectId;
      log("Photo " + i + " uploaded.");
      return DB.putPhoto(ph);
    });
  }
  function sendAll(r, log) {
    if (practice()) return practiceSend(r, log);
    return sendFeature(r, log).then(function () {
      var todo = curPhotos.filter(function (p) { return !p.uploaded; });
      var failed = 0;
      return todo.reduce(function (p, ph, i) {
        return p.then(function () { return sendPhoto(r, ph, i + 1, todo.length, log).catch(function (e) { failed += 1; log("Photo " + (i + 1) + " failed: " + e.message); }); });
      }, Promise.resolve()).then(function () {
        r.status = failed ? "partial" : "sent";
        return DB.putRecord(r).then(function () { return failed; });
      });
    });
  }
  function practiceSend(r, log) {
    log("PRACTICE MODE: nothing is sent.");
    log("Would POST to " + LAYER + "/applyEdits:");
    log(JSON.stringify(feature(r), null, 1));
    curPhotos.forEach(function (ph, i) { log("Would upload photo " + (i + 1) + ": " + ph.name + " (" + Math.round(ph.blob.size / 1024) + " KB, " + ph.type + ")"); });
    return Promise.resolve(0);
  }

  // ---- Review sheet -------------------------------------------------------
  function closeSheet() { $("sheet").hidden = true; }
  function openReview() {
    save();
    var body = $("sheetBody"); body.textContent = "";
    if (cur.status !== "partial") {
      var p = problems(cur);
      if (p.length) {
        body.appendChild(el("h2", { text: "A few things are missing" }));
        body.appendChild(el("ul", {}, p.map(function (x) { return el("li", { text: x }); })));
        body.appendChild(el("button", { type: "button", class: "primary", text: "Back to the form", onclick: closeSheet }));
        $("sheet").hidden = false; return;
      }
    }
    var a = attributes(cur);
    var rows = [
      ["ID", a.random_int], ["Found as", a.found_as],
      ["Species", a.species_common_name === "other" ? a.species_common_name_other : labelFor("species_common_name", a.species_common_name)],
      ["When", cur._date + (a.time ? " " + a.time : "")],
      ["Building", a.building_name_and_address === "other" ? a.building_name_and_address_other : a.building_name_and_address || "—"],
      ["Side / glass", (a.which_side_of_the_building_was || "—") + " / " + (a.percent_glass_on_building_facad || "—")],
      ["Location", cur.lat.toFixed(5) + ", " + cur.lon.toFixed(5)],
      ["Photos", curPhotos.length ? curPhotos.length + (cur.status === "partial" ? " (" + curPhotos.filter(function (x) { return !x.uploaded; }).length + " still to send)" : "") : "None"],
      ["Name", a.names || "—"]
    ];
    body.appendChild(el("h2", { text: cur.status === "partial" ? "Finish sending photos" : practice() ? "Practice send" : "Send to Lights Out Columbus" }));
    body.appendChild(el("dl", { class: "summary" }, [].concat.apply([], rows.map(function (r) { return [el("dt", { text: r[0] }), el("dd", { text: r[1] })]; }))));
    if (!curPhotos.length) body.appendChild(el("p", { class: "hint", text: "No photos attached. You can still send." }));
    if (practice()) body.appendChild(el("p", { class: "hint", html: "<b>Practice mode is on.</b> This shows exactly what would be sent without sending it. Turn it off under <i>About this app</i> on the home screen." }));
    var log = el("div", { class: "log", hidden: "" });
    var go = el("button", { type: "button", class: "primary", text: practice() ? "Run practice send" : cur.status === "partial" ? "Retry photos" : "Send now" });
    var back = el("button", { type: "button", class: "ghost", text: "Not yet", onclick: closeSheet });
    var row = el("div", { class: "row" }, [back, go]);
    body.appendChild(log); body.appendChild(row);
    function write(s) { log.hidden = false; log.textContent += s + "\n"; log.scrollTop = log.scrollHeight; }
    go.addEventListener("click", function () {
      if (!practice() && !navigator.onLine) { write("You're offline. The record is saved on this phone; send it when you have signal."); return; }
      go.disabled = true; back.disabled = true;
      store("names", cur.names || "");
      var wasPractice = practice();
      sendAll(cur, write).then(function (failed) {
        back.disabled = false; back.textContent = "Close";
        if (wasPractice) { write("\nPractice run finished. The record is still a draft."); go.disabled = false; return; }
        if (failed) { write("\n" + failed + " photo(s) didn't upload. The bird is saved; tap Retry photos to send only those."); go.textContent = "Retry photos"; go.disabled = false; }
        else {
          write("\nAll done. Write #" + cur.random_int + " on the bag if you haven't.");
          row.textContent = "";
          row.appendChild(el("button", { type: "button", class: "ghost", text: "Back to list", onclick: function () { closeSheet(); closeEdit(); } }));
          row.appendChild(el("button", { type: "button", class: "primary", text: "Another bird here", onclick: function () { var base = cur; closeSheet(); closeEdit().then(function () { startNew(base); }); } }));
        }
        fillForm();
      }).catch(function (e) {
        write("Not sent: " + e.message);
        write("Nothing was lost. The record is saved on this phone.");
        go.disabled = false; back.disabled = false; go.textContent = "Try again";
      });
    });
    $("sheet").hidden = false;
  }

  // ---- Quick picks --------------------------------------------------------
  // Species often found at Columbus windows, shown until the volunteer builds up their own recents.
  var COMMON_SPECIES = ["White-throated Sparrow", "Ovenbird", "Common Yellowthroat", "Tennessee Warbler", "Nashville Warbler",
    "Magnolia Warbler", "Gray Catbird", "Ruby-crowned Kinglet", "Golden-crowned Kinglet", "Swainson's Thrush", "Dark-eyed Junco", "Brown Creeper"];
  function recents(field) { try { return JSON.parse(store("recent_" + field) || "[]"); } catch (e) { return []; } }
  function remember(field, code) {
    if (!code || code === "other") return;
    var r = recents(field).filter(function (c) { return c !== code; }); r.unshift(code); store("recent_" + field, JSON.stringify(r.slice(0, 8)));
  }
  function quickChips(field) {
    var codes = (domains[field] || []).map(function (c) { return c[0]; });
    var picks = recents(field).filter(function (c) { return codes.indexOf(c) >= 0; });
    var label = picks.length ? "Recent" : "";
    if (field === "species_common_name") {
      var seen = picks.slice();
      COMMON_SPECIES.forEach(function (c) { if (seen.length < 10 && codes.indexOf(c) >= 0 && seen.indexOf(c) < 0) seen.push(c); });
      if (!picks.length) label = "Common at Columbus windows";
      else if (seen.length > picks.length) label = "Recent and common";
      picks = seen;
    }
    if (!picks.length) return null;
    var box = el("div", { class: "chips" }, [el("span", { class: "lbl", text: label })]);
    picks.slice(0, 10).forEach(function (code) {
      var short = field === "building_name_and_address" ? labelFor(field, code).split("/")[0] : labelFor(field, code);
      box.appendChild(el("button", { type: "button", text: short, onclick: function () { pick(field, code); } }));
    });
    return box;
  }
  function pick(field, code) {
    cur[field] = code; remember(field, code);
    if (field === "building_name_and_address") $("bldSuggest").hidden = true;
    renderPicker(field); save();
  }

  // ---- Building from GPS --------------------------------------------------
  var DIRS = { east: "e", west: "w", north: "n", south: "s" };
  var SUFFIX = { street: "st", avenue: "ave", boulevard: "blvd", drive: "dr", square: "sq", place: "pl", road: "rd" };
  function normStreet(s) {
    var words = String(s || "").toLowerCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
    return words.map(function (w) { return DIRS[w] || SUFFIX[w] || w; })
      .filter(function (w) { return ["n", "s", "e", "w", "st", "ave", "blvd", "dr", "sq", "pl", "rd"].indexOf(w) < 0; }).join(" ");
  }
  function parseAddr(a) {
    var m = String(a || "").match(/^\s*(\d+)(?:-(\d+))?\s+(.*)$/);
    return m ? { num: +m[1], street: normStreet(m[3]) } : { num: null, street: normStreet(a) };
  }
  function suggestBuildings(rev) {
    var a = rev.address || {};
    var num = parseInt(a.house_number, 10), street = normStreet(a.road);
    var name = String(rev.name || a.amenity || a.building || a.office || a.shop || "").toLowerCase();
    var scored = [];
    (domains.building_name_and_address || []).forEach(function (c) {
      if (c[0] === "other") return;
      var parts = c[1].split("/"), bname = parts[0].toLowerCase(), addr = parseAddr(parts.slice(1).join("/"));
      var score = Infinity;
      if (name && name.length > 2 && (bname.indexOf(name) >= 0 || name.indexOf(bname) >= 0)) score = -1;
      else if (street && addr.street === street) score = isNaN(num) || addr.num == null ? 500 : Math.abs(addr.num - num);
      if (score < 400 || score === 500) scored.push([score, c[0]]);
    });
    scored.sort(function (x, y) { return x[0] - y[0]; });
    return scored.slice(0, 3).map(function (s) { return s[1]; });
  }
  function lookupBuilding(lat, lon) {
    if (!navigator.onLine || cur.building_name_and_address || locked()) return;
    var forId = cur.id;
    fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=" + lat + "&lon=" + lon, { headers: { "Accept-Language": "en" } })
      .then(function (r) { return r.json(); })
      .then(function (rev) {
        if (!cur || cur.id !== forId || cur.building_name_and_address) return;
        var hits = suggestBuildings(rev), box = $("bldSuggest");
        box.textContent = "";
        if (!hits.length) { box.hidden = true; return; }
        box.appendChild(el("span", { class: "lbl", text: "Near you" }));
        hits.forEach(function (code) { box.appendChild(el("button", { type: "button", text: labelFor("building_name_and_address", code), onclick: function () { pick("building_name_and_address", code); } })); });
        box.hidden = false;
      }).catch(function () { /* no suggestion; the list still works */ });
  }

  // ---- Compass ------------------------------------------------------------
  // The survey wants the direction the window faces, so we record the opposite of where the phone points.
  var SIDES = ["North", "East", "South", "West"];
  var cmp = { on: false, x: 0, y: 0, have: false, side: null, timer: null, evt: null };
  function onOrient(e) {
    var h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null);
    if (h == null) return;
    var r = h * Math.PI / 180;
    // Smooth the jittery magnetometer with a running average on the unit circle.
    cmp.x = cmp.have ? cmp.x * 0.8 + Math.cos(r) * 0.2 : Math.cos(r);
    cmp.y = cmp.have ? cmp.y * 0.8 + Math.sin(r) * 0.2 : Math.sin(r);
    cmp.have = true;
    var heading = (Math.atan2(cmp.y, cmp.x) * 180 / Math.PI + 360) % 360;
    var faces = (heading + 180) % 360;
    cmp.side = SIDES[Math.round(faces / 90) % 4];
    $("roseCard").setAttribute("transform", "rotate(" + (-heading).toFixed(1) + " 100 100)");
    $("compassDir").textContent = "Window faces " + cmp.side;
    $("compassDeg").textContent = "Phone points " + Math.round(heading) + "°, window faces " + Math.round(faces) + "°";
    $("compassSet").disabled = false; $("compassSet").textContent = "Use " + cmp.side;
  }
  function stopCompass() {
    if (cmp.evt) window.removeEventListener(cmp.evt, onOrient);
    cmp.on = false; cmp.have = false; cmp.evt = null; clearTimeout(cmp.timer);
    $("compass").hidden = true; $("compassBtn").hidden = false;
  }
  function startCompass() {
    if (locked()) return;
    $("compass").hidden = false; $("compassBtn").hidden = true;
    $("compassDir").textContent = "Waiting for compass…"; $("compassDeg").textContent = ""; $("compassSet").disabled = true; $("compassSet").textContent = "Use this";
    var begin = function () {
      cmp.evt = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
      window.addEventListener(cmp.evt, onOrient); cmp.on = true;
      cmp.timer = setTimeout(function () { if (!cmp.have) $("compassDir").textContent = "No compass reading. Pick a side above instead."; }, 4000);
    };
    var DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      DOE.requestPermission().then(function (s) {
        if (s === "granted") begin(); else $("compassDir").textContent = "Compass access was declined. Pick a side above instead.";
      }).catch(function () { $("compassDir").textContent = "Compass isn't available here. Pick a side above instead."; });
    } else if (DOE) begin();
    else $("compassDir").textContent = "This phone has no compass. Pick a side above instead.";
  }

  // ---- Shift checklist and Discord summary --------------------------------
  var ROUTES = {
    broad: { name: "Broad St. route", stops: [
      ["1", "CCAD"], ["2", "STRS, 275 E Broad"], ["3", "Midland (and courtyard), 250 E Broad"], ["4", "Hexion, 180 E Broad"],
      ["5", "Empire Building / Athletic Club, 136 E Broad"], ["6", "Chase and Lexi's on Third, 100 E Broad"], ["7", "Key Bank, 88 E Broad"],
      ["8", "Rhodes Tower, 30 E Broad"], ["9/10", "US Bank, 10 W Broad"], ["10", "8 on the Square, 8 E Broad"],
      ["11", "LeVeque Tower (and alley walkway), Palace Theater"], ["12", "Huntington Plaza / Gerlach CPA, 37 W Broad"],
      ["13", "41 S High (Huntington, Porter Wright, ZOUP!) and Wyandotte"], ["14", "Riffe Center, 77 S High"], ["15", "State House"],
      ["16", "Trinity Church, 125 E Broad"], ["17", "PNC, 155 E Broad"], ["18", "Columbus Club, 181 E Broad"],
      ["19", "Ohio Education Association, 225 E Broad"], ["20", "Catholic Foundation, 257 E Broad"], ["21/22", "STRS, 275 E Broad"],
      ["23/24", "Capital University, 303 E Broad"], ["25", "US Citizenship & Immigration, 395 E Broad"], ["26", "UMC Family Services, 413 E Broad"],
      ["28", "Encova Insurance, 471 E Broad"], ["29", "Columbus Museum of Art, 480 E Broad"]] },
    nationwide: { name: "Nationwide route", stops: [
      ["1", "Nationwide atrium"], ["2", "Nationwide Retirement Solutions"], ["3", "Columbia Gas"], ["4", "Sunny St Café / Athletic Club"],
      ["5", "McFerson Commons"], ["6", "Marconi Garage"], ["7", "Sensenbrenner Park"]] }
  };
  function shiftKey() { return "shift_" + todayStr(); }
  function getShift() {
    var s; try { s = JSON.parse(store(shiftKey()) || "null"); } catch (e) { s = null; }
    return s || { route: store("lastRoute") || "broad", start: null, end: null, checked: {} };
  }
  function putShift(s) { store(shiftKey(), JSON.stringify(s)); store("lastRoute", s.route); }
  function clock(ts) { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function renderShift() {
    var s = getShift();
    if (!ROUTES[s.route]) { s.route = Object.keys(ROUTES)[0]; }
    var route = ROUTES[s.route];
    var seg = $("routeSeg"); seg.textContent = "";
    Object.keys(ROUTES).forEach(function (k) {
      seg.appendChild(el("button", { type: "button", "aria-pressed": String(k === s.route), text: ROUTES[k].name.replace(" route", ""), onclick: function () {
        var n = getShift(); n.route = k; putShift(n); renderShift();
      } }));
    });
    var done = route.stops.filter(function (st) { return s.checked[s.route + ":" + st[0] + ":" + st[1]]; }).length;
    $("shiftBar").style.width = Math.round(100 * done / route.stops.length) + "%";
    $("checklistTitle").textContent = "Stop checklist" + (done ? " (" + done + " of " + route.stops.length + ")" : " (optional)");
    $("shiftStart").hidden = !!s.start; $("shiftEnd").hidden = !s.start || !!s.end;
    var list = $("stops"); list.textContent = "";
    route.stops.forEach(function (st) {
      var key = s.route + ":" + st[0] + ":" + st[1], on = !!s.checked[key];
      list.appendChild(el("button", { type: "button", class: "stop", "aria-pressed": String(on), onclick: function () {
        var n = getShift();
        if (n.checked[key]) delete n.checked[key]; else { n.checked[key] = Date.now(); if (!n.start) n.start = Date.now(); }
        putShift(n); renderShift();
      } }, [el("span", { class: "n", text: st[0] }), el("span", { class: "t", text: st[1] }), el("span", { class: "ck", text: on ? "✓" : "" })]));
    });
    return DB.allRecords().then(function (all) {
      var today = todayStr();
      var birds = all.filter(function (r) { return r._date === today; }).sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); });
      $("shiftStat").textContent = "";
      [["Stops", done + " of " + route.stops.length], ["Birds today", String(birds.length)],
        ["Started", s.start ? clock(s.start) : "not yet"]].concat(s.end ? [["Ended", clock(s.end)]] : []).forEach(function (x) {
        $("shiftStat").appendChild(el("span", {}, [x[0] + ": ", el("b", { text: x[1] })]));
      });
      $("summaryOut").value = summaryText(s, route, done, birds);
    });
  }
  function birdLine(r) {
    var sp = r.species_common_name === "other" ? (r.species_common_name_other || "Other") : (labelFor("species_common_name", r.species_common_name) || "species not set");
    var b = r.building_name_and_address === "other" ? r.building_name_and_address_other : (r.building_name_and_address || "").split("/")[0];
    var bits = [r.found_as, r.which_side_of_the_building_was && r.which_side_of_the_building_was !== "NA" ? r.which_side_of_the_building_was + "-facing" : ""].filter(Boolean).join(", ");
    return "• #" + (r.random_int || "no ID") + " " + sp + (b ? " at " + b : "") + (bits ? " (" + bits + ")" : "") + (r.status === "sent" && !r.practice ? "" : " [not sent yet]");
  }
  function summaryText(s, route, done, birds) {
    var d = new Date(), lines = [];
    var when = s.start ? clock(s.start) + (s.end ? "–" + clock(s.end) : "") : "";
    lines.push(route.name + ", " + d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + (when ? ", " + when : ""));
    var who = store("names"); if (who) lines.push("Volunteer: " + who);
    if (done) lines.push("Stops checked: " + done + " of " + route.stops.length);
    if (!birds.length) lines.push("Birds: none found");
    else {
      var counts = {};
      birds.forEach(function (r) { var k = r.found_as || "not set"; counts[k] = (counts[k] || 0) + 1; });
      lines.push("Birds: " + birds.length + " (" + Object.keys(counts).map(function (k) { return counts[k] + " " + k.toLowerCase(); }).join(", ") + ")");
      birds.forEach(function (r) { lines.push(birdLine(r)); });
    }
    var missed = route.stops.filter(function (st) { return !s.checked[s.route + ":" + st[0] + ":" + st[1]]; });
    if (s.start && missed.length && missed.length <= route.stops.length / 2) lines.push("Not checked: " + missed.map(function (st) { return st[0]; }).join(", "));
    return lines.join("\n");
  }

  // ---- Resources from a Google Sheet --------------------------------------
  // Organizers edit a published sheet (see admin/README.md); the built-in page is the fallback.
  var CONFIG = window.COLLISION_CONFIG || {};
  function parseCsv(text) {
    var rows = [], row = [], f = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    var head = (rows.shift() || []).map(function (h) { return h.trim().toLowerCase(); });
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); }).map(function (r) {
      var o = {}; head.forEach(function (h, i) { o[h] = (r[i] || "").trim(); }); return o;
    });
  }
  function safeHref(u) {
    u = String(u || "").trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[\w.\/-]+(\?[\w=&.-]*)?(#[\w-]*)?$/.test(u) && u.indexOf("..") < 0) return u; // a file that ships with the app
    return null;
  }
  function imgSrc(u) {
    var m = String(u).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
    return m ? "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w1600" : safeHref(u);
  }
  function mapLinks(addr) {
    var q = encodeURIComponent(addr);
    return el("div", { class: "links" }, [
      el("a", { href: "https://maps.apple.com/?q=" + q, target: "_blank", rel: "noopener", text: "Apple Maps" }),
      el("a", { href: "https://www.google.com/maps/search/?api=1&query=" + q, target: "_blank", rel: "noopener", text: "Google Maps" })]);
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function renderResources(rows) {
    var stopsBy = {}, order = [], bySec = {}, quick = [];
    rows.forEach(function (r) {
      var kind = (r.kind || "").toLowerCase();
      if (kind === "stop") { (stopsBy[r.section] = stopsBy[r.section] || []).push([r.title, r.text]); return; }
      if (kind === "quick") { quick.push(r); return; }
      if (!r.section) return;
      if (!bySec[r.section]) { bySec[r.section] = []; order.push(r.section); }
      bySec[r.section].push(r);
    });
    if (!order.length && !quick.length) return false;
    var box = $("resources"), logo = box.querySelector(".logo");
    box.textContent = ""; if (logo) box.appendChild(logo);
    if (quick.length) {
      var qb = el("div", { class: "quick" });
      quick.forEach(function (r, i) { var h = safeHref(r.link); if (h) qb.appendChild(el("a", { class: i === 0 ? "hot" : "", href: h, target: "_blank", rel: "noopener" }, [r.title, el("span", { text: r.text })])); });
      box.appendChild(qb);
    }
    order.forEach(function (sec) {
      var body = el("div", { class: "body" }), links = null;
      bySec[sec].forEach(function (r) {
        var kind = (r.kind || "note").toLowerCase();
        if (kind !== "link") links = null;
        if (kind === "heading") body.appendChild(el("h3", { text: r.title || r.text }));
        else if (kind === "note") body.appendChild(el("p", { text: r.text || r.title }));
        else if (kind === "callout") body.appendChild(el("div", { class: "callout" }, [el("p", { text: r.text || r.title })]));
        else if (kind === "list") body.appendChild(el("ul", {}, (r.text || "").split(/\n/).filter(Boolean).map(function (l) { return el("li", { text: l.replace(/^[-•*]\s*/, "") }); })));
        else if (kind === "address") { body.appendChild(el("p", { class: "addr", text: r.text || r.title })); body.appendChild(mapLinks(r.text || r.title)); }
        else if (kind === "image") {
          var src = imgSrc(r.link); if (!src) return;
          body.appendChild(el("figure", {}, [el("a", { href: src, target: "_blank", rel: "noopener" }, [el("img", { src: src, alt: r.text || r.title || "", loading: "lazy" })]), r.text ? el("figcaption", { text: r.text }) : null]));
        } else if (kind === "link") {
          var h = safeHref(r.link); if (!h) return;
          if (!links) { links = el("div", { class: "links" }); body.appendChild(links); }
          links.appendChild(el("a", { href: h, target: "_blank", rel: "noopener", text: r.title || r.link }));
        } else if (kind === "stops") {
          var st = stopsBy[r.title] || [];
          if (!st.length) return;
          body.appendChild(el("div", { class: "stops" }, [el("table", {}, [
            el("thead", {}, [el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Stop" })])]),
            el("tbody", {}, st.map(function (s) { return el("tr", {}, [el("td", { text: s[0] }), el("td", { text: s[1] })]); }))])]));
        }
      });
      box.appendChild(el("details", { class: "res", id: "res-" + slug(sec) }, [el("summary", { text: sec }), body]));
    });
    var names = Object.keys(stopsBy);
    if (names.length) {
      ROUTES = {};
      names.forEach(function (n) { ROUTES[slug(n)] = { name: n, stops: stopsBy[n] }; });
      if (!$("shift").hidden) renderShift();
    }
    return true;
  }
  function loadResources() {
    var url = CONFIG.resourcesCsv;
    if (!url) return;
    var cached = store("resources_csv");
    if (cached) { try { renderResources(parseCsv(cached)); } catch (e) { /* keep built-in page */ } }
    if (!navigator.onLine) return;
    fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
      var rows = parseCsv(t);
      if (!rows.length || !("kind" in rows[0])) return;
      if (renderResources(rows)) store("resources_csv", t);
    }).catch(function () { /* offline or not published: keep what we have */ });
  }

  // ---- Theme --------------------------------------------------------------
  var THEMES = ["auto", "dark", "light"], THEME_LABEL = { auto: "Theme: match phone", dark: "Theme: dark", light: "Theme: light" };
  function applyTheme() {
    var t = store("theme") || "auto";
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    $("themeBtn").textContent = THEME_LABEL[t];
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", getComputedStyle(document.body).backgroundColor);
  }

  // ---- Light --------------------------------------------------------------
  // Android browsers can drive the camera flash; iPhone Safari can't, so it falls back to a white screen.
  var torch = null;
  function lightOn() {
    var btn = $("lightBtn");
    var screen = function () { $("screenLight").hidden = false; btn.setAttribute("aria-pressed", "true"); if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { torch = torch || { lock: l }; }).catch(function () {}); };
    var md = navigator.mediaDevices;
    var ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios || !md || !md.getUserMedia) return screen();
    md.getUserMedia({ video: { facingMode: { ideal: "environment" } } }).then(function (stream) {
      var track = stream.getVideoTracks()[0], caps = track.getCapabilities ? track.getCapabilities() : {};
      if (!caps.torch) { stream.getTracks().forEach(function (t) { t.stop(); }); return screen(); }
      return track.applyConstraints({ advanced: [{ torch: true }] }).then(function () { torch = { stream: stream }; btn.setAttribute("aria-pressed", "true"); btn.textContent = "Light off"; });
    }).catch(screen);
  }
  function lightOff() {
    if (torch && torch.stream) torch.stream.getTracks().forEach(function (t) { t.stop(); });
    if (torch && torch.lock) torch.lock.release().catch(function () {});
    torch = null; $("screenLight").hidden = true;
    $("lightBtn").setAttribute("aria-pressed", "false"); $("lightBtn").textContent = "Light";
  }

  // ---- Wiring -------------------------------------------------------------
  function updateNet() {
    var n = $("net");
    n.className = "net" + (navigator.onLine ? "" : " off");
    n.textContent = (navigator.onLine ? "Online" : "Offline: saving on phone") + (practice() ? " · Practice" : "");
  }
  TEXT.forEach(function (k) { $(k).addEventListener("input", function () { cur[k] = $(k).value; if (k === "names") store("names", cur.names); save(); }); });
  $("_date").addEventListener("change", function () { cur._date = $("_date").value; save(); });
  $("time").addEventListener("change", function () { cur.time = $("time").value; save(); });
  $("genId").addEventListener("click", function () {
    if ($("random_int").value && !$("genId").dataset.confirm) { $("genId").dataset.confirm = "1"; $("genId").textContent = "Replace?"; setTimeout(function () { delete $("genId").dataset.confirm; $("genId").textContent = "New ID"; }, 3000); return; }
    delete $("genId").dataset.confirm; $("genId").textContent = "New ID";
    cur.random_int = genId(); $("random_int").value = cur.random_int; save();
  });
  $("gps").addEventListener("click", useGps);
  $("lightBtn").addEventListener("click", function () { if ($("lightBtn").getAttribute("aria-pressed") === "true") lightOff(); else lightOn(); });
  $("lightOff").addEventListener("click", lightOff);
  $("timeNow").addEventListener("click", function () { cur.time = nowTime(); $("time").value = cur.time; save(); });
  $("compassBtn").addEventListener("click", startCompass);
  $("compassCancel").addEventListener("click", stopCompass);
  $("compassSet").addEventListener("click", function () {
    if (!cmp.side) return;
    cur.which_side_of_the_building_was = cmp.side; renderSeg("which_side_of_the_building_was"); save(); stopCompass();
    toast("Window faces " + cmp.side + ".");
  });
  try { $("checklist").open = store("checklistOpen") === "1"; } catch (e) { /* closed */ }
  $("checklist").addEventListener("toggle", function () { store("checklistOpen", $("checklist").open ? "1" : "0"); });
  $("shiftStart").addEventListener("click", function () { var s = getShift(); s.start = Date.now(); s.end = null; putShift(s); renderShift(); });
  $("shiftEnd").addEventListener("click", function () { var s = getShift(); s.end = Date.now(); putShift(s); renderShift(); });
  $("shiftReset").addEventListener("click", function () {
    var b = $("shiftReset");
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tap again to clear"; setTimeout(function () { delete b.dataset.confirm; b.textContent = "Clear today's checklist"; }, 3000); return; }
    delete b.dataset.confirm; b.textContent = "Clear today's checklist";
    try { localStorage.removeItem(shiftKey()); } catch (e) { /* nothing stored */ }
    renderShift();
  });
  $("copySummary").addEventListener("click", function () {
    var t = $("summaryOut");
    var done = function () { toast("Copied. Paste it in Discord."); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t.value).then(done, function () { t.select(); document.execCommand("copy"); done(); });
    else { t.select(); document.execCommand("copy"); done(); }
  });
  $("themeBtn").addEventListener("click", function () {
    var t = store("theme") || "auto"; store("theme", THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]); applyTheme();
  });
  $("pickLib").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
  $("pickCam").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
  $("newBtn").addEventListener("click", function () { startNew(); });
  $("backBtn").addEventListener("click", closeEdit);
  $("reviewBtn").addEventListener("click", openReview);
  $("dupBtn").addEventListener("click", function () { var base = cur; closeEdit().then(function () { return startNew(base); }).then(function () { toast("Copied. Enter the new bag ID."); $("random_int").focus(); }); });
  $("delBtn").addEventListener("click", function () {
    var b = $("delBtn");
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "Tap again to delete"; setTimeout(function () { delete b.dataset.confirm; fillForm(); }, 3000); return; }
    var id = cur.id;
    Promise.all(curPhotos.map(function (p) { return DB.delPhoto(p.id); })).then(function () { return DB.delRecord(id); }).then(function () { cur = null; show("home"); renderHome(); toast("Deleted from this phone."); });
  });
  $("clearSent").addEventListener("click", function () {
    DB.allRecords().then(function (all) {
      var sent = all.filter(function (r) { return r.status === "sent"; });
      return Promise.all(sent.map(function (r) {
        return DB.photosFor(r.id).then(function (ps) { return Promise.all(ps.map(function (p) { return DB.delPhoto(p.id); })); }).then(function () { return DB.delRecord(r.id); });
      })).then(function () { toast(sent.length + " sent record(s) removed."); renderHome(); });
    });
  });
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet") && !$("sheetBody").querySelector("button[disabled]")) closeSheet(); });
  window.addEventListener("online", function () { updateNet(); refreshDomains(); });
  window.addEventListener("offline", updateNet);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});

  applyTheme(); updateNet(); refreshDomains(); renderHome(); loadResources();
  var scanned = idFromText(params.get("id"));
  if (scanned) {
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* keep the URL */ }
    DB.allRecords().then(function (all) {
      var hit = all.find(function (r) { return String(r.random_int) === scanned; });
      if (hit) { openRecord(hit.id); toast("Opened your record for #" + scanned + "."); return; }
      return startNew().then(function () {
        cur.random_int = scanned; $("random_int").value = scanned; save();
        toast("Tag #" + scanned + " scanned. Finding your location…");
        useGps();
      });
    });
  } else if (location.hash === "#resources" || store("tab") === "res") show("res");
  else if (location.hash === "#shift" || store("tab") === "shift") show("shift");
})();
