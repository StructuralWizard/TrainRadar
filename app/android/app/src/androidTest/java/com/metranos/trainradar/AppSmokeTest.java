package com.metranos.trainradar;

import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.accessibilityservice.AccessibilityService;
import android.app.Activity;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import androidx.test.espresso.web.model.Atoms;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.TimeUnit;
import androidx.test.espresso.web.webdriver.Locator;
import androidx.test.ext.junit.rules.ActivityScenarioRule;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The app's test build (demo data and fixture feeds bundled, see
 * .github/workflows/android.yml): the map renders with trains, and a train
 * popup opens through the app's own search, without the free edition's
 * hidden details.
 */
@RunWith(AndroidJUnit4.class)
@LargeTest
public class AppSmokeTest {
    @Rule
    public ActivityScenarioRule<MainActivity> rule = new ActivityScenarioRule<>(MainActivity.class);

    /** Run a script in the page. A CI emulator can keep the page busy for
     * longer than Espresso-web's 10 s default (loading data), so allow 60 s
     * and retry twice before failing. */
    private static Object eval(String script) {
        RuntimeException last = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                return onWebView().withTimeout(60, TimeUnit.SECONDS).forceJavascriptEnabled()
                        .perform(Atoms.script(script)).get().getValue();
            } catch (RuntimeException e) {
                last = e;
            }
        }
        throw last;
    }

    private static void waitFor(String condition, long timeoutMs) throws InterruptedException {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            try {
                if (Boolean.TRUE.equals(eval("return !!(" + condition + ");"))) return;
            } catch (RuntimeException e) {
                // WebView not ready yet
            }
            Thread.sleep(500);
        }
        String state;
        try {
            state = String.valueOf(eval("return JSON.stringify({ href: location.href, status: (document.getElementById('status') || {}).textContent,"
                    + " stats: (document.getElementById('stats') || {}).textContent, engine: !!(window.__trainradar && window.__trainradar.engine),"
                    + " wasm: typeof WebAssembly, ua: navigator.userAgent });"));
        } catch (RuntimeException e) {
            state = "page not reachable: " + e;
        }
        throw new AssertionError("timed out waiting for: " + condition + "\npage: " + state);
    }

    @Test
    public void mapRendersAndATrainPopupOpens() throws Exception {
        waitFor("window.__trainradar && window.__trainradar.engine && window.__trainradar.engine.positions(Date.now()).length > 0", 90_000);
        waitFor("document.querySelector('.maplibregl-canvas')", 10_000);

        String number = (String) eval(
                "var e = window.__trainradar.engine, n = e.positions(Date.now()).length / 6;"
                        + "for (var i = 0; i < n; i++) { var t = JSON.parse(e.trainJson(i, Date.now()));"
                        + "  if (t.origin && !t.timetable_only) return t.number; }"
                        + "return null;");
        assertTrue("a matched train", number != null);
        eval("var q = document.getElementById('search-q'); q.value = '" + number + "';"
                + "q.dispatchEvent(new Event('input', { bubbles: true })); return true;");
        waitFor("document.querySelector('#search-results li button')", 10_000);
        onWebView().withTimeout(60, TimeUnit.SECONDS)
                .withElement(findElement(Locator.CSS_SELECTOR, "#search-results li button")).perform(webClick());
        waitFor("document.querySelector('.popup .popup-title')", 10_000);

        String popup = (String) eval("return document.querySelector('.popup').textContent;");
        assertTrue(popup, popup.contains(number.replaceFirst("^0+", "")));
        assertFalse("free edition hides gradients: " + popup, popup.contains("Pendiente"));
        assertTrue("favourite button", (Boolean) eval("return !!document.querySelector('.popup .fav-btn');"));
    }

    /**
     * My trips' exports go through Filesystem and Share: a CSV and a trip's
     * image card must reach Android's share sheet (the call stays pending
     * while the sheet is open) and not fail.
     */
    @Test
    public void exportsReachTheShareSheet() throws Exception {
        waitFor("window.__trainradar && window.__trainradar.exportFile", 90_000);
        share("window.__trainradar.exportFile('trainradar-test.csv', 'fecha;tren\\n2026-11-08;MD 1\\n', 'text/csv')");
        share("window.__trainradar.tripCard('es', { id: 'x', day: '2026-11-08', trainNo: '13911', label: 'MD 13911',"
                + " origin: 'Málaga', destination: 'Sevilla', schedArr: 1762600000, stops: [], arrDelayMin: 7, lastDelayMin: 7,"
                + " maxDelayMin: 9, estimated: false, endedAt: 1 })"
                + ".then(function (b) { if (!b) throw new Error('no image'); return window.__trainradar.exportBlob('trainradar-test.png', b); })");
    }

    private static void share(String promise) throws InterruptedException {
        eval("window.__shared = 'pending'; " + promise
                + ".then(function () { window.__shared = 'done'; }, function (e) { window.__shared = 'error: ' + (e && e.message || e); });"
                + " return true;");
        Thread.sleep(5_000);
        if (appInFront()) {
            // No share sheet came up: say why.
            String state = String.valueOf(eval("return window.__shared;"));
            throw new AssertionError("the share sheet didn't open; export: " + state);
        }
        // The sheet is open: close it (Back) and check the call didn't fail.
        InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
        long end = System.currentTimeMillis() + 15_000;
        while (!appInFront() && System.currentTimeMillis() < end) Thread.sleep(500);
        String after = String.valueOf(eval("return window.__shared;"));
        assertFalse("export failed: " + after, after.startsWith("error") && !after.toLowerCase().contains("cancel"));
    }

    /** Whether the app's own screen is in front (not the share sheet). */
    private static boolean appInFront() {
        final boolean[] front = { false };
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            for (Activity a : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED)) {
                if (a instanceof MainActivity) front[0] = true;
            }
        });
        return front[0];
    }
}
