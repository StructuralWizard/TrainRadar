import init, { version, delayClass } from "./pkg/engine.js";
const el = document.getElementById("status");
try {
  await init();
  el.textContent = `Motor ${version()} listo (prueba: 7 min → clase ${delayClass(420)}).`;
} catch (e) {
  el.textContent = "No se pudo cargar el motor. Ejecuta tools/build-wasm.sh.";
  console.error(e);
}
