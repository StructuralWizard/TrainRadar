// A shareable image of one trip's delay (TrainRadar Pro, phase C5b): drawn
// on a canvas, nothing leaves the phone until the user shares it.
import { CONFIG } from "./config.js";
import { t } from "./i18n.js";

const COLORS = ["#16a34a", "#f59e0b", "#dc2626", "#6b7280"];

export function tripCard(lang, trip) {
  const w = 1080;
  const h = 608;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const d = trip.arrDelayMin ?? trip.lastDelayMin;
  const cls = d === null ? 3 : d < 5 ? 0 : d < 15 ? 1 : 2;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#1d4ed8";
  g.fillRect(0, 0, w, 96);
  g.fillStyle = "#ffffff";
  g.font = "bold 44px system-ui, sans-serif";
  g.fillText("TrainRadar", 48, 64);
  g.fillStyle = "#111827";
  g.font = "bold 64px system-ui, sans-serif";
  g.fillText(trip.label, 48, 200);
  g.font = "36px system-ui, sans-serif";
  g.fillStyle = "#374151";
  g.fillText(`${trip.origin} → ${trip.destination}`.slice(0, 48), 48, 262);
  g.fillText(trip.day.split("-").reverse().join("/"), 48, 314);
  g.fillStyle = COLORS[cls];
  g.font = "bold 120px system-ui, sans-serif";
  g.fillText(d === null ? "—" : d <= 0 ? t(lang, "cardOnTime") : `+${d} min`, 48, 470);
  g.font = "28px system-ui, sans-serif";
  g.fillStyle = "#6b7280";
  g.fillText(`${t(lang, "cardDelay")}${trip.estimated ? ` ${t(lang, "tripEstimated")}` : ""} · ${new URL(CONFIG.siteUrl).host}`, 48, 560);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}
