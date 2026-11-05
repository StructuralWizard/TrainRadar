package com.metranos.trainradar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrainRadarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
