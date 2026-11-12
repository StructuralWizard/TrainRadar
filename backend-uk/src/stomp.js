// A minimal STOMP 1.2 client over a duplex byte stream, no dependencies:
// enough to log in, subscribe and read MESSAGE frames from Network Rail's
// open-data broker (ActiveMQ). The transport is passed in (Node's `net`
// socket here; Cloudflare's `connect()` socket later), so the frame code
// is the same in the feed check and in the UK ingest Worker.

const NUL = 0;
const LF = 10;

/** Escape a header value (STOMP 1.2 §Value Encoding). */
export function escapeHeader(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/:/g, "\\c");
}

export function unescapeHeader(v) {
  return v.replace(/\\(.)/g, (_, c) => ({ r: "\r", n: "\n", c: ":", "\\": "\\" })[c] ?? c);
}

/** One frame as bytes. */
export function encodeFrame(command, headers = {}, body = "") {
  const head = [command, ...Object.entries(headers).map(([k, v]) => `${escapeHeader(k)}:${escapeHeader(v)}`)].join("\n");
  return new TextEncoder().encode(`${head}\n\n${body}\0`);
}

/**
 * Splits a byte stream into frames. Feed it chunks with `push`; it returns
 * the complete frames ({ command, headers, body: Uint8Array }) found so far.
 * Heart-beats (bare newlines between frames) are skipped.
 */
export class FrameReader {
  constructor() {
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const frames = [];
    for (;;) {
      let start = 0;
      while (start < this.buf.length && (this.buf[start] === LF || this.buf[start] === 13)) start++;
      // Header block ends at the first blank line.
      let headEnd = -1;
      for (let i = start; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === LF && this.buf[i + 1] === LF) {
          headEnd = i;
          break;
        }
        if (this.buf[i] === LF && this.buf[i + 1] === 13 && this.buf[i + 2] === LF) {
          headEnd = i;
          break;
        }
      }
      if (headEnd < 0) {
        this.buf = this.buf.slice(start);
        return frames;
      }
      const lines = new TextDecoder().decode(this.buf.slice(start, headEnd)).split(/\r?\n/);
      const command = lines.shift();
      const headers = {};
      for (const l of lines) {
        const k = l.indexOf(":");
        if (k < 0) continue;
        const name = unescapeHeader(l.slice(0, k));
        if (!(name in headers)) headers[name] = command === "CONNECTED" ? l.slice(k + 1) : unescapeHeader(l.slice(k + 1));
      }
      const bodyStart = this.buf[headEnd + 1] === 13 ? headEnd + 3 : headEnd + 2;
      let bodyEnd;
      if (headers["content-length"] !== undefined) {
        bodyEnd = bodyStart + Number(headers["content-length"]);
        if (this.buf.length <= bodyEnd) {
          this.buf = this.buf.slice(start);
          return frames;
        }
      } else {
        bodyEnd = this.buf.indexOf(NUL, bodyStart);
        if (bodyEnd < 0) {
          this.buf = this.buf.slice(start);
          return frames;
        }
      }
      frames.push({ command, headers, body: this.buf.slice(bodyStart, bodyEnd) });
      this.buf = this.buf.slice(bodyEnd + 1);
    }
  }
}

/**
 * A STOMP session on `transport` ({ write(bytes), close() }; call
 * `session.receive(chunk)` with each chunk read). `onFrame` gets every
 * MESSAGE frame; the returned promise of `connect()` settles on CONNECTED
 * or ERROR.
 */
export class StompSession {
  constructor(transport, { onMessage = () => {}, onError = () => {} } = {}) {
    this.transport = transport;
    this.reader = new FrameReader();
    this.onMessage = onMessage;
    this.onError = onError;
    this.waiting = null;
    this.subs = 0;
  }

  receive(chunk) {
    for (const f of this.reader.push(chunk)) {
      if (f.command === "CONNECTED") {
        this.waiting?.resolve(f.headers);
        this.waiting = null;
      } else if (f.command === "ERROR") {
        const err = new Error(`STOMP ERROR: ${f.headers.message || new TextDecoder().decode(f.body).slice(0, 200)}`);
        if (this.waiting) {
          this.waiting.reject(err);
          this.waiting = null;
        } else this.onError(err);
      } else if (f.command === "MESSAGE") {
        this.onMessage(f);
      } else if (f.command === "RECEIPT") {
        // not used
      }
    }
  }

  /** Log in. `extra`: e.g. { "client-id": … } for durable subscriptions. */
  connect({ host, login, passcode, heartbeat = "0,0", extra = {} }) {
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.transport.write(encodeFrame("CONNECT", { "accept-version": "1.2", host, login, passcode, "heart-beat": heartbeat, ...extra }));
    });
  }

  subscribe(destination, extra = {}) {
    const id = `sub-${++this.subs}`;
    this.transport.write(encodeFrame("SUBSCRIBE", { id, destination, ack: "auto", ...extra }));
    return id;
  }

  /** Unsubscribe; with a durable name header, Artemis deletes the subscription. */
  unsubscribe(id, extra = {}) {
    this.transport.write(encodeFrame("UNSUBSCRIBE", { id, ...extra }));
  }

  disconnect() {
    try {
      this.transport.write(encodeFrame("DISCONNECT", {}));
    } catch {
      // already closed
    }
    this.transport.close();
  }
}
