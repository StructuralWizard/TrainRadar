package com.metranos.trainradar;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Alerts for saved journeys (TrainRadar Pro, plan journeys J4), as pure
 * logic so it can be unit-tested. A commute (web/js/commutes.js) can hold
 * a journey: its trains ("legs": number, from, to, dep and arr "HH:MM"
 * in Madrid, walk seconds before it), its days (1 Monday … 7 Sunday), a
 * reminder (minutes before leaving) and which alerts ("notify").
 *
 * On its days, from an hour before leaving (or the reminder, if earlier)
 * until half an hour after arriving, each check notifies once per event:
 * a train late (≥ 5, then ≥ 15 min) or cancelled; a change with less than
 * five minutes left, or missed; the reminder; a platform change; a
 * station notice (lifts, works, buses…) at one of its stations.
 */
public final class JourneyRules {
    private JourneyRules() {}

    static final TimeZone MADRID = TimeZone.getTimeZone("Europe/Madrid");
    static final long MIN = 60_000L;
    /** Below this, a change is at risk (as web/js/commutes.js). */
    static final long CHANGE_RISK_MS = 5 * MIN;
    static final int MINOR = 5;
    static final int MAJOR = 15;

    /** A saved journey running today: its legs' times as epoch ms. */
    public static final class Active {
        public final int index;
        public final JSONObject journey;
        public final JSONArray legs;
        public final long[] dep;
        public final long[] arr;
        public final String title;

        Active(int index, JSONObject journey, long[] dep, long[] arr, String title) {
            this.index = index;
            this.journey = journey;
            this.legs = journey.optJSONArray("legs");
            this.dep = dep;
            this.arr = arr;
            this.title = title;
        }

        boolean notify(String kind) {
            JSONObject n = journey.optJSONObject("notify");
            return n == null || n.optBoolean(kind, true);
        }

        /** The journey's station ids. */
        List<String> stations() {
            List<String> out = new ArrayList<>();
            for (int i = 0; i < legs.length(); i++) {
                JSONObject l = legs.optJSONObject(i);
                for (String k : new String[] {"from", "to"}) {
                    String id = l.optString(k);
                    if (!id.isEmpty() && !out.contains(id)) out.add(id);
                }
            }
            return out;
        }
    }

    public static final class Alert {
        public final String key;
        public final String trainNo;
        public final String title;
        public final String body;

        Alert(String key, String trainNo, String title, String body) {
            this.key = key;
            this.trainNo = trainNo;
            this.title = title;
            this.body = body;
        }
    }

    /** Midnight today in Madrid, and today's ISO day (1 Monday … 7 Sunday). */
    static Calendar today(long nowMs) {
        Calendar c = Calendar.getInstance(MADRID, Locale.ROOT);
        c.setTimeInMillis(nowMs);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    static int isoDay(Calendar c) {
        int d = c.get(Calendar.DAY_OF_WEEK); // Sunday 1 … Saturday 7
        return d == Calendar.SUNDAY ? 7 : d - 1;
    }

    static long at(Calendar midnight, String hm) {
        Calendar c = (Calendar) midnight.clone();
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hm.substring(0, 2)));
        c.set(Calendar.MINUTE, Integer.parseInt(hm.substring(3, 5)));
        return c.getTimeInMillis();
    }

    /**
     * The saved journeys running now or soon (see the class comment), from
     * the commutes as stored ({list: [{from, to, journey?}], …}).
     */
    public static List<Active> active(JSONObject commutes, long nowMs) {
        List<Active> out = new ArrayList<>();
        JSONArray list = commutes.optJSONArray("list");
        if (list == null) return out;
        Calendar midnight = today(nowMs);
        int day = isoDay(midnight);
        for (int i = 0; i < list.length(); i++) {
            JSONObject c = list.optJSONObject(i);
            JSONObject j = c == null ? null : c.optJSONObject("journey");
            JSONArray legs = j == null ? null : j.optJSONArray("legs");
            if (legs == null || legs.length() == 0 || !hasDay(j.optJSONArray("days"), day)) continue;
            long[] dep = new long[legs.length()];
            long[] arr = new long[legs.length()];
            try {
                for (int k = 0; k < legs.length(); k++) {
                    JSONObject l = legs.getJSONObject(k);
                    dep[k] = at(midnight, l.getString("dep"));
                    // Across midnight: a time well before the previous
                    // arrival is the next day.
                    if (k > 0 && dep[k] < arr[k - 1] - 12 * 60 * MIN) dep[k] += 24 * 60 * MIN;
                    arr[k] = at(midnight, l.getString("arr"));
                    while (arr[k] < dep[k]) arr[k] += 24 * 60 * MIN;
                }
            } catch (Exception e) {
                continue; // malformed: the app validates, skip anything else
            }
            long before = Math.max(60, j.optInt("remind", 30)) * MIN;
            if (nowMs < dep[0] - before || nowMs > arr[arr.length - 1] + 30 * MIN) continue;
            JSONObject first = legs.optJSONObject(0);
            JSONObject last = legs.optJSONObject(legs.length() - 1);
            String title = first.optString("from_name", first.optString("from")) + " → "
                    + last.optString("to_name", last.optString("to")) + " · " + first.optString("dep");
            out.add(new Active(i, j, dep, arr, title));
        }
        return out;
    }

    static boolean hasDay(JSONArray days, int day) {
        if (days == null) return day <= 5;
        for (int i = 0; i < days.length(); i++) if (days.optInt(i) == day) return true;
        return false;
    }

    /** A leg's train today: {delaySec (or absent), canceled, platform}. */
    static JSONObject legState(JSONObject leg, JSONObject run, JSONArray summary) throws JSONException {
        JSONObject out = new JSONObject();
        JSONObject live = AlertRules.find(summary, AlertRules.number(leg.optString("number")));
        if (run != null && run.optBoolean("found")) {
            if (!run.isNull("delay")) out.put("delay", run.optInt("delay"));
            out.put("canceled", run.optBoolean("canceled"));
        } else if (live != null) {
            if (!live.isNull("delayMin")) out.put("delay", live.optInt("delayMin") * 60);
            out.put("canceled", "cancelled".equals(live.optString("status")));
        }
        if (live != null && leg.optString("from").equals(live.optString("nextStopId")) && !live.isNull("platform")) {
            out.put("platform", live.optString("platform"));
        }
        return out;
    }

    /**
     * @param runs per active journey, per leg: GET /v1/live/run/:from/:number
     *     (null where not asked, e.g. after it left)
     * @param notices GET /v1/live/notices/all "notices" (null if not asked)
     * @param state stored between checks — updated in place
     */
    public static List<Alert> decide(List<Active> active, List<JSONObject[]> runs, JSONArray summary,
            JSONArray notices, JSONObject state, long nowMs, String lang) throws JSONException {
        String day = String.valueOf(today(nowMs).getTimeInMillis());
        if (!day.equals(state.optString("day"))) {
            state.put("day", day);
            state.put("sent", new JSONObject());
            state.put("platform", new JSONObject());
        }
        JSONObject sent = state.getJSONObject("sent");
        JSONObject platforms = state.getJSONObject("platform");
        List<Alert> out = new ArrayList<>();
        for (int a = 0; a < active.size(); a++) {
            Active j = active.get(a);
            String p = "j" + j.index + ":";
            JSONObject[] legRuns = a < runs.size() ? runs.get(a) : new JSONObject[0];
            JSONObject[] st = new JSONObject[j.legs.length()];
            for (int i = 0; i < st.length; i++) {
                st[i] = legState(j.legs.getJSONObject(i), i < legRuns.length ? legRuns[i] : null, summary);
            }
            // Delays and cancellations: when a train's level rises.
            if (j.notify("delay")) {
                for (int i = 0; i < st.length; i++) {
                    JSONObject l = j.legs.getJSONObject(i);
                    int lv = st[i].optBoolean("canceled") ? 3 : level(st[i]);
                    String k = p + "level:" + i;
                    if (lv > sent.optInt(k, 0)) {
                        sent.put(k, lv);
                        String body = train(l) + ": " + (lv == 3 ? Tr.pick(lang, "cancelado — mira otras opciones", "cancelled — see other options", "suprimido — veja outras opções", "運休 — 他の経路をご確認ください")
                                : AlertRules.text(lang, lv, st[i].optInt("delay") / 60));
                        out.add(new Alert(p + "delay:" + i, l.optString("number"), j.title, body));
                    }
                }
            }
            // Changes: at risk (< 5 min) or missed, once each.
            if (j.notify("risk")) {
                for (int i = 1; i < st.length; i++) {
                    JSONObject l = j.legs.getJSONObject(i);
                    long margin = j.dep[i] + st[i].optInt("delay") * 1000L
                            - (j.arr[i - 1] + st[i - 1].optInt("delay") * 1000L) - l.optInt("walk") * 1000L;
                    if (margin >= CHANGE_RISK_MS) continue;
                    String station = l.optString("from_name", l.optString("from"));
                    String k = p + (margin < 0 ? "missed:" : "risk:") + i;
                    if (sent.has(k)) continue;
                    sent.put(k, true);
                    String body = margin < 0
                            ? String.format(Locale.ROOT, Tr.pick(lang, "Pierdes el cambio en %1$s al %2$s: mira otras opciones",
                                    "You'll miss the change at %1$s to %2$s: see other options",
                                    "Vai perder o transbordo em %1$s para o %2$s: veja outras opções",
                                    "%1$sでの%2$sへの乗り換えに間に合いません。他の経路をご確認ください"), station, train(l))
                            : String.format(Locale.ROOT, Tr.pick(lang, "Enlace en riesgo en %s: quedan %d min para el %s",
                                    "Change at %s at risk: %d min left for the %s",
                                    "Transbordo em risco em %s: faltam %d min para o %s",
                                    "%1$sでの乗り換えが危うい：%3$sまで残り%2$d分"), station, margin / MIN, train(l));
                    out.add(new Alert(p + "risk:" + i, l.optString("number"), j.title, body));
                }
            }
            // The reminder, once, from `remind` minutes before leaving.
            int remind = j.journey.optInt("remind", 30);
            if (j.notify("remind") && remind > 0 && nowMs >= j.dep[0] - remind * MIN && nowMs < j.dep[0] && !sent.has(p + "remind")) {
                sent.put(p + "remind", true);
                JSONObject l = j.legs.getJSONObject(0);
                String how = st[0].optBoolean("canceled") ? Tr.pick(lang, "cancelado", "cancelled", "suprimido", "運休")
                        : st[0].has("delay") && st[0].optInt("delay") >= 60
                                ? String.format(Locale.ROOT, Tr.pick(lang, "%d min de retraso", "%d min late", "%d min de atraso", "%d分遅れ"), st[0].optInt("delay") / 60)
                                : Tr.pick(lang, "a su hora", "on time", "à hora", "定刻");
                String body = String.format(Locale.ROOT, Tr.pick(lang, "Sales a las %s: %s %s", "You leave at %s: %s %s",
                        "Parte às %s: %s %s", "%s発：%s %s"), l.optString("dep"), train(l), how);
                out.add(new Alert(p + "remind", l.optString("number"), j.title, body));
            }
            // Platforms: notified when one changes after it was first seen.
            if (j.notify("platform")) {
                for (int i = 0; i < st.length; i++) {
                    if (!st[i].has("platform")) continue;
                    String k = p + i;
                    String now = st[i].optString("platform");
                    String before = platforms.optString(k, "");
                    platforms.put(k, now);
                    if (before.isEmpty() || before.equals(now)) continue;
                    JSONObject l = j.legs.getJSONObject(i);
                    out.add(new Alert(p + "platform:" + i, l.optString("number"), j.title,
                            String.format(Locale.ROOT, Tr.pick(lang, "%1$s sale ahora por la vía %2$s (antes %3$s)",
                                    "%1$s now leaves from platform %2$s (was %3$s)",
                                    "%1$s parte agora da linha %2$s (antes %3$s)",
                                    "%1$sの発車番線が%3$s番線から%2$s番線に変更"), train(l), now, before)));
                }
            }
            // Station notices on the way, each once a day.
            if (j.notify("stations") && notices != null) {
                List<String> mine = j.stations();
                for (int n = 0; n < notices.length(); n++) {
                    JSONObject x = notices.optJSONObject(n);
                    JSONArray stops = x == null ? null : x.optJSONArray("stops");
                    if (stops == null) continue;
                    boolean hit = false;
                    for (int s = 0; s < stops.length() && !hit; s++) hit = mine.contains(stops.optString(s));
                    String k = p + "notice:" + x.optString("id");
                    if (!hit || sent.has(k)) continue;
                    sent.put(k, true);
                    String text = x.optString("text");
                    if (text.length() > 200) text = text.substring(0, 199) + "…";
                    out.add(new Alert(p + "notice:" + x.optString("id"), j.legs.getJSONObject(0).optString("number"),
                            j.title + " · " + kind(x.optString("kind"), lang), text));
                }
            }
        }
        return out;
    }

    static int level(JSONObject legState) {
        if (!legState.has("delay")) return 0;
        int m = legState.optInt("delay") / 60;
        return m >= MAJOR ? 2 : m >= MINOR ? 1 : 0;
    }

    static String train(JSONObject leg) {
        String r = leg.optString("route");
        return (r.isEmpty() ? "" : r + " ") + AlertRules.number(leg.optString("number"));
    }

    static String kind(String k, String lang) {
        switch (k) {
            case "accessibility":
                return Tr.pick(lang, "ascensores y accesos", "lifts and access", "elevadores e acessos", "エレベーター・バリアフリー");
            case "works":
                return Tr.pick(lang, "obras", "works", "obras", "工事");
            case "strike":
                return Tr.pick(lang, "huelga", "strike", "greve", "ストライキ");
            case "disruption":
                return Tr.pick(lang, "incidencia", "disruption", "perturbação", "運行障害");
            default:
                return Tr.pick(lang, "aviso", "notice", "aviso", "お知らせ");
        }
    }
}
