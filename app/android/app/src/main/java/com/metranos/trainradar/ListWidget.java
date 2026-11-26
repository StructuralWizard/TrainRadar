package com.metranos.trainradar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The TrainRadar Pro list widgets (phase C): next departures or arrivals of
 * a station, one train, or Renfe's notices. Add as many as you like; each
 * keeps its own station or train (WidgetStore). The data comes from
 * WidgetsWorker, every 15 minutes while a widget exists, or at once with ↻.
 * Drawing never downloads anything: it uses what was last saved.
 */
public abstract class ListWidget extends AppWidgetProvider {
    static final String ACTION_REFRESH = "com.metranos.trainradar.WIDGET_REFRESH";
    static final int[] ROWS = {R.id.w_row0, R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4, R.id.w_row5};
    static final Class<?>[] KINDS = {DeparturesWidget.class, ArrivalsWidget.class, TrainWidget.class, NoticesWidget.class};
    static final int INK = Color.rgb(17, 24, 39);

    /** WidgetStore.DEP, ARR, TRAIN or NOTICES. */
    abstract String kind();

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(ctx, mgr, id);
        WidgetsWorker.schedule(ctx);
        WidgetsWorker.refreshIfStale(ctx);
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        WidgetStore.remove(ctx, ids);
    }

    @Override
    public void onDisabled(Context ctx) {
        if (allIds(ctx).isEmpty()) WidgetsWorker.cancel(ctx);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            WidgetsWorker.refreshNow(ctx);
            return;
        }
        super.onReceive(ctx, intent);
    }

    /** Every list widget on the home screen, of all four kinds. */
    static List<Integer> allIds(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        List<Integer> out = new ArrayList<>();
        for (Class<?> c : KINDS) {
            for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, c))) out.add(id);
        }
        return out;
    }

    static String kindOf(AppWidgetProviderInfo info) {
        if (info == null) return "";
        String c = info.provider.getClassName();
        if (c.endsWith(".DeparturesWidget")) return WidgetStore.DEP;
        if (c.endsWith(".ArrivalsWidget")) return WidgetStore.ARR;
        if (c.endsWith(".TrainWidget")) return WidgetStore.TRAIN;
        if (c.endsWith(".NoticesWidget")) return WidgetStore.NOTICES;
        return "";
    }

    static void renderAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : allIds(ctx)) render(ctx, mgr, id);
    }

    /** The cache key of what widget `cfg` shows. */
    static String dataKey(String kind, JSONObject cfg) {
        if (WidgetStore.NOTICES.equals(kind)) return "notices";
        if (WidgetStore.TRAIN.equals(kind)) return "train:" + cfg.optString("id");
        return "board:" + cfg.optString("id");
    }

    static void render(Context ctx, AppWidgetManager mgr, int id) {
        String kind = kindOf(mgr.getAppWidgetInfo(id));
        if (kind.isEmpty()) return;
        String lang = WidgetStore.lang(ctx);
        JSONObject cfg = WidgetStore.config(ctx, id);
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_list);
        for (int r : ROWS) {
            v.setTextViewText(r, "");
            v.setTextColor(r, INK);
        }
        String name = cfg.optString("name", "");
        String title;
        switch (kind) {
            case WidgetStore.DEP:
                title = Tr.pick(lang, "Salidas · ", "Departures · ", "Partidas · ", "出発 · ") + name;
                break;
            case WidgetStore.ARR:
                title = Tr.pick(lang, "Llegadas · ", "Arrivals · ", "Chegadas · ", "到着 · ") + name;
                break;
            case WidgetStore.TRAIN:
                title = name.isEmpty() ? Tr.pick(lang, "Tren", "Train", "Comboio", "列車") : name;
                break;
            default:
                title = Tr.pick(lang, "Avisos de Renfe", "Renfe notices", "Avisos da Renfe", "Renfeのお知らせ");
        }
        v.setTextViewText(R.id.w_title, title);
        v.setOnClickPendingIntent(R.id.w_root, openApp(ctx, id, kind, cfg));
        Intent refresh = new Intent(ACTION_REFRESH).setComponent(mgr.getAppWidgetInfo(id).provider);
        v.setOnClickPendingIntent(R.id.w_refresh,
                PendingIntent.getBroadcast(ctx, 100_000 + id, refresh, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        if (!WidgetStore.pro(ctx)) {
            line(v, 0, Tr.pick(lang, "Este widget es parte de TrainRadar Pro.", "This widget is part of TrainRadar Pro.", "Este widget faz parte do TrainRadar Pro.", "このウィジェットは TrainRadar Pro の機能です。"), Widget.GREY);
            v.setTextViewText(R.id.w_sub, "");
            mgr.updateAppWidget(id, v);
            return;
        }
        if (!WidgetStore.NOTICES.equals(kind) && cfg.optString("id").isEmpty()) {
            line(v, 0, Tr.pick(lang, "Toca para elegir una estación o un tren.", "Tap to choose a station or train.", "Toque para escolher uma estação ou um comboio.", "タップして駅または列車を選択"), Widget.GREY);
            mgr.updateAppWidget(id, v);
            return;
        }
        String key = dataKey(kind, cfg);
        String json = WidgetStore.cached(ctx, key);
        long at = WidgetStore.cachedAt(ctx, key);
        v.setTextViewText(R.id.w_sub, at == 0
                ? Tr.pick(lang, "Actualizando…", "Updating…", "A atualizar…", "更新中…")
                : Tr.pick(lang, "Actualizado ", "Updated ", "Atualizado ", "更新 ") + clock(at / 1000));
        try {
            if (json == null) {
                // nothing yet: the worker is on its way
            } else if (WidgetStore.NOTICES.equals(kind)) {
                notices(v, new JSONObject(json), lang);
            } else if (WidgetStore.TRAIN.equals(kind)) {
                train(v, new JSONObject(json), lang);
            } else {
                board(v, new JSONObject(json).optJSONArray(WidgetStore.DEP.equals(kind) ? "departures" : "arrivals"), kind, lang);
            }
        } catch (Exception e) {
            line(v, 0, Tr.pick(lang, "Aún sin datos.", "No data yet.", "Ainda sem dados.", "データはまだありません。"), Widget.GREY);
        }
        mgr.updateAppWidget(id, v);
    }

    /** Tapping the widget opens its station or train in the app. */
    static PendingIntent openApp(Context ctx, int id, String kind, JSONObject cfg) {
        Intent i;
        String item = cfg.optString("id");
        if (WidgetStore.NOTICES.equals(kind) || item.isEmpty()) {
            i = new Intent(ctx, MainActivity.class);
        } else {
            String host = WidgetStore.TRAIN.equals(kind) ? "train" : "station";
            i = new Intent(Intent.ACTION_VIEW, Uri.parse("trainradar://" + host + "/" + Uri.encode(item)), ctx, MainActivity.class);
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void board(RemoteViews v, JSONArray rows, String kind, String lang) {
        if (rows == null || rows.length() == 0) {
            line(v, 0, Tr.pick(lang, "Sin trenes en las próximas 3 horas.", "No trains in the next 3 hours.", "Sem comboios nas próximas 3 horas.", "今後3時間に列車はありません。"), Widget.GREY);
            return;
        }
        String arrow = WidgetStore.DEP.equals(kind) ? " → " : " ← ";
        for (int i = 0; i < rows.length() && i < ROWS.length; i++) {
            JSONObject r = rows.optJSONObject(i);
            if (r == null) continue;
            SpannableStringBuilder s = new SpannableStringBuilder();
            bold(s, clock(r.optLong("sched")));
            s.append("  ");
            String route = r.optString("route");
            s.append(route.isEmpty() ? "" : route + " ").append(AlertRules.number(r.optString("number")));
            s.append(arrow).append(r.optString("place"));
            status(s, r.optBoolean("canceled"), r.isNull("delay") ? null : r.optInt("delay") / 60, lang, false);
            v.setTextViewText(ROWS[i], s);
        }
    }

    static void train(RemoteViews v, JSONObject t, String lang) {
        if (!t.optBoolean("running")) {
            line(v, 0, Tr.pick(lang, "No circula ahora.", "Not running now.", "Não circula agora.", "現在運行していません。"), Widget.GREY);
            return;
        }
        SpannableStringBuilder s0 = new SpannableStringBuilder();
        String route = t.optString("route");
        bold(s0, (route.isEmpty() ? "" : route + " ") + AlertRules.number(t.optString("number")));
        s0.append(" → ").append(t.optString("destination", "?"));
        v.setTextViewText(ROWS[0], s0);
        SpannableStringBuilder s1 = new SpannableStringBuilder();
        status(s1, t.optBoolean("canceled"), t.isNull("delay") ? null : t.optInt("delay") / 60, lang, true);
        v.setTextViewText(ROWS[1], s1);
        if (!t.isNull("nextStop")) {
            String when = t.isNull("nextArrival") ? "" : " · " + clock(t.optLong("nextArrival"));
            v.setTextViewText(ROWS[2], Tr.pick(lang, "Próxima parada: ", "Next stop: ", "Próxima paragem: ", "次の停車駅: ") + t.optString("nextStop") + when);
        }
        if (!t.isNull("origin")) v.setTextViewText(ROWS[3], Tr.pick(lang, "Desde ", "From ", "De ", "始発 ") + t.optString("origin"));
    }

    static void notices(RemoteViews v, JSONObject doc, String lang) {
        JSONArray list = doc.optJSONArray("notices");
        if (list == null || list.length() == 0) {
            line(v, 0, Tr.pick(lang, "Ningún aviso en vigor.", "No notices in force.", "Nenhum aviso em vigor.", "現在お知らせはありません。"), Widget.GREY);
            return;
        }
        for (int i = 0; i < list.length() && i < ROWS.length; i++) {
            JSONObject n = list.optJSONObject(i);
            if (n == null) continue;
            SpannableStringBuilder s = new SpannableStringBuilder();
            JSONArray lines = n.optJSONArray("lines");
            if (lines != null && lines.length() > 0) {
                StringBuilder l = new StringBuilder();
                for (int k = 0; k < lines.length() && k < 3; k++) l.append(k > 0 ? " " : "").append(lines.optString(k));
                bold(s, l + "  ");
            }
            s.append(n.optString("text").replace('\n', ' '));
            v.setTextViewText(ROWS[i], s);
        }
    }

    /** " +5'" / "a su hora" / "cancelado", coloured like the map. */
    static void status(SpannableStringBuilder s, boolean canceled, Integer delayMin, String lang, boolean full) {
        String text;
        int color;
        if (canceled) {
            text = Tr.pick(lang, "cancelado", "cancelled", "suprimido", "運休");
            color = Widget.RED;
        } else if (delayMin == null) {
            if (!full) return;
            text = Tr.pick(lang, "sin retraso en directo", "no live delay", "sem atraso em direto", "リアルタイム遅延なし");
            color = Widget.GREY;
        } else if (delayMin <= 0) {
            text = full ? Tr.pick(lang, "a su hora", "on time", "à hora", "定刻") : "✓";
            color = Widget.GREEN;
        } else {
            text = "+" + delayMin + " min";
            color = delayMin < 5 ? Widget.GREEN : delayMin < 15 ? Widget.AMBER : Widget.RED;
        }
        if (s.length() > 0) s.append("  ");
        int start = s.length();
        s.append(text);
        s.setSpan(new ForegroundColorSpan(color), start, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        s.setSpan(new StyleSpan(Typeface.BOLD), start, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void bold(SpannableStringBuilder s, String text) {
        int start = s.length();
        s.append(text);
        s.setSpan(new StyleSpan(Typeface.BOLD), start, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    }

    static void line(RemoteViews v, int row, String text, int color) {
        v.setTextViewText(ROWS[row], text);
        v.setTextColor(ROWS[row], color);
    }

    /** HH:mm in Madrid (the widgets follow Spain's trains, in either country). */
    static String clock(long unixSecs) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.ROOT);
        f.setTimeZone(TimeZone.getTimeZone("Europe/Madrid"));
        return f.format(new Date(unixSecs * 1000));
    }
}
