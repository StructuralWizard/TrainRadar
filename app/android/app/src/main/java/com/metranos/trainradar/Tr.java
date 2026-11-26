package com.metranos.trainradar;

/**
 * The app's language for texts made on the phone (notifications, widgets),
 * as chosen in the app (web/js/i18n.js). Spanish, English, European
 * Portuguese and Japanese are written where the text is used; the other
 * languages come from TrTable by the English text (tools/i18n/android-table.py),
 * English where a text has no translation. Spanish for an unknown language.
 */
final class Tr {
    private Tr() {}

    static String pick(String lang, String es, String en, String pt, String ja) {
        if (lang == null) return es;
        switch (lang) {
            case "es": return es;
            case "en": return en;
            case "pt": return pt;
            case "ja": return ja;
            default: {
                String other = TrTable.get(lang, en);
                return other != null ? other : TrTable.known(lang) ? en : es;
            }
        }
    }
}
