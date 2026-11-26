package com.metranos.trainradar;

/**
 * The app's language for texts made on the phone (notifications, widgets):
 * Spanish, English, European Portuguese or Japanese, as chosen in the app
 * (web/js/i18n.js); Spanish for anything else.
 */
final class Tr {
    private Tr() {}

    static String pick(String lang, String es, String en, String pt, String ja) {
        if ("en".equals(lang)) return en;
        if ("pt".equals(lang)) return pt;
        if ("ja".equals(lang)) return ja;
        return es;
    }
}
