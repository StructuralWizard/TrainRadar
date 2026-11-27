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
    /** JS: how the current page was loaded, for a reload's failure message. */
    private static final String RELOAD_INFO =
            "JSON.stringify({ navigation: (performance.getEntriesByType('navigation')[0] || {}).type, sinceLoadMs: Math.round(performance.now()) })";

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
        // Mark this page load: if the WebView reloads the page mid-test (seen
        // on CI: the app's state vanished between two checks), the mark goes
        // and the failure says so instead of a bare null.
        eval("window.__smokeMark = performance.timeOrigin; return true;");

        String number = (String) eval(
                "if (!window.__trainradar) return 'RELOADED ' + " + RELOAD_INFO + ";"
                        + "var e = window.__trainradar.engine, n = e.positions(Date.now()).length / 6;"
                        + "for (var i = 0; i < n; i++) { var t = JSON.parse(e.trainJson(i, Date.now()));"
                        + "  if (t.origin && !t.timetable_only && t.next_stop && t.next_stop !== t.destination) return t.number; }"
                        + "return null;");
        assertTrue("a matched train", number != null);
        assertTrue(number, !number.startsWith("RELOADED"));
        eval("var q = document.getElementById('search-q'); q.value = '" + number + "';"
                + "q.dispatchEvent(new Event('input', { bubbles: true })); return true;");
        waitFor("document.querySelector('#search-results li button')", 10_000);
        onWebView().withTimeout(60, TimeUnit.SECONDS)
                .withElement(findElement(Locator.CSS_SELECTOR, "#search-results li button")).perform(webClick());
        // The map flies to the train first: slow on the emulator (one run
        // took over 10 s), so give it time.
        waitFor("document.querySelector('.popup .popup-title')", 30_000);

        String popup = (String) eval("var p = document.querySelector('.popup');"
                + "return p ? p.textContent : 'NO POPUP: ' + (window.__smokeMark ? 'same page, sheet closed' : 'the page reloaded, ' + " + RELOAD_INFO + ");");
        assertTrue(popup, popup.contains(number.replaceFirst("^0+", "")));
        // The train details ("Más datos": origin, track…) are free, as on the web. The
        // trains ahead and behind are cards only when there is one.
        assertTrue("free edition shows the train details: " + popup, popup.contains("Más datos"));
        String fav = (String) eval("var p = document.querySelector('.popup');"
                + "return !p ? 'NO POPUP: ' + (window.__smokeMark ? 'same page, sheet closed' : 'the page reloaded, ' + " + RELOAD_INFO + ")"
                + " : p.querySelector('.fav-btn') ? 'ok' : 'popup without it: ' + p.className;");
        assertTrue("favourite button: " + fav, "ok".equals(fav));
    }

    /**
     * The UK (plan 3) through the network chip's picker: the page reloads
     * with Great Britain's data and Network Rail's feed (fixtures), and
     * Northern Ireland's trains by timetable. Spain is chosen again at the
     * end, so the other tests start where they expect.
     */
    @Test
    public void theUkLoadsFromThePicker() throws Exception {
        waitFor("window.__trainradar && window.__trainradar.engine && window.__trainradar.engine.positions(Date.now()).length > 0", 90_000);
        try {
            eval("document.getElementById('net-chip').click(); return true;");
            waitFor("document.querySelector('#networks:not([hidden]) #net-country option[value=\"uk\"]')", 10_000);
            eval("window.__beforeUk = true; var s = document.getElementById('net-country'); s.value = 'uk';"
                    + " s.dispatchEvent(new Event('change')); return true;");
            // A new page: the mark is gone once the UK has loaded.
            waitFor("!window.__beforeUk && window.__trainradar && window.__trainradar.engine && window.__trainradar.engine.positions(Date.now()).length > 0", 90_000);
            // The timetable places trains first; Network Rail's delays follow.
            waitFor("(function () { var e = window.__trainradar.engine, n = e.positions(Date.now()).length / 6;"
                    + " for (var i = 0; i < n; i++) if (JSON.parse(e.trainJson(i, Date.now())).delay != null) return true; return false; })()", 30_000);
            String trains = (String) eval("var e = window.__trainradar.engine, n = e.positions(Date.now()).length / 6, gb = 0, gbLive = 0, ni = 0;"
                    + "for (var i = 0; i < n; i++) { var t = JSON.parse(e.trainJson(i, Date.now()));"
                    + "  if (t.operator === 'NI Railways') { if (t.timetable_only) ni++; } else { gb++; if (t.delay != null) gbLive++; } }"
                    + "return gb + ' GB (' + gbLive + ' with a delay), ' + ni + ' NI; chip ' + document.getElementById('net-chip').textContent.trim()"
                    + " + '; saved ' + localStorage.getItem('country');");
            assertTrue("UK trains: " + trains, trains.matches("[1-9]\\d* GB \\([1-9]\\d* with a delay\\), [1-9]\\d* NI; chip Reino Unido; saved uk"));
        } finally {
            try {
                eval("localStorage.setItem('country', 'es'); return true;");
            } catch (RuntimeException e) {
                // the next test starts from the saved view anyway
            }
        }
    }

    /**
     * Cab-ride videos (docs/plan-cab-rides.md; the test build has the demo's
     * cabrides.json): a station found through the search lists them, each a
     * YouTube link at the station's moment, and tapping one leaves the app
     * for YouTube or the browser.
     */
    @Test
    public void cabRideVideosOpenOutsideTheApp() throws Exception {
        waitFor("window.__trainradar && window.__trainradar.engine && window.__trainradar.engine.positions(Date.now()).length > 0", 90_000);
        eval("var q = document.getElementById('search-q'); q.value = 'Barcelona-Sants';"
                + "q.dispatchEvent(new Event('input', { bubbles: true })); return true;");
        waitFor("Array.prototype.some.call(document.querySelectorAll('#search-results li button'), function (b) { return /Barcelona-Sants/.test(b.textContent); })", 10_000);
        eval("var b = Array.prototype.find.call(document.querySelectorAll('#search-results li button'), function (b) { return /Barcelona-Sants/.test(b.textContent); });"
                + " b.click(); return true;");
        // The videos' file loads the first time a station opens.
        waitFor("document.querySelector('#cab-list .cab-row')", 30_000);
        String links = (String) eval("return Array.prototype.map.call(document.querySelectorAll('#cab-list .cab-row'), function (a) { return a.href; }).join(' ');");
        assertTrue("YouTube links at a moment: " + links, links.matches("(https://www\\.youtube\\.com/watch\\?v=[\\w-]{11}&t=\\d+s ?)+"));

        // Tap the first: Android hands it to YouTube or the browser.
        eval("document.querySelector('#cab-list .cab-row').scrollIntoView(); return true;");
        onWebView().withTimeout(60, TimeUnit.SECONDS)
                .withElement(findElement(Locator.CSS_SELECTOR, "#cab-list .cab-row")).perform(webClick());
        long until = System.currentTimeMillis() + 20_000;
        while (appInFront() && System.currentTimeMillis() < until) Thread.sleep(500);
        assertFalse("tapping a video left the app for YouTube or the browser", appInFront());
        // Back to the app (as after the share sheet).
        long end = System.currentTimeMillis() + 30_000;
        while (!appInFront() && System.currentTimeMillis() < end) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            long settle = System.currentTimeMillis() + 6_000;
            while (!appInFront() && System.currentTimeMillis() < settle) Thread.sleep(250);
        }
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
        // Drawing an image can take several seconds on a CI emulator: wait
        // up to 30 s for the share sheet, failing early if the call fails.
        long until = System.currentTimeMillis() + 30_000;
        while (appInFront()) {
            String state;
            try {
                state = String.valueOf(eval("return window.__shared;"));
            } catch (RuntimeException e) {
                // The sheet opened between the check and the script, so
                // the app has no resumed screen: that's the pass we wait for.
                if (!appInFront()) break;
                throw e;
            }
            if (state.startsWith("error") || System.currentTimeMillis() > until) {
                throw new AssertionError("the share sheet didn't open; export: " + state);
            }
            Thread.sleep(1_000);
        }
        // The sheet is open, which is what this checks. Close it (Back; the
        // sheet can ignore a press while it animates, so retry), then make
        // sure the call didn't fail for another reason.
        // After each press, wait up to 6 s for the app to come back before
        // pressing again: a press that lands once the app is back would
        // close the app itself.
        long end = System.currentTimeMillis() + 30_000;
        while (!appInFront() && System.currentTimeMillis() < end) {
            InstrumentationRegistry.getInstrumentation().getUiAutomation()
                    .performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK);
            long settle = System.currentTimeMillis() + 6_000;
            while (!appInFront() && System.currentTimeMillis() < settle) Thread.sleep(250);
        }
        if (!appInFront()) return; // still showing the sheet: the export reached it
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
