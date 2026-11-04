// Test-only module hooks: import `.wasm` the way Workers do (default export
// = WebAssembly.Module). Without a built engine (web/pkg, from
// tools/build-wasm.sh) both files resolve to stubs and the tests that need
// the engine skip. Use: node --import ./backend/test/hooks.mjs --test …
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const STUB = "trainradar-stub:";
export async function resolve(spec, ctx, next) {
  if (/\\/web\\/pkg\\/engine(_bg\\.wasm|\\.js)$/.test(spec) && ctx.parentURL) {
    const url = new URL(spec, ctx.parentURL);
    if (!existsSync(fileURLToPath(url))) return { url: STUB + spec, shortCircuit: true };
    if (spec.endsWith(".wasm")) return { url: url.href, format: "wasm-module-default", shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith(STUB)) {
    const src = url.endsWith(".wasm")
      ? "export default null;"
      : "export class Engine { constructor() { throw new Error('engine not built'); } } export function initSync() { throw new Error('engine not built'); }";
    return { format: "module", source: src, shortCircuit: true };
  }
  if (ctx.format === "wasm-module-default") {
    const bytes = readFileSync(fileURLToPath(url));
    return { format: "module", source: "export default new WebAssembly.Module(new Uint8Array([" + bytes.join(",") + "]));", shortCircuit: true };
  }
  return next(url, ctx);
}
`),
);
