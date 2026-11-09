package com.metranos.trainradar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private InAppUpdates updates;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrainRadarPlugin.class);
        super.onCreate(savedInstanceState);
        updates = new InAppUpdates(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Google Play: a newer version for this user's track (testers first)?
        updates.check();
    }

    @Override
    public void onDestroy() {
        updates.close();
        super.onDestroy();
    }
}
