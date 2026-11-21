package com.metranos.trainradar;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Chooses what a new (or reconfigured) widget shows: one of your favourite
 * stations (departures, arrivals) or trains, in the order of Favoritos.
 * With none saved yet, it says how to save one.
 */
public class WidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        setResult(RESULT_CANCELED, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }
        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        String kind = ListWidget.kindOf(mgr.getAppWidgetInfo(widgetId));
        boolean en = WidgetStore.english(this);
        boolean trains = WidgetStore.TRAIN.equals(kind);
        JSONArray favs = WidgetStore.favourites(this, trains ? "train" : "station");

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        box.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setText(trains ? (en ? "Which train?" : "¿Qué tren?") : (en ? "Which station?" : "¿Qué estación?"));
        box.addView(title);
        TextView hint = new TextView(this);
        hint.setPadding(0, dp(6), 0, dp(10));
        box.addView(hint);
        if (favs.length() == 0) {
            hint.setText(trains
                    ? (en ? "Save a train with ☆ Save in TrainRadar first, then add the widget again."
                          : "Guarda antes un tren con ☆ Guardar en TrainRadar y vuelve a añadir el widget.")
                    : (en ? "Save a station with ☆ Save in TrainRadar first, then add the widget again."
                          : "Guarda antes una estación con ☆ Guardar en TrainRadar y vuelve a añadir el widget."));
            Button open = new Button(this);
            open.setText(en ? "Open TrainRadar" : "Abrir TrainRadar");
            open.setOnClickListener(x -> {
                startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                finish();
            });
            box.addView(open);
        } else {
            hint.setText(en ? "From your favourites:" : "De tus favoritos:");
            for (int i = 0; i < favs.length(); i++) {
                JSONObject f = favs.optJSONObject(i);
                if (f == null) continue;
                String id = trains ? f.optString("number") : f.optString("id");
                String name = trains ? f.optString("label", id) : f.optString("name", id);
                Button b = new Button(this);
                b.setAllCaps(false);
                b.setText(name);
                b.setOnClickListener(x -> choose(kind, id, name));
                box.addView(b, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            }
        }
        ScrollView scroll = new ScrollView(this);
        scroll.addView(box);
        setContentView(scroll);
    }

    private void choose(String kind, String id, String name) {
        WidgetStore.setConfig(this, widgetId, kind, id, name);
        ListWidget.render(this, AppWidgetManager.getInstance(this), widgetId);
        WidgetsWorker.schedule(this);
        WidgetStore.prefs(this).edit().putLong("last-run", 0).apply();
        WidgetsWorker.refreshNow(this);
        setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
        finish();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
