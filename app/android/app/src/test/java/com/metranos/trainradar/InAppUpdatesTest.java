package com.metranos.trainradar;

import static org.junit.Assert.assertEquals;

import com.google.android.play.core.install.model.AppUpdateType;
import org.junit.Test;

public class InAppUpdatesTest {
    @Test
    public void highPriorityIsImmediate() {
        assertEquals(AppUpdateType.IMMEDIATE, InAppUpdates.chooseType(5, true, true));
        assertEquals(AppUpdateType.IMMEDIATE, InAppUpdates.chooseType(4, true, false));
    }

    @Test
    public void anythingElseIsFlexible() {
        assertEquals(AppUpdateType.FLEXIBLE, InAppUpdates.chooseType(0, true, true));
        assertEquals(AppUpdateType.FLEXIBLE, InAppUpdates.chooseType(3, true, true));
        // High priority but Play won't allow immediate: still offer it.
        assertEquals(AppUpdateType.FLEXIBLE, InAppUpdates.chooseType(5, false, true));
    }

    @Test
    public void nothingWhenNeitherIsAllowed() {
        assertEquals(-1, InAppUpdates.chooseType(0, true, false));
        assertEquals(-1, InAppUpdates.chooseType(2, false, false));
    }
}
