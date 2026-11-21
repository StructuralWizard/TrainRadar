package com.metranos.trainradar;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Saved journeys' alerts (plan journeys J4). */
public class JourneyRulesTest {
    /** Zaragoza 08:05 → Atocha 09:30 (AVE 3063), walk 7 min, Atocha
     * Cercanías 09:45 → Pinto 09:58 (C3 20138); weekdays. */
    static JSONObject commutes(String days, String notify) throws Exception {
        return new JSONObject("{\"v\":2,\"active\":0,\"list\":[{\"from\":{\"id\":\"04040\"},\"to\":{\"id\":\"35600\"},\"journey\":{"
                + "\"legs\":[{\"number\":\"03063\",\"route\":\"AVE\",\"from\":\"04040\",\"from_name\":\"Zaragoza\",\"to\":\"60000\",\"to_name\":\"Atocha\",\"dep\":\"08:05\",\"arr\":\"09:30\",\"walk\":0},"
                + "{\"number\":\"20138\",\"route\":\"C3\",\"from\":\"18000\",\"from_name\":\"Atocha Cercanías\",\"to\":\"35600\",\"to_name\":\"Pinto\",\"dep\":\"09:45\",\"arr\":\"09:58\",\"walk\":420}],"
                + "\"days\":" + days + ",\"remind\":30,\"notify\":" + notify + "}}]}");
    }

    /** Epoch ms for a Madrid time on Tuesday 24 Nov 2026. */
    static long tue(int h, int m) {
        Calendar c = Calendar.getInstance(JourneyRules.MADRID);
        c.clear();
        c.set(2026, Calendar.NOVEMBER, 24, h, m);
        return c.getTimeInMillis();
    }

    static JSONObject run(String json) throws Exception {
        return new JSONObject(json);
    }

    static List<JSONObject[]> runs(JSONObject... legs) {
        List<JSONObject[]> out = new ArrayList<>();
        out.add(legs);
        return out;
    }

    static final String ALL = "{\"delay\":true,\"risk\":true,\"remind\":true,\"platform\":true,\"stations\":true}";

    @Test
    public void activeOnItsDaysAroundItsTimes() throws Exception {
        JSONObject c = commutes("[1,2,3,4,5]", ALL);
        assertEquals("an hour before leaving", 1, JourneyRules.active(c, tue(7, 5)).size());
        assertTrue("too early", JourneyRules.active(c, tue(6, 30)).isEmpty());
        assertEquals("until half an hour after arriving", 1, JourneyRules.active(c, tue(10, 25)).size());
        assertTrue(JourneyRules.active(c, tue(10, 35)).isEmpty());
        assertTrue("not on Tuesdays", JourneyRules.active(commutes("[6,7]", ALL), tue(8, 0)).isEmpty());
        JourneyRules.Active a = JourneyRules.active(c, tue(8, 0)).get(0);
        assertEquals(tue(9, 45), a.dep[1]);
        assertEquals("Zaragoza → Pinto · 08:05", a.title);
    }

    @Test
    public void reminderDelaysAndAChangeAtRisk() throws Exception {
        JSONObject c = commutes("[1,2,3,4,5]", ALL);
        JSONObject state = new JSONObject();
        JSONArray summary = new JSONArray();
        // 07:40: the reminder (30 min before), the AVE on time.
        long now = tue(7, 40);
        List<JourneyRules.Alert> a = JourneyRules.decide(JourneyRules.active(c, now),
                runs(run("{\"found\":true,\"delay\":0,\"canceled\":false}"), run("{\"found\":true,\"delay\":null}")), summary, null, state, now, "es");
        assertEquals(1, a.size());
        assertEquals("Sales a las 08:05: AVE 3063 a su hora", a.get(0).body);
        // Once only.
        assertTrue(JourneyRules.decide(JourneyRules.active(c, now), runs(), summary, null, state, now, "es").isEmpty());
        // 09:00, the AVE running 6 min late (the summary): 2 min left at
        // Atocha after the walk — a delay alert and the change at risk.
        now = tue(9, 0);
        summary = new JSONArray("[{\"trainNo\":\"3063\",\"delayMin\":6,\"status\":\"running\",\"nextStopId\":\"60000\"}]");
        a = JourneyRules.decide(JourneyRules.active(c, now), runs(null, run("{\"found\":true,\"delay\":0}")), summary, null, state, now, "es");
        assertEquals(2, a.size());
        assertEquals("AVE 3063: 6 min de retraso", a.get(0).body);
        assertEquals("Enlace en riesgo en Atocha Cercanías: quedan 2 min para el C3 20138", a.get(1).body);
        // 9 min late: missed; same delay level, no new delay alert.
        summary = new JSONArray("[{\"trainNo\":\"3063\",\"delayMin\":9,\"status\":\"running\"}]");
        a = JourneyRules.decide(JourneyRules.active(c, now), runs(null, run("{\"found\":true,\"delay\":0}")), summary, null, state, now, "en");
        assertEquals(1, a.size());
        assertEquals("You'll miss the change at Atocha Cercanías to C3 20138: see other options", a.get(0).body);
        // The C3 cancelled.
        a = JourneyRules.decide(JourneyRules.active(c, now), runs(null, run("{\"found\":true,\"delay\":null,\"canceled\":true}")), summary, null, state, now, "es");
        assertEquals(1, a.size());
        assertEquals("C3 20138: cancelado — mira otras opciones", a.get(0).body);
    }

    @Test
    public void platformChangesAndStationNotices() throws Exception {
        JSONObject c = commutes("[2]", ALL);
        JSONObject state = new JSONObject();
        long now = tue(7, 50);
        JSONArray s1 = new JSONArray("[{\"trainNo\":\"3063\",\"delayMin\":0,\"status\":\"running\",\"nextStopId\":\"04040\",\"platform\":\"3\"}]");
        JSONArray s2 = new JSONArray("[{\"trainNo\":\"3063\",\"delayMin\":0,\"status\":\"running\",\"nextStopId\":\"04040\",\"platform\":\"5\"}]");
        JSONArray notices = new JSONArray("[{\"id\":\"n1\",\"kind\":\"accessibility\",\"text\":\"Ascensor fuera de servicio en Pinto\",\"stops\":[\"35600\"]},"
                + "{\"id\":\"n2\",\"kind\":\"works\",\"text\":\"Obras en Sevilla\",\"stops\":[\"51003\"]}]");
        List<JourneyRules.Alert> a = JourneyRules.decide(JourneyRules.active(c, now), runs(), s1, notices, state, now, "es");
        // The reminder, the Pinto notice (not Sevilla's); the platform is only noted.
        assertEquals(2, a.size());
        assertEquals("Zaragoza → Pinto · 08:05 · ascensores y accesos", a.get(1).title);
        assertEquals("Ascensor fuera de servicio en Pinto", a.get(1).body);
        a = JourneyRules.decide(JourneyRules.active(c, now), runs(), s2, notices, state, now, "es");
        assertEquals(1, a.size());
        assertEquals("AVE 3063 sale ahora por la vía 5 (antes 3)", a.get(0).body);
    }

    @Test
    public void respectsTheChosenAlerts() throws Exception {
        JSONObject c = commutes("[2]", "{\"delay\":false,\"risk\":true,\"remind\":false,\"platform\":false,\"stations\":false}");
        long now = tue(7, 40);
        JSONArray summary = new JSONArray("[{\"trainNo\":\"3063\",\"delayMin\":20,\"status\":\"running\"}]");
        List<JourneyRules.Alert> a = JourneyRules.decide(JourneyRules.active(c, now), runs(), summary,
                new JSONArray("[{\"id\":\"n1\",\"kind\":\"works\",\"text\":\"x\",\"stops\":[\"35600\"]}]"), new JSONObject(), now, "es");
        // 20 min late breaks the change: only that is asked for.
        assertEquals(1, a.size());
        assertTrue(a.get(0).body.startsWith("Pierdes el cambio en Atocha Cercanías"));
    }
}
