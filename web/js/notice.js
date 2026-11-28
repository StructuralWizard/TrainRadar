// "Compartir aviso": a traveller tells their own people what's happening
// with a train, through the phone's share sheet (WhatsApp, Telegram, a
// commuters' group…) or, without one, the clipboard. A fixed choice and the
// train's details make the message; nothing is sent to TrainRadar, nothing
// is stored (docs/plan-crowd-reports.md, "share to your own chat").

import { t } from "./i18n.js";
import { delayMinutes, upcomingStops } from "./sheetui.js";

/** The choices, in the order shown. */
export const NOTICE_KINDS = ["late", "stopped", "noshow", "crowded", "incident"];

const LABEL = { late: "noticeLate", stopped: "noticeStopped", noshow: "noticeNoShow", crowded: "noticeCrowded", incident: "noticeIncident" };

export const noticeLabel = (lang, kind) => t(lang, LABEL[kind]);

/**
 * The message: "⚠️ 2C45 → London Euston: Stopped · Now: between A and B ·
 * Official: +12 min" and a line saying where it came from. `title`: the
 * train's name as the app shows it; `stops`: its trip (tripJson stops);
 * `nowSecs`: Unix seconds.
 */
export function noticeText(lang, kind, info, { title, stops = [], nowSecs } = {}) {
  const head = `⚠️ ${title || info.number || ""}${info.destination ? ` → ${info.destination}` : ""}: ${noticeLabel(lang, kind)}`;
  const parts = [head];
  const up = upcomingStops(stops, info.next_stop, info.delay, nowSecs);
  const nextIdx = up.length ? stops.length - up.length : -1;
  if (nextIdx > 0) parts.push(t(lang, "nowBetween", { a: stops[nextIdx - 1].name, b: up[0].name }));
  else if (up.length) parts.push(t(lang, "noticeNext", { stop: up[0].name }));
  if (!info.timetable_only) {
    const official = info.canceled
      ? t(lang, "canceled")
      : info.delay === null || info.delay === undefined
        ? null
        : delayMinutes(info.delay) <= 0
          ? t(lang, "onTime")
          : t(lang, "late", { m: delayMinutes(info.delay) });
    if (official) parts.push(t(lang, "noticeOfficial", { status: official }));
  }
  return `${parts.join(" · ")}\n${t(lang, "noticeVia")}`;
}
