"use strict";

// ---------- storage (IndexedDB, on this device) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("binfinder", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("bins", { keyPath: "id" });
        d.createObjectStore("photos", { keyPath: "id" });
      };
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
    });
  },
  tx(stores, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  },
  all: store => DB.tx(store, "readonly", t => t.objectStore(store).getAll()),
  get: (store, id) => DB.tx(store, "readonly", t => t.objectStore(store).get(id)),
  put: (store, v) => DB.tx(store, "readwrite", t => t.objectStore(store).put(v)),
  del: (store, id) => DB.tx(store, "readwrite", t => t.objectStore(store).delete(id))
};

const ICON = {
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 9V4h10v5M7 17H4v-7h16v7h-3"/><path d="M7 14h10v6H7z"/></svg>'
};

const S = {
  route: "home", binId: null, q: "", bins: [], ready: false,
  showNew: false, confirmDelete: false, lightbox: null, lbConfirm: false,
  uploading: null, unselected: new Set()
};
const $app = document.getElementById("app");

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const getBin = id => S.bins.find(b => b.id === id);
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const byCode = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true });
// Inside the iPhone/Android app the page runs from a local origin, so labels always point at the public web address.
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const PUBLIC_URL = "https://superduty335.github.io/AllTotes/";
const appUrl = () => NATIVE ? PUBLIC_URL : location.href.replace(/#.*$/, "");
const binUrl = code => appUrl() + "#" + code;

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3400);
}
function failed(e) {
  console.error(e);
  toast(e && e.name === "QuotaExceededError"
    ? "Your phone is out of space for Bin Finder. Delete some photos or bins."
    : "Couldn't save that change. Try again.");
}

let askedPersist = false;
async function saveBin(bin) {
  bin.updatedAt = Date.now();
  const i = S.bins.findIndex(b => b.id === bin.id);
  if (i < 0) S.bins.push(bin); else S.bins[i] = bin;
  render();
  try { await DB.put("bins", bin); } catch (e) { failed(e); }
  if (!askedPersist && navigator.storage && navigator.storage.persist) { askedPersist = true; navigator.storage.persist().catch(() => {}); }
}
function patchBin(id, mutate) {
  const b = getBin(id); if (!b) return;
  const next = structuredClone(b); mutate(next); return saveBin(next);
}

function nextCode() {
  let max = 0;
  for (const b of S.bins) { const n = parseInt(String(b.id).replace(/\D/g, ""), 10); if (n > max) max = n; }
  return "B" + String(max + 1).padStart(3, "0");
}
function extractCode(text) {
  if (!text) return null;
  const m = String(text).match(/#?\b(B\d{3,})\s*$/i) || String(text).match(/\b(B\d{3,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

// ---------- photos ----------
const photoUrls = new Map();
async function photoUrl(id) {
  if (photoUrls.has(id)) return photoUrls.get(id);
  const rec = await DB.get("photos", id).catch(() => null);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob); photoUrls.set(id, u); return u;
}
const img = (id, attrs) => `<img data-pid="${esc(id)}" ${photoUrls.has(id) ? `src="${photoUrls.get(id)}"` : ""} ${attrs}>`;
async function hydratePhotos() {
  for (const el of document.querySelectorAll("img[data-pid]:not([src])")) {
    const u = await photoUrl(el.dataset.pid); if (u) el.src = u;
  }
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => res(im); im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    im.src = url;
  });
}
async function compress(file) {
  const im = await loadImage(file);
  const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(im.src);
  return new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
}

// ---------- QR ----------
function qrMatrix(text) {
  if (typeof qrcode !== "function") return null;
  const q = qrcode(0, "M"); q.addData(text); q.make();
  const n = q.getModuleCount(), rows = [];
  for (let r = 0; r < n; r++) { const row = []; for (let c = 0; c < n; c++) row.push(q.isDark(r, c)); rows.push(row); }
  return rows;
}
function qrSvg(text) {
  const m = qrMatrix(text);
  if (!m) return '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#eee"/></svg>';
  const n = m.length, pad = 2; let d = "";
  m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + pad} ${r + pad}h1v1h-1z`; }));
  return `<svg viewBox="0 0 ${n + pad * 2} ${n + pad * 2}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------- views ----------
function viewHome() {
  const q = S.q.trim().toLowerCase();
  let list = [...S.bins].sort(byCode);
  const hits = {};
  if (q) list = list.filter(b => {
    const items = (b.items || []).filter(i => i.name.toLowerCase().includes(q));
    if (items.length) hits[b.id] = items;
    return items.length || [b.id, b.name, b.location].some(s => String(s || "").toLowerCase().includes(q));
  });
  const mark = s => { const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };

  let h = `<div class="scanbar">
      <a class="btn tape" href="#scan">${ICON.scan} Scan a label</a>
      <button class="btn" data-act="toggleNew" aria-expanded="${S.showNew}">${ICON.plus} New bin</button>
    </div>`;
  if (S.showNew) h += `<form class="panel" id="newBinForm">
      <p class="eyebrow">New bin · gets code ${esc(nextCode())}</p>
      <div class="row">
        <input class="field" id="newName" data-draft placeholder="What's in it? e.g. Christmas lights" autocomplete="off" required>
        <input class="field" id="newLoc" data-draft placeholder="Where is it? e.g. Garage, shelf 2" autocomplete="off">
      </div>
      <div class="row"><button class="btn tape" type="submit">Create bin</button><button class="btn" type="button" data-act="toggleNew">Cancel</button></div>
    </form>`;

  if (!S.bins.length) return h + `<div class="empty">
      <h2>No bins yet</h2>
      <p>Make your first bin, stick its label on the tote, and you'll never dig through ten totes for one extension cord again.</p>
      <ol class="steps">
        <li><b>1 · Create a bin</b>Give it a name and where it lives. It gets a code like B001.</li>
        <li><b>2 · Fill it in</b>Snap photos of what goes in and list the items.</li>
        <li><b>3 · Label it</b>Print the QR label and stick it on the bin. Scan it any time to see inside.</li>
      </ol>
    </div>`;

  h += `<input class="field search" id="search" data-draft type="search" placeholder="Find an item, e.g. extension cord" value="${esc(S.q)}" autocomplete="off">`;
  h += `<p class="eyebrow"><span>${q ? `${list.length} matching bin${list.length === 1 ? "" : "s"}` : `${S.bins.length} bin${S.bins.length === 1 ? "" : "s"}`}</span></p>`;
  if (!list.length) return h + `<p class="empty">Nothing matches “${esc(S.q)}”.</p>`;
  return h + `<ul class="bins">` + list.map(b => {
    const ph = (b.photos || [])[0], items = b.items || [];
    const sub = hits[b.id]
      ? `<div class="hit">${hits[b.id].slice(0, 3).map(i => mark(i.name) + (i.qty > 1 ? ` ×${i.qty}` : "")).join(", ")}</div>`
      : `<div class="bin-meta">${esc(b.location || "No location set")}</div>`;
    return `<li><a class="bin" href="#${esc(b.id)}">
        ${ph ? img(ph, 'class="thumb" alt=""') : `<span class="thumb">${ICON.box}</span>`}
        <span class="bin-main"><span class="bin-title"><span class="code">${esc(b.id)}</span><span class="bin-name">${esc(b.name || "Untitled bin")}</span></span>${sub}</span>
        <span class="count">${items.length} item${items.length === 1 ? "" : "s"}</span>
      </a></li>`;
  }).join("") + `</ul>`;
}

function viewBin() {
  const b = getBin(S.binId);
  const back = `<a class="link" href="#">‹ All bins</a>`;
  if (!b) return back + `<div class="empty"><h2>No bin ${esc(S.binId)}</h2><p>This phone doesn't have a bin with that code. If you made it on another phone, move it over with Backup.</p></div>`;
  const items = b.items || [], photos = b.photos || [];
  let h = `${back}
    <div class="head">
      <div><span class="code">${esc(b.id)}</span></div>
      <input class="title-in" id="binName" value="${esc(b.name)}" placeholder="Name this bin" aria-label="Bin name">
      <input class="loc-in" id="binLoc" value="${esc(b.location)}" placeholder="Where is it? e.g. Garage, shelf 2" aria-label="Location">
    </div>
    <section>
      <p class="eyebrow"><span>Photos · ${photos.length}</span>${S.uploading && S.uploading.binId === b.id ? `<span class="busy">Adding ${S.uploading.done + 1} of ${S.uploading.total}…</span>` : ""}</p>
      <div class="photos">
        ${photos.map((id, i) => `<button class="photo" data-act="photo" data-i="${i}" aria-label="Open photo ${i + 1}">${img(id, `alt="Photo ${i + 1} of ${esc(b.name)}"`)}</button>`).join("")}
        <label class="add-photo">${ICON.camera}<span>Add photos</span><input type="file" accept="image/*" multiple id="photoInput"></label>
      </div>
    </section>
    <section>
      <p class="eyebrow"><span>Items · ${items.reduce((n, i) => n + (i.qty || 1), 0)}</span></p>
      <ul class="items">
        ${items.length ? items.map(i => `<li class="item">
            <span class="item-name">${esc(i.name)}</span>
            <span class="qty"><button data-act="qty" data-item="${esc(i.id)}" data-d="-1" aria-label="Fewer">−</button><span>${i.qty || 1}</span><button data-act="qty" data-item="${esc(i.id)}" data-d="1" aria-label="More">+</button></span>
            <button class="x" data-act="rmItem" data-item="${esc(i.id)}" aria-label="Remove ${esc(i.name)}">×</button>
          </li>`).join("") : `<li class="no-items">Nothing listed yet.</li>`}
      </ul>
      <form class="add-item" id="addItemForm">
        <input class="field" id="itemName" data-draft placeholder="Add an item" autocomplete="off" aria-label="Item name">
        <input class="field" id="itemQty" data-draft type="number" min="1" value="1" inputmode="numeric" aria-label="Quantity">
        <button class="btn tape" type="submit">Add</button>
      </form>
    </section>
    <section>
      <p class="eyebrow"><span>Label</span></p>
      ${labelCard(b)}
      <div class="row" style="margin-top:10px">
        <button class="btn" data-act="printOne">${ICON.print} Print label</button>
        <button class="btn" data-act="saveLabel">${ICON.save} Save label image</button>
      </div>
      <p class="note">Sized for a 2×4 in. sticker (Avery 5163 or 8163, 10 per sheet). Print at 100% / actual size.</p>
    </section>`;
  h += S.confirmDelete
    ? `<div class="confirm"><p>Delete ${esc(b.id)} and its ${photos.length} photo${photos.length === 1 ? "" : "s"}? This can't be undone.</p>
        <button class="btn solid-danger" data-act="delBinYes">Delete bin</button><button class="btn" data-act="delBinNo">Keep it</button></div>`
    : `<button class="btn danger" data-act="delBin">Delete this bin</button>`;
  return h;
}

function labelCard(b) {
  return `<div class="label-card">${qrSvg(binUrl(b.id))}
    <div><div class="label-code">${esc(b.id)}</div><div class="label-name">${esc(b.name || "")}</div><div class="label-loc">${esc(b.location || "")}</div></div></div>`;
}

function viewLabels() {
  const list = [...S.bins].sort(byCode);
  let h = `<a class="link" href="#">‹ All bins</a>
    <div class="head"><h2 class="title-in">Labels</h2>
    <p class="note" style="margin:0">Prints on Avery 5163 or 8163 sheets (2×4 in., 10 per page). Choose “Actual size” or 100% in the print dialog. Plain paper works too: cut them out and tape them on.</p></div>`;
  if (!list.length) return h + `<p class="empty">Create a bin first and its label shows up here.</p>`;
  const n = list.filter(b => !S.unselected.has(b.id)).length;
  h += `<div class="row" style="margin-bottom:14px;align-items:center">
      <button class="btn tape" data-act="printSel" ${n ? "" : "disabled"}>${ICON.print} Print ${n} label${n === 1 ? "" : "s"}</button>
      <button class="link" data-act="selAll">Select all</button><button class="link" data-act="selNone">Select none</button>
    </div>`;
  return h + `<div class="labels-grid">${list.map(b => `<label style="display:grid;gap:6px;cursor:pointer">
      <span class="row" style="align-items:center;gap:8px"><input type="checkbox" data-sel="${esc(b.id)}" ${S.unselected.has(b.id) ? "" : "checked"}> <span class="busy">Include ${esc(b.id)}</span></span>
      ${labelCard(b)}</label>`).join("")}</div>`;
}

function viewScan() {
  return `<a class="link" href="#">‹ All bins</a>
    <div class="head"><h2 class="title-in">Scan a label</h2></div>
    <div class="scanner"><video id="scanVideo" playsinline muted autoplay></video><div class="frame"></div><div class="msg" id="scanMsg">Starting camera…</div></div>
    <div class="row"><label class="btn" for="scanPhoto">${ICON.camera} Take a photo instead</label></div>
    <form class="row" id="codeForm" style="margin-top:14px">
      <input class="field" id="codeIn" data-draft placeholder="Or type a code, e.g. B004" autocomplete="off" autocapitalize="characters" style="flex:1 1 160px">
      <button class="btn" type="submit">Open</button>
    </form>`;
}

function viewSettings() {
  return `<a class="link" href="#">‹ All bins</a>
    <div class="head"><h2 class="title-in">Backup</h2></div>
    <div class="panel">
      <h2>Save a backup</h2>
      <p>Your bins and photos live on this phone only. Save a backup file now and then (to Files, iCloud Drive, Google Drive or email) so you don't lose them if the phone is lost or replaced.</p>
      <p class="busy" id="storageInfo"></p>
      <div class="row"><button class="btn tape" data-act="export">${ICON.save} Save backup file</button></div>
    </div>
    <div class="panel">
      <h2>Restore or move to another phone</h2>
      <p>Open a backup file here. Bins with the same code are replaced by the ones in the file; everything else stays.</p>
      <div class="row"><label class="btn" for="importFile">Open backup file</label></div>
    </div>
    ${NATIVE ? "" : `<div class="panel">
      <h2>Put it on your home screen</h2>
      <p><b>iPhone:</b> open this page in Safari, tap Share, then “Add to Home Screen”.<br><b>Android:</b> in Chrome, tap ⋮ then “Install app” or “Add to Home screen”.</p>
      <p class="busy">Once installed it opens full screen, works without signal, and your phone is less likely to clear its data.</p>
    </div>`}`;
}

function viewLightbox() {
  const b = getBin(S.binId); const photos = (b && b.photos) || [];
  const id = photos[S.lightbox.i]; if (!id) { S.lightbox = null; return ""; }
  return `<div class="lb" role="dialog" aria-label="Photo">
    <div class="lb-bar">
      <span>${S.lightbox.i + 1} / ${photos.length}</span>
      ${photos.length > 1 ? `<button class="btn" data-act="lbPrev" aria-label="Previous photo">‹</button><button class="btn" data-act="lbNext" aria-label="Next photo">›</button>` : ""}
      ${S.lbConfirm ? `<button class="btn solid-danger" data-act="lbDelYes">Delete photo</button><button class="btn" data-act="lbDelNo">Keep</button>` : `<button class="btn" data-act="lbDel">Delete</button>`}
      <button class="btn" data-act="lbClose">Close</button>
    </div>
    ${img(id, 'alt=""')}
  </div>`;
}

let lastKey = "";
function render() {
  const key = S.route + ":" + S.binId;
  if (S.route === "scan" && key === lastKey) return; // keep the live video element
  const keep = {}, active = document.activeElement;
  if (key === lastKey) $app.querySelectorAll("input[id]:not([type=file]):not([type=checkbox])").forEach(el => {
    if (el.hasAttribute("data-draft") || el === active) keep[el.id] = el.value;
  });
  const focusId = active && $app.contains(active) && active.id;
  const sel = focusId && /^(text|search)$/.test(active.type) ? [active.selectionStart, active.selectionEnd] : null;

  let html = !S.ready ? `<p class="busy">Loading your bins…</p>`
    : S.route === "bin" ? viewBin() : S.route === "labels" ? viewLabels()
    : S.route === "scan" ? viewScan() : S.route === "settings" ? viewSettings() : viewHome();
  if (S.lightbox) html += viewLightbox();
  $app.innerHTML = html;

  if (key === lastKey) {
    for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} } }
  }
  const changed = key !== lastKey;
  lastKey = key;
  document.getElementById("navLabels").hidden = S.route === "labels";
  document.getElementById("navSettings").hidden = S.route === "settings";
  hydratePhotos();
  if (changed && S.route === "scan") startScanner();
  if (changed && S.route === "settings") showStorage();
}

// ---------- routing ----------
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  stopScanner();
  S.confirmDelete = false; S.lightbox = null; S.showNew = false;
  if (!h) { S.route = "home"; S.binId = null; }
  else if (["labels", "scan", "settings"].includes(h)) { S.route = h; S.binId = null; }
  else { S.route = "bin"; S.binId = extractCode(h) || h; }
  render(); window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// ---------- scanning ----------
let scan = null;
const scanMsg = t => { const m = document.getElementById("scanMsg"); if (m) m.textContent = t; };
function handleScanned(text) {
  const code = extractCode(text);
  if (code && getBin(code)) { if (navigator.vibrate) navigator.vibrate(60); location.hash = code; return true; }
  scanMsg(code ? `No bin ${code} on this phone yet.` : "That QR code isn't a Bin Finder label.");
  return false;
}
async function startScanner() {
  const token = {}; scan = token;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return scanMsg("Live camera isn't available in this browser. Use “Take a photo instead”.");
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }); }
  catch (e) { return scanMsg("Camera is blocked. Allow camera access for this site in your settings, or use “Take a photo instead”."); }
  if (scan !== token) { stream.getTracks().forEach(t => t.stop()); return; }
  token.stream = stream;
  const video = document.getElementById("scanVideo");
  video.srcObject = stream;
  try { await video.play(); } catch {}
  scanMsg("Point at a bin label");
  let detector = null;
  if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch {} }
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tick = async () => {
    if (scan !== token) return;
    let text = null;
    if (video.readyState >= 2 && video.videoWidth) {
      if (detector) { try { const r = await detector.detect(video); if (r[0]) text = r[0].rawValue; } catch {} }
      else if (typeof jsQR === "function") {
        const w = 640, h = Math.round(video.videoHeight * w / video.videoWidth);
        canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
        const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
        if (r) text = r.data;
      }
    }
    if (text && handleScanned(text)) return;
    if (scan === token) token.timer = setTimeout(tick, 200);
  };
  tick();
}
function stopScanner() {
  if (!scan) return;
  clearTimeout(scan.timer);
  if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
  scan = null;
}
async function decodePhoto(file) {
  const im = await loadImage(file);
  try {
    if ("BarcodeDetector" in window) {
      try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(im); if (r[0]) return r[0].rawValue; } catch {}
    }
    if (typeof jsQR !== "function") return null;
    for (const max of [1000, 700, 1600]) {
      const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(im, 0, 0, c.width, c.height);
      const r = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
      if (r && r.data) return r.data;
    }
    return null;
  } finally { URL.revokeObjectURL(im.src); }
}

// ---------- labels: print + image ----------
function printLabels(bins) {
  if (NATIVE) return shareLabelPdf(bins).catch(failed);
  const out = [];
  for (let p = 0; p < bins.length; p += 10) {
    out.push(`<div class="sheet">${bins.slice(p, p + 10).map(b => `<div class="plabel">${qrSvg(binUrl(b.id))}
      <div><div class="pc">${esc(b.id)}</div><div class="pn">${esc(b.name || "")}</div><div class="pl">${esc(b.location || "")}</div><div class="ps">Scan to see what's inside</div></div></div>`).join("")}</div>`);
  }
  document.getElementById("print").innerHTML = out.join("");
  setTimeout(() => window.print(), 50);
}
function wrapLines(ctx, text, width, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean), lines = []; let cur = "";
  for (const w of words) { const t = cur ? cur + " " + w : w; if (ctx.measureText(t).width <= width || !cur) cur = t; else { lines.push(cur); cur = w; } }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "…"); }
  return lines;
}
async function labelFonts() {
  try { await Promise.all(['600 120px "IBM Plex Mono"', '600 52px "IBM Plex Sans"', '400 38px "IBM Plex Sans"'].map(f => document.fonts.load(f))); } catch {}
}
function drawLabel(ctx, x, y, b) { // 1200×600 px = 4×2 in at 300 dpi
  ctx.fillStyle = "#fff"; ctx.fillRect(x, y, 1200, 600);
  const m = qrMatrix(binUrl(b.id));
  if (m) {
    const n = m.length, cell = Math.floor(480 / n), off = (480 - cell * n) / 2;
    ctx.fillStyle = "#000";
    m.forEach((row, r) => row.forEach((on, col) => { if (on) ctx.fillRect(x + 60 + off + col * cell, y + 60 + off + r * cell, cell, cell); }));
  }
  ctx.fillStyle = "#000"; ctx.textBaseline = "top";
  ctx.font = '600 120px "IBM Plex Mono", monospace'; ctx.fillText(b.id, x + 600, y + 70);
  ctx.font = '600 52px "IBM Plex Sans", sans-serif';
  const lines = wrapLines(ctx, b.name, 540, 3);
  lines.forEach((l, i) => ctx.fillText(l, x + 600, y + 225 + i * 64));
  ctx.fillStyle = "#444"; ctx.font = '400 38px "IBM Plex Sans", sans-serif';
  wrapLines(ctx, b.location, 540, 1).forEach(l => ctx.fillText(l, x + 600, y + 240 + lines.length * 64));
  ctx.fillStyle = "#777"; ctx.font = '500 28px "IBM Plex Sans", sans-serif';
  ctx.fillText("Scan to see what's inside", x + 600, y + 500);
}
async function labelPng(b) {
  await labelFonts();
  const c = document.createElement("canvas"); c.width = 1200; c.height = 600;
  drawLabel(c.getContext("2d"), 0, 0, b);
  return new Promise(r => c.toBlob(r, "image/png"));
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
// The app's web view can't open the print dialog, so build a PDF of label sheets and hand it to the share sheet (which has Print).
async function shareLabelPdf(bins) {
  toast("Preparing labels…");
  if (!window.jspdf) await loadScript("vendor/jspdf.umd.min.js");
  await labelFonts();
  const pdf = new window.jspdf.jsPDF({ unit: "in", format: "letter" });
  for (let p = 0; p < bins.length; p += 10) {
    const c = document.createElement("canvas"); c.width = 2550; c.height = 3300; // letter at 300 dpi
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    bins.slice(p, p + 10).forEach((b, i) => drawLabel(ctx, i % 2 ? 1303 : 47, 150 + Math.floor(i / 2) * 600, b)); // Avery 5163 grid
    if (p) pdf.addPage();
    pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 8.5, 11);
  }
  document.getElementById("toast").hidden = true;
  await saveFile(pdf.output("blob"), bins.length === 1 ? `${bins[0].id}-label.pdf` : "bin-labels.pdf");
}
async function saveFile(blob, filename) {
  if (NATIVE) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const data = (await blobToDataUrl(blob)).split(",")[1];
    const { uri } = await Filesystem.writeFile({ path: filename, data, directory: "CACHE" });
    try { await Share.share({ title: filename, files: [uri] }); }
    catch (e) { if (!/cancel/i.test(e && e.message || "")) throw e; }
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- backup ----------
const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
async function exportBackup() {
  toast("Preparing backup…");
  const photos = await DB.all("photos");
  const parts = [`{"app":"bin-finder","version":1,"exportedAt":${JSON.stringify(new Date().toISOString())},"bins":${JSON.stringify(S.bins)},"photos":[`];
  for (let i = 0; i < photos.length; i++) {
    parts.push((i ? "," : "") + JSON.stringify({ id: photos[i].id, createdAt: photos[i].createdAt, data: await blobToDataUrl(photos[i].blob) }));
  }
  parts.push("]}");
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  document.getElementById("toast").hidden = true;
  await saveFile(new Blob(parts, { type: "application/json" }), `bin-finder-backup-${stamp}.json`);
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't a Bin Finder backup."); }
  if (!data || data.app !== "bin-finder" || !Array.isArray(data.bins)) return toast("That file isn't a Bin Finder backup.");
  const clash = data.bins.filter(b => getBin(b.id)).length;
  if (!confirm(`Restore ${data.bins.length} bin${data.bins.length === 1 ? "" : "s"} and ${(data.photos || []).length} photos?` + (clash ? `\n\n${clash} bin${clash === 1 ? "" : "s"} with the same code on this phone will be replaced.` : ""))) return;
  toast("Restoring…");
  try {
    for (const p of data.photos || []) {
      const blob = await (await fetch(p.data)).blob();
      await DB.put("photos", { id: p.id, blob, createdAt: p.createdAt || Date.now() });
    }
    for (const b of data.bins) await DB.put("bins", b);
    S.bins = await DB.all("bins");
    toast(`Restored ${data.bins.length} bin${data.bins.length === 1 ? "" : "s"}`);
    location.hash = "";
    route();
  } catch (e) { failed(e); }
}
async function showStorage() {
  const el = document.getElementById("storageInfo"); if (!el || !navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const photos = S.bins.reduce((n, b) => n + (b.photos || []).length, 0);
    el.textContent = `${S.bins.length} bins, ${photos} photos, about ${(usage / 1048576).toFixed(1)} MB on this phone.` + (persisted ? " Protected from automatic cleanup." : "");
  } catch {}
}

// ---------- actions ----------
const actions = {
  toggleNew: () => { S.showNew = !S.showNew; render(); if (S.showNew) document.getElementById("newName").focus(); },
  qty: t => patchBin(S.binId, b => { const i = b.items.find(i => i.id === t.dataset.item); if (i) i.qty = Math.max(1, (i.qty || 1) + Number(t.dataset.d)); }),
  rmItem: t => patchBin(S.binId, b => { b.items = b.items.filter(i => i.id !== t.dataset.item); }),
  photo: t => { S.lightbox = { i: Number(t.dataset.i) }; S.lbConfirm = false; render(); },
  lbClose: () => { S.lightbox = null; render(); },
  lbPrev: () => { const n = getBin(S.binId).photos.length; S.lightbox.i = (S.lightbox.i - 1 + n) % n; S.lbConfirm = false; render(); },
  lbNext: () => { const n = getBin(S.binId).photos.length; S.lightbox.i = (S.lightbox.i + 1) % n; S.lbConfirm = false; render(); },
  lbDel: () => { S.lbConfirm = true; render(); },
  lbDelNo: () => { S.lbConfirm = false; render(); },
  lbDelYes: async () => {
    const b = getBin(S.binId), id = b.photos[S.lightbox.i];
    S.lightbox = null; S.lbConfirm = false;
    await patchBin(b.id, nb => { nb.photos = nb.photos.filter(p => p !== id); });
    DB.del("photos", id).catch(() => {});
    if (photoUrls.has(id)) { URL.revokeObjectURL(photoUrls.get(id)); photoUrls.delete(id); }
    toast("Photo deleted");
  },
  delBin: () => { S.confirmDelete = true; render(); },
  delBinNo: () => { S.confirmDelete = false; render(); },
  delBinYes: async () => {
    const b = getBin(S.binId); if (!b) return;
    S.bins = S.bins.filter(x => x.id !== b.id);
    location.hash = "";
    try {
      await DB.del("bins", b.id);
      for (const p of b.photos || []) await DB.del("photos", p);
      toast(`Deleted ${b.id}`);
    } catch (e) { failed(e); }
  },
  printOne: () => printLabels([getBin(S.binId)]),
  printSel: () => printLabels([...S.bins].sort(byCode).filter(b => !S.unselected.has(b.id))),
  selAll: () => { S.unselected.clear(); render(); },
  selNone: () => { S.bins.forEach(b => S.unselected.add(b.id)); render(); },
  saveLabel: async () => { const b = getBin(S.binId); if (b) await saveFile(await labelPng(b), `${b.id}-label.png`); },
  export: () => exportBackup().catch(failed)
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const fn = actions[t.dataset.act]; if (fn) { e.preventDefault(); fn(t, e); }
});
document.addEventListener("keydown", e => {
  if (!S.lightbox) return;
  if (e.key === "Escape") actions.lbClose();
  else if (e.key === "ArrowLeft") actions.lbPrev();
  else if (e.key === "ArrowRight") actions.lbNext();
});
document.addEventListener("input", e => {
  if (e.target.id === "search") { S.q = e.target.value; render(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.sel) {
    if (t.checked) S.unselected.delete(t.dataset.sel); else S.unselected.add(t.dataset.sel);
    render();
  } else if (t.id === "binName" || t.id === "binLoc") {
    const field = t.id === "binName" ? "name" : "location", v = t.value.trim();
    const b = getBin(S.binId); if (!b || (b[field] || "") === v) return;
    patchBin(S.binId, nb => { nb[field] = v; });
  } else if (t.id === "photoInput") {
    const files = [...t.files], binId = S.binId; t.value = "";
    if (!files.length) return;
    S.uploading = { binId, done: 0, total: files.length }; render();
    const ids = [];
    for (const f of files) {
      try {
        const blob = await compress(f), id = rid();
        await DB.put("photos", { id, blob, createdAt: Date.now() });
        ids.push(id);
      } catch (err) { if (err && err.name === "QuotaExceededError") failed(err); else toast("One photo couldn't be read. Try a JPG or PNG."); }
      S.uploading.done++; render();
    }
    S.uploading = null;
    if (ids.length) await patchBin(binId, nb => { nb.photos = [...(nb.photos || []), ...ids]; });
    render();
  } else if (t.id === "scanPhoto") {
    const f = t.files[0]; t.value = ""; if (!f) return;
    scanMsg("Reading label…");
    let text = null; try { text = await decodePhoto(f); } catch {}
    if (!text) return scanMsg("Couldn't find a QR code in that photo. Fill the frame with the label and try again.");
    handleScanned(text);
  } else if (t.id === "importFile") {
    const f = t.files[0]; t.value = ""; if (f) importBackup(f);
  }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "newBinForm") {
    const name = document.getElementById("newName").value.trim();
    const location_ = document.getElementById("newLoc").value.trim();
    if (!name) return;
    const code = nextCode(), now = Date.now();
    saveBin({ id: code, name, location: location_, items: [], photos: [], createdAt: now, updatedAt: now });
    location.hash = code;
  } else if (f.id === "addItemForm") {
    const nameEl = document.getElementById("itemName"), qtyEl = document.getElementById("itemQty");
    const name = nameEl.value.trim(); if (!name) return;
    const qty = Math.max(1, parseInt(qtyEl.value, 10) || 1);
    nameEl.value = ""; qtyEl.value = "1"; nameEl.focus();
    patchBin(S.binId, b => { b.items = [...(b.items || []), { id: rid(), name, qty }]; });
  } else if (f.id === "codeForm") {
    const v = document.getElementById("codeIn").value.trim();
    const code = extractCode(v) || extractCode("B" + v.replace(/\D/g, "").padStart(3, "0"));
    if (!code) return scanMsg("Type a bin code like B004.");
    if (!getBin(code)) return scanMsg(`No bin ${code} on this phone yet.`);
    location.hash = code;
  }
});

// ---------- boot ----------
(async () => {
  try {
    await DB.open();
    S.bins = await DB.all("bins");
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<div class="empty"><h2>Storage is off</h2><p>Bin Finder needs to save data on this phone. Private browsing can block that; open it in a normal browser tab.</p></div>`;
    return;
  }
  S.ready = true;
  route();
})();
if (!NATIVE && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
