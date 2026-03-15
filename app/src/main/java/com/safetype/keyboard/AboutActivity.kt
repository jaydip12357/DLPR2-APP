package com.safetype.keyboard

import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.safetype.keyboard.data.MessageDatabase
import com.safetype.keyboard.data.SupabaseConfig
import com.safetype.keyboard.data.UploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AboutActivity : AppCompatActivity() {

    private lateinit var messagesContainer: LinearLayout
    private lateinit var statsText: TextView
    private lateinit var connectionStatus: TextView
    private lateinit var selfTestResult: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scrollView = ScrollView(this).apply {
            setBackgroundColor(0xFF1A1B23.toInt())
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        // Title
        val title = TextView(this).apply {
            text = getString(R.string.about_app_title)
            textSize = 24f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, 16)
        }

        val description = TextView(this).apply {
            text = getString(R.string.about_app_description)
            textSize = 15f
            setTextColor(0xFFE4E4E7.toInt())
            setLineSpacing(6f, 1f)
        }

        // Connection status
        connectionStatus = TextView(this).apply {
            text = "Supabase: Checking..."
            textSize = 14f
            setTextColor(0xFFFBBF24.toInt())
            setPadding(0, 32, 0, 0)
        }

        // Stats line
        statsText = TextView(this).apply {
            text = "Loading..."
            textSize = 13f
            setTextColor(0xFF9CA3AF.toInt())
            setPadding(0, 8, 0, 0)
        }

        // Button row
        val buttonRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val p = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            p.topMargin = 24
            layoutParams = p
        }

        val pushButton = Button(this).apply {
            text = "Push All Now"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF5B5EF0.toInt())
            setPadding(24, 16, 24, 16)
            val p = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            p.marginEnd = 8
            layoutParams = p
            setOnClickListener {
                UploadWorker.pushNow(this@AboutActivity)
                Toast.makeText(this@AboutActivity, "Uploading...", Toast.LENGTH_SHORT).show()
                messagesContainer.postDelayed({ loadMessages() }, 3000)
            }
        }

        val refreshButton = Button(this).apply {
            text = "Refresh"
            textSize = 13f
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF374151.toInt())
            setPadding(24, 16, 24, 16)
            val p = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            p.marginStart = 4
            p.marginEnd = 4
            layoutParams = p
            setOnClickListener { loadMessages(); checkConnection() }
        }

        val selfTestButton = Button(this).apply {
            text = "Self-Test"
            textSize = 13f
            setTextColor(0xFFE4E4E7.toInt())
            setBackgroundColor(0xFF27272A.toInt())
            setPadding(24, 16, 24, 16)
            val p = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            p.marginStart = 8
            layoutParams = p
            setOnClickListener { runSelfTest() }
        }

        buttonRow.addView(pushButton)
        buttonRow.addView(refreshButton)
        buttonRow.addView(selfTestButton)

        // Self-test results
        selfTestResult = TextView(this).apply {
            textSize = 12f
            setTextColor(0xFF9CA3AF.toInt())
            setPadding(0, 12, 0, 0)
        }

        // Divider
        val divider = TextView(this).apply {
            setBackgroundColor(0xFF2D2F3A.toInt())
            val p = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 2)
            p.topMargin = 32
            p.bottomMargin = 16
            layoutParams = p
        }

        // Messages header
        val msgHeader = TextView(this).apply {
            text = "Recent Messages"
            textSize = 18f
            setTextColor(0xFFFFFFFF.toInt())
            setPadding(0, 0, 0, 16)
        }

        messagesContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        layout.addView(title)
        layout.addView(description)
        layout.addView(connectionStatus)
        layout.addView(statsText)
        layout.addView(buttonRow)
        layout.addView(selfTestResult)
        layout.addView(divider)
        layout.addView(msgHeader)
        layout.addView(messagesContainer)
        scrollView.addView(layout)
        setContentView(scrollView)

        checkConnection()
        loadMessages()
    }

    override fun onResume() {
        super.onResume()
        checkConnection()
        loadMessages()
    }

    private fun checkConnection() {
        connectionStatus.text = "Supabase: Checking..."
        connectionStatus.setTextColor(0xFFFBBF24.toInt())

        CoroutineScope(Dispatchers.IO).launch {
            val connected = try {
                val url = URL("${SupabaseConfig.URL}/rest/v1/")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "HEAD"
                conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.connect()
                val code = conn.responseCode
                conn.disconnect()
                code in 200..399
            } catch (e: Exception) {
                false
            }

            withContext(Dispatchers.Main) {
                if (connected) {
                    connectionStatus.text = "Supabase: Connected"
                    connectionStatus.setTextColor(0xFF4ADE80.toInt())
                } else {
                    connectionStatus.text = "Supabase: Offline — messages will queue locally"
                    connectionStatus.setTextColor(0xFFF87171.toInt())
                }
            }
        }
    }

    private fun loadMessages() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val db = MessageDatabase.getInstance(this@AboutActivity)
                val dao = db.messageDao()
                val messages = dao.getRecent(50)
                val totalCount = dao.totalCount()
                val unsentCount = dao.unsentCount()

                withContext(Dispatchers.Main) {
                    statsText.text = "$totalCount captured · $unsentCount pending upload"

                    messagesContainer.removeAllViews()

                    if (messages.isEmpty()) {
                        messagesContainer.addView(TextView(this@AboutActivity).apply {
                            text = "No messages captured yet."
                            textSize = 14f
                            setTextColor(0xFF6B7280.toInt())
                            setPadding(0, 16, 0, 16)
                        })
                        return@withContext
                    }

                    val dateFormat = SimpleDateFormat("MMM d, h:mm a", Locale.getDefault())

                    for (msg in messages) {
                        val card = LinearLayout(this@AboutActivity).apply {
                            orientation = LinearLayout.VERTICAL
                            setBackgroundColor(0xFF22242E.toInt())
                            setPadding(24, 16, 24, 16)
                            val p = LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.WRAP_CONTENT
                            )
                            p.bottomMargin = 8
                            layoutParams = p
                        }

                        // Top row: app + status badge
                        val topRow = LinearLayout(this@AboutActivity).apply {
                            orientation = LinearLayout.HORIZONTAL
                            gravity = Gravity.CENTER_VERTICAL
                        }

                        val appLabel = TextView(this@AboutActivity).apply {
                            text = formatAppName(msg.appSource)
                            textSize = 11f
                            setTextColor(0xFF818CF8.toInt())
                            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                        }

                        val badge = TextView(this@AboutActivity).apply {
                            if (msg.isSent) {
                                text = "PUSHED"
                                setTextColor(0xFF4ADE80.toInt())
                            } else {
                                text = "PENDING"
                                setTextColor(0xFFFBBF24.toInt())
                            }
                            textSize = 10f
                        }

                        topRow.addView(appLabel)
                        topRow.addView(badge)

                        // Message text
                        val textView = TextView(this@AboutActivity).apply {
                            text = msg.text
                            textSize = 14f
                            setTextColor(0xFFE4E4E7.toInt())
                            maxLines = 3
                            setPadding(0, 6, 0, 6)
                        }

                        // Meta line
                        val meta = TextView(this@AboutActivity).apply {
                            val time = dateFormat.format(Date(msg.timestamp))
                            val dir = msg.direction.uppercase()
                            val layer = msg.sourceLayer
                            val sender = if (msg.sender != null) " · ${msg.sender}" else ""
                            text = "$time · $dir · $layer$sender"
                            textSize = 11f
                            setTextColor(0xFF6B7280.toInt())
                        }

                        card.addView(topRow)
                        card.addView(textView)
                        card.addView(meta)
                        messagesContainer.addView(card)
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    statsText.text = "Error: ${e.message}"
                }
            }
        }
    }

    private fun runSelfTest() {
        selfTestResult.text = "Running..."
        selfTestResult.setTextColor(0xFFFBBF24.toInt())

        CoroutineScope(Dispatchers.IO).launch {
            val results = mutableListOf<String>()

            // DB check
            try {
                val db = MessageDatabase.getInstance(this@AboutActivity)
                val total = db.messageDao().totalCount()
                results.add("DB: $total messages stored")
            } catch (e: Exception) {
                results.add("DB: ERROR — ${e.message}")
            }

            // Unsent check
            try {
                val db = MessageDatabase.getInstance(this@AboutActivity)
                val unsent = db.messageDao().unsentCount()
                results.add("Queue: $unsent unsent")
            } catch (e: Exception) {
                results.add("Queue: ERROR")
            }

            // Supabase ping
            try {
                val url = URL("${SupabaseConfig.URL}/rest/v1/")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "HEAD"
                conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
                conn.connectTimeout = 5000
                conn.connect()
                val code = conn.responseCode
                conn.disconnect()
                results.add("Supabase: HTTP $code")
            } catch (e: Exception) {
                results.add("Supabase: UNREACHABLE — ${e.message}")
            }

            // Reschedule workers
            UploadWorker.schedule(this@AboutActivity)
            results.add("Workers: rescheduled")

            withContext(Dispatchers.Main) {
                selfTestResult.text = results.joinToString("\n")
                selfTestResult.setTextColor(0xFF9CA3AF.toInt())
            }
        }
    }

    private fun formatAppName(pkg: String): String {
        return when (pkg) {
            "com.whatsapp" -> "WhatsApp"
            "com.whatsapp.w4b" -> "WA Business"
            "com.google.android.apps.messaging" -> "Messages"
            "com.samsung.android.messaging" -> "Samsung Msg"
            "com.instagram.android" -> "Instagram"
            "com.snapchat.android" -> "Snapchat"
            "keyboard" -> "Keyboard"
            else -> pkg.substringAfterLast('.')
        }
    }
}
