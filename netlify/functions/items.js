// Moody Space Calendar — API data bersama
// GET  /api/items            → { ok, items }
// POST /api/items  { action } → { ok, items }
//   action: upsert {item} · delete {id} · deleteSample
//           addComment {id, comment} · deleteComment {id, commentId}
// Data disimpan di Netlify Blobs (store "moody-calendar", key "items").

import { getStore } from "@netlify/blobs";

const STORE = "moody-calendar";
const KEY = "items";
const MAX_ITEMS = 3000;
const MAX_BODY = 200_000; // ~200 KB per request

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const today = new Date();
const d = (plus) => {
  const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + plus);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const SAMPLE = () => [
  { id: "s1", sample: true, type: "konten", title: "Reels Moody Lifter — cara bikin", date: d(1), time: "18:00", platform: "IG Reels", pillar: "Menu & Produk", status: "produksi", pic: "", caption: "", notes: "Close-up tuang susu, slow motion.", created: Date.now() },
  { id: "s2", sample: true, type: "event", title: "Live Akustik Jumat Malam", date: d(3), time: "19:30", color: "crema", notes: "Cek sound system jam 17.00", created: Date.now() },
  { id: "s3", sample: true, type: "ide", title: "Seri 'Kenalan sama barista'", pillar: "Behind the Scene", status: "ide", notes: "Satu barista per minggu, 3 pertanyaan ringan.", created: Date.now() },
];

// ---------- validasi ringan ----------
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v) => (typeof v === "number" && isFinite(v) ? v : undefined);
const TYPES = ["konten", "event", "ide", "profile"];

function cleanComment(c) {
  if (!c || typeof c !== "object") return null;
  const out = {
    id: str(c.id, 40),
    by: str(c.by, 40),
    at: num(c.at) ?? Date.now(),
    text: str(c.text, 2000),
    mentions: Array.isArray(c.mentions) ? c.mentions.filter((m) => typeof m === "string").slice(0, 20).map((m) => m.slice(0, 40)) : [],
  };
  return out.id && out.text ? out : null;
}

function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  const id = str(it.id, 60);
  const type = TYPES.includes(it.type) ? it.type : null;
  if (!id || !type) return null;
  const out = {
    id, type,
    title: str(it.title, 200), name: str(it.name, 40), color: str(it.color, 20),
    date: str(it.date, 10), time: str(it.time, 5),
    platform: str(it.platform, 60), pillar: str(it.pillar, 60), status: str(it.status, 20),
    pic: str(it.pic, 80), caption: str(it.caption, 5000), notes: str(it.notes, 5000), link: str(it.link, 1000),
    created: num(it.created), updated: num(it.updated),
    createdBy: str(it.createdBy, 40), updatedBy: str(it.updatedBy, 40),
    sample: it.sample === true ? true : undefined,
    comments: Array.isArray(it.comments) ? it.comments.map(cleanComment).filter(Boolean).slice(-300) : undefined,
  };
  Object.keys(out).forEach((k) => (out[k] === undefined || out[k] === "") && k !== "title" && delete out[k]);
  return out;
}

// ---------- baca / tulis aman (anti-tabrakan) ----------
async function read(store, needEtag = false) {
  // etag diambil SEBELUM data dibaca: kalau ada yang menulis di antaranya, penulisan kita otomatis ditolak lalu diulang
  let listEtag = null;
  if (needEtag) {
    const { blobs } = await store.list({ prefix: KEY });
    listEtag = blobs.find((b) => b.key === KEY)?.etag || null;
  }
  const r = await store.getWithMetadata(KEY, { type: "json" });
  if (r && !r.etag && listEtag) r.etag = listEtag;
  if (!r) return { items: null, etag: null, exists: false };
  return { items: Array.isArray(r.data) ? r.data : [], etag: r.etag || null, exists: true };
}

async function mutate(store, fn) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { items, etag, exists } = await read(store, true);
    const next = fn(items ?? SAMPLE());
    if (next.length > MAX_ITEMS) throw new Error("Data terlalu banyak");
    // etag ada → tulis hanya jika belum diubah orang lain; data belum ada → hanya jika masih baru
    const opts = etag ? { onlyIfMatch: etag } : exists ? {} : { onlyIfNew: true };
    const res = await store.setJSON(KEY, next, opts);
    if (!res || res.modified !== false) return next; // berhasil
    await new Promise((r) => setTimeout(r, 30 + Math.random() * (60 + attempt * 60))); // ada yang menulis duluan → ulangi
  }
  throw new Error("Server sedang sibuk, coba lagi");
}

export default async (req) => {
  const store = getStore({ name: STORE, consistency: "strong" });

  try {
    if (req.method === "GET") {
      const { items } = await read(store);
      if (items === null) {
        const seeded = await mutate(store, (x) => x); // isi contoh saat pertama kali
        return json({ ok: true, items: seeded });
      }
      return json({ ok: true, items });
    }

    if (req.method !== "POST") return json({ ok: false, error: "Method tidak didukung" }, 405);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: "Data terlalu besar" }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "JSON tidak valid" }, 400); }

    let items;
    switch (body.action) {
      case "upsert": {
        const item = cleanItem(body.item);
        if (!item) return json({ ok: false, error: "Item tidak valid" }, 400);
        items = await mutate(store, (list) => {
          const i = list.findIndex((x) => x.id === item.id);
          if (i < 0) return [...list, item];
          // komentar dikelola lewat addComment/deleteComment → jangan sampai tertimpa
          const merged = { ...item, comments: list[i].comments ?? item.comments };
          if (!merged.comments) delete merged.comments;
          const copy = list.slice(); copy[i] = merged; return copy;
        });
        break;
      }
      case "delete": {
        const id = str(body.id, 60);
        items = await mutate(store, (list) => list.filter((x) => x.id !== id));
        break;
      }
      case "deleteSample": {
        items = await mutate(store, (list) => list.filter((x) => !x.sample));
        break;
      }
      case "addComment": {
        const id = str(body.id, 60), c = cleanComment(body.comment);
        if (!id || !c) return json({ ok: false, error: "Komentar tidak valid" }, 400);
        items = await mutate(store, (list) =>
          list.map((x) => (x.id === id && !(x.comments || []).some((y) => y.id === c.id)
            ? { ...x, comments: [...(x.comments || []), c].slice(-300) } : x)));
        break;
      }
      case "deleteComment": {
        const id = str(body.id, 60), cid = str(body.commentId, 40);
        items = await mutate(store, (list) =>
          list.map((x) => (x.id === id ? { ...x, comments: (x.comments || []).filter((y) => y.id !== cid) } : x)));
        break;
      }
      default:
        return json({ ok: false, error: "Action tidak dikenal" }, 400);
    }
    return json({ ok: true, items });
  } catch (e) {
    return json({ ok: false, error: e?.message || "Terjadi kesalahan" }, 500);
  }
};

export const config = { path: "/api/items" };
