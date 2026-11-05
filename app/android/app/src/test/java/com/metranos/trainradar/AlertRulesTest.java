package com.metranos.trainradar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Same cases as web/js/alerts.test.mjs. */
public class AlertRulesTest {
    static final JSONArray FAVS = arr("[{\"type\":\"train\",\"number\":\"03071\",\"label\":\"AVE 3071\"},"
            + "{\"type\":\"station\",\"id\":\"18000\"},{\"type\":\"train\",\"number\":\"19\",\"label\":\"C5 19\"}]");

    static JSONArray arr(String s) {
        try {
            return new JSONArray(s);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    static JSONArray summary(String delay71, String status19) {
        return arr("[{\"trainNo\":\"3071\",\"delayMin\":" + delay71 + ",\"status\":\"running\"},"
                + "{\"trainNo\":\"19\",\"delayMin\":0,\"status\":\"" + status19 + "\"},{\"trainNo\":\"999\",\"delayMin\":40}]");
    }

    @Test
    public void notifiesOncePerLevelAndDay() throws Exception {
        JSONObject state = new JSONObject();
        List<AlertRules.Alert> a = AlertRules.decide(FAVS, summary("3", "running"), state, "2026-11-05", 5, 15, "es");
        assertTrue("under 5 min: nothing", a.isEmpty());
        a = AlertRules.decide(FAVS, summary("7", "running"), state, "2026-11-05", 5, 15, "es");
        assertEquals(1, a.size());
        assertEquals("AVE 3071", a.get(0).title);
        assertEquals("7 min de retraso", a.get(0).body);
        a = AlertRules.decide(FAVS, summary("9", "running"), state, "2026-11-05", 5, 15, "es");
        assertTrue("same level: once", a.isEmpty());
        a = AlertRules.decide(FAVS, summary("4", "running"), state, "2026-11-05", 5, 15, "es");
        assertTrue("back under, no news", a.isEmpty());
        a = AlertRules.decide(FAVS, summary("16", "cancelled"), state, "2026-11-05", 5, 15, "en");
        assertEquals(2, a.size());
        assertEquals("16 min late", a.get(0).body);
        assertEquals("Cancelled", a.get(1).body);
        a = AlertRules.decide(FAVS, summary("7", "running"), state, "2026-11-06", 5, 15, "es");
        assertEquals("a new day starts over", 1, a.size());
    }

    @Test
    public void proFromTheCachedEntitlement() {
        long now = 1_000_000_000_000L;
        assertTrue(AlertRules.isPro("{\"pro\":true,\"checkedAt\":" + (now - 86_400_000L) + "}", now));
        assertFalse("older than 7 days", AlertRules.isPro("{\"pro\":true,\"checkedAt\":" + (now - 8 * 86_400_000L) + "}", now));
        assertFalse(AlertRules.isPro("{\"pro\":false,\"checkedAt\":" + now + "}", now));
        assertFalse(AlertRules.isPro(null, now));
        assertFalse(AlertRules.isPro("{bad", now));
    }
}
