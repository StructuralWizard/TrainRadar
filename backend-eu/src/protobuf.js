// Just enough of protobuf's wire format to filter GTFS-Realtime feeds
// without a schema compiler: read fields, keep the raw bytes of the ones we
// want, write them back. Field numbers are gtfs-realtime.proto v2.0's. No
// dependencies.

const td = new TextDecoder();

/** The fields of one message: [{ field, wire, value, raw }], in order.
 * `value` is a number (varint, as a JS number; fine for ids, times and
 * enums) or a Uint8Array (length-delimited); `raw` is the field's bytes,
 * key included, to copy as it is. */
export function fields(buf) {
  const out = [];
  let i = 0;
  const varint = () => {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (i >= buf.length) throw new Error("protobuf: truncated varint");
      const b = buf[i++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
  };
  while (i < buf.length) {
    const start = i;
    const key = varint();
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let value;
    if (wire === 0) value = varint();
    else if (wire === 1) (value = buf.subarray(i, i + 8)), (i += 8);
    else if (wire === 2) {
      const n = varint();
      if (i + n > buf.length) throw new Error("protobuf: truncated field");
      value = buf.subarray(i, i + n);
      i += n;
    } else if (wire === 5) (value = buf.subarray(i, i + 4)), (i += 4);
    else throw new Error(`protobuf: wire type ${wire}`);
    out.push({ field, wire, value, raw: buf.subarray(start, i) });
  }
  return out;
}

/** The first length-delimited field `n` as a sub-message, or null. */
export function sub(buf, n) {
  const f = fields(buf).find((x) => x.field === n && x.wire === 2);
  return f ? f.value : null;
}

/** All length-delimited fields `n`. */
export function subs(buf, n) {
  return fields(buf)
    .filter((x) => x.field === n && x.wire === 2)
    .map((x) => x.value);
}

/** The first string field `n`, or "". */
export function str(buf, n) {
  const v = buf ? sub(buf, n) : null;
  return v ? td.decode(v) : "";
}

/** Concatenate byte arrays. */
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
