import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { FrameReader, StompSession, encodeFrame, escapeHeader, unescapeHeader } from "./stomp.mjs";

const text = (b) => new TextDecoder().decode(b);

test("stomp: header escaping round-trips", () => {
  const v = "a:b\\c\nd";
  assert.equal(unescapeHeader(escapeHeader(v)), v);
});

test("stomp: frames split across chunks, heart-beats, content-length with NUL inside", () => {
  const r = new FrameReader();
  const a = encodeFrame("MESSAGE", { destination: "/topic/X", "message-id": "1" }, '[{"a":1}]');
  const body = new Uint8Array([65, 0, 66]);
  const head = new TextEncoder().encode("MESSAGE\ncontent-length:3\n\n");
  const b = new Uint8Array([...head, ...body, 0]);
  const all = new Uint8Array([10, ...a, 10, 10, ...b]);
  const frames = [];
  for (let i = 0; i < all.length; i += 7) frames.push(...r.push(all.slice(i, i + 7)));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].headers.destination, "/topic/X");
  assert.equal(text(frames[0].body), '[{"a":1}]');
  assert.deepEqual([...frames[1].body], [65, 0, 66]);
});

test("stomp: logs in, subscribes and receives from a fake broker", async () => {
  const seen = [];
  const server = net.createServer((sock) => {
    const r = new FrameReader();
    sock.on("data", (d) => {
      for (const f of r.push(new Uint8Array(d))) {
        seen.push(f);
        if (f.command === "CONNECT") {
          if (f.headers.passcode !== "p:w") sock.write(encodeFrame("ERROR", { message: "bad login" }));
          else sock.write(encodeFrame("CONNECTED", { version: "1.2" }));
        }
        if (f.command === "SUBSCRIBE") sock.write(encodeFrame("MESSAGE", { destination: f.headers.destination, subscription: f.headers.id }, '[{"header":{"msg_type":"0003"}}]'));
      }
    });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const open = () =>
    new Promise((resolve) => {
      const sock = net.connect(port, "127.0.0.1", () => resolve(sock));
    });

  const sock = await open();
  const got = [];
  const s = new StompSession({ write: (b) => sock.write(b), close: () => sock.end() }, { onMessage: (m) => got.push(m) });
  sock.on("data", (d) => s.receive(new Uint8Array(d)));
  await s.connect({ host: "x", login: "me", passcode: "p:w", extra: { "client-id": "c1" } });
  s.subscribe("/topic/TRAIN_MVT_ALL_TOC", { "activemq.subscriptionName": "s1" });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(got.length, 1);
  assert.equal(JSON.parse(text(got[0].body))[0].header.msg_type, "0003");
  const connect = seen.find((f) => f.command === "CONNECT");
  assert.equal(connect.headers["client-id"], "c1");
  assert.equal(seen.find((f) => f.command === "SUBSCRIBE").headers["activemq.subscriptionName"], "s1");
  s.disconnect();

  // A wrong password: connect() rejects with the broker's message.
  const sock2 = await open();
  const s2 = new StompSession({ write: (b) => sock2.write(b), close: () => sock2.end() });
  sock2.on("data", (d) => s2.receive(new Uint8Array(d)));
  await assert.rejects(s2.connect({ host: "x", login: "me", passcode: "nope" }), /bad login/);
  s2.disconnect();
  server.close();
});
