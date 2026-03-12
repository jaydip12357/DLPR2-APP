package com.safetype.keyboard

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Phase 2 stub — NotificationListenerService for capturing incoming message notifications.
 * Declared in manifest (disabled) so Device Owner can enable it silently.
 */
class NotificationCaptureService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        // Phase 2: extract sender + text from notification extras
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Phase 2
    }
}
