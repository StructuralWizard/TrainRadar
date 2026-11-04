package com.metranos.trainradar;

import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.test.espresso.web.model.Atoms;
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

    private static Object eval(String script) {
        return onWebView().forceJavascriptEnabled().perform(Atoms.script(script)).get().getValue();
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
        throw new AssertionError("timed out waiting for: " + condition);
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
        onWebView().withElement(findElement(Locator.CSS_SELECTOR, "#search-results li button")).perform(webClick());
        waitFor("document.querySelector('.popup .popup-title')", 10_000);

        String popup = (String) eval("return document.querySelector('.popup').textContent;");
        assertTrue(popup, popup.contains(number.replaceFirst("^0+", "")));
        assertFalse("free edition hides gradients: " + popup, popup.contains("Pendiente"));
        assertTrue("favourite button", (Boolean) eval("return !!document.querySelector('.popup .fav-btn');"));
    }
}
