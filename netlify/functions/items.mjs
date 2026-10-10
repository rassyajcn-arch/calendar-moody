// Penyimpanan bersama Moody Space Calendar (Netlify Blobs) — tidak perlu diubah.
import { getStore } from "@netlify/blobs";

const FIELDS = ["type","title","date","time","platform","pillar","status","pic","caption","notes","link","color","sample","created","updated"];
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function clean(it) {
  if (!it || typeof it !== "object") throw new Error("data tidak valid");
  const id = String(it.id || "").slice(0, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("id tidak valid");
  const out = { id };
  for (const k of FIELDS) {
    const v = it[k];
    if (v === undefined || v === null || v === "") continue;
    if (k === "sample") out[k] = v === true || v === "true";
    else if (k === "created" || k === "updated") out[k] = Number(v) || Date.now();
    else out[k] = String(v).slice(0, 5000);
  }
  if (!["konten", "event", "ide"].includes(out.type)) throw new Error("jenis tidak valid");
  if (!out.title) throw new Error("judul kosong");
  return out;
}

export default async (req) => {
  const store = getStore({ name: "moody-calendar", consistency: "strong" });
  const load = async () => (await store.get("items", { type: "json" })) || [];

  if (req.method === "GET") return json({ ok: true, items: await load() });

  if (req.method === "POST") {
    try {
      const body = await req.json();
      let items = await load();
      if (body.action === "upsert") {
        const it = clean(body.item);
        const i = items.findIndex((x) => x.id === it.id);
        if (i >= 0) items[i] = it; else items.push(it);
        if (items.length > 3000) throw new Error("data terlalu banyak");
      } else if (body.action === "delete") {
        items = items.filter((x) => x.id !== String(body.id));
      } else if (body.action === "deleteSample") {
        items = items.filter((x) => !x.sample);
      } else throw new Error("aksi tidak dikenal");
      await store.setJSON("items", items);
      return json({ ok: true, items });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 400);
    }
  }
  return json({ ok: false, error: "method not allowed" }, 405);
};

export const config = { path: "/api/items" };
