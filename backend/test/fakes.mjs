// Test doubles for Cloudflare bindings: D1 on node:sqlite (with the real
// migrations) and an in-memory R2 bucket with multipart uploads.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIGRATIONS).sort()) db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
  const size = () => db.prepare("PRAGMA page_count").get().page_count * db.prepare("PRAGMA page_size").get().page_size;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { results: st.all(...args), meta: { changes: 0, size_after: size() } };
    const r = st.run(...args);
    return { results: [], meta: { changes: Number(r.changes), size_after: size() } };
  };
  const stmt = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => stmt(sql, a),
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    first: async () => exec(sql, args).results[0] ?? null,
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => exec(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

export function fakeR2() {
  const objects = new Map();
  const body = (o) => ({
    customMetadata: o.customMetadata,
    httpMetadata: o.httpMetadata,
    arrayBuffer: async () => o.body.slice().buffer,
    text: async () => new TextDecoder().decode(o.body),
  });
  const toBytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(v));
  return {
    objects,
    async put(key, value, opts = {}) {
      objects.set(key, { body: toBytes(value), ...opts });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? body(o) : null;
    },
    async head(key) {
      const o = objects.get(key);
      return o ? { customMetadata: o.customMetadata } : null;
    },
    async createMultipartUpload(key, opts = {}) {
      const parts = new Map();
      return {
        async uploadPart(n, data) {
          parts.set(n, toBytes(data));
          return { partNumber: n, etag: `p${n}` };
        },
        async complete(list) {
          list.forEach((p, i) => {
            if (i < list.length - 1 && parts.get(p.partNumber).length < 5 * 1024 * 1024) throw new Error("part too small");
          });
          const chunks = list.map((p) => parts.get(p.partNumber));
          const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let o = 0;
          for (const c of chunks) {
            all.set(c, o);
            o += c.length;
          }
          objects.set(key, { body: all, ...opts });
        },
        async abort() {},
      };
    },
  };
}
