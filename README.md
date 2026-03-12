# SafeType — Parental Monitoring System

SafeType is a parental monitoring tool for Android. It captures messages sent and received on a child's device across three independent layers, deduplicates them, stores them encrypted locally, and syncs them to a Supabase cloud database. Parents view everything in real time through a web dashboard.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture Overview](#architecture-overview)
- [Android App](#android-app)
  - [Message Capture Layers](#message-capture-layers)
  - [Local Storage & Deduplication](#local-storage--deduplication)
  - [Upload & Sync](#upload--sync)
  - [Device Owner Lockdown](#device-owner-lockdown)
  - [Parent Access (PairingActivity)](#parent-access-pairingactivity)
- [Web Dashboard](#web-dashboard)
  - [Login](#login)
  - [Dashboard Features](#dashboard-features)
  - [Real-time Updates](#real-time-updates)
- [Supabase Database](#supabase-database)
  - [Schema](#schema)
  - [Row-Level Security](#row-level-security)
- [Data Flow (End to End)](#data-flow-end-to-end)
- [Project Structure](#project-structure)
- [Setup & Deployment](#setup--deployment)
- [Credentials](#credentials)

---

## How It Works

```
CHILD'S DEVICE                     CLOUD                    PARENT
──────────────                     ──────────               ──────────────────

Keyboard typing  ─┐
Notifications    ─┼─> Dedup ─> Encrypted Room DB ─> UploadWorker ─> Supabase ─> Web Dashboard
Screen scraper   ─┘                (5-min batch)              (realtime)
```

1. The Android app runs three capture services simultaneously on the child's device.
2. All captured messages are deduplicated and stored in an AES-256 encrypted local database.
3. A background worker uploads batches to Supabase every 5 minutes.
4. The parent's web dashboard receives new messages in real time via Supabase's realtime WebSocket.

---

## Architecture Overview

```
app/
├── SafeTypeIME                  ← Custom keyboard (captures outgoing text)
├── NotificationCaptureService   ← Notification listener (captures incoming)
├── ScreenScraperService         ← Accessibility service (captures visible messages)
│
├── DedupEngine                  ← LRU SHA-256 deduplication across all three layers
├── Room DB (SQLCipher)          ← Encrypted local message queue
│
├── UploadWorker                 ← Periodic Supabase sync (every 5 min)
├── AnalysisWorker               ← Optional content analysis + sync (every 15 min)
│
└── AdminReceiver                ← Device Owner (locks keyboard, prevents uninstall)

web/
├── index.html                   ← Single-page dashboard UI
├── js/config.js                 ← Supabase credentials
├── js/auth.js                   ← Hardcoded login
├── js/dashboard.js              ← Data fetching, filtering, rendering
└── js/app.js                    ← Navigation, events, realtime subscription
```

---

## Android App

### Message Capture Layers

The app captures messages from three independent layers to maximise coverage:

#### 1. Keyboard (Outgoing)
- **File:** `SafeTypeIME.kt`
- SafeType replaces the device's default keyboard entirely.
- Every keystroke typed into a non-password field is appended to an internal `composedText` buffer.
- A message is captured and queued when any of the following happens:
  - User taps the **Send** button (`IME_ACTION_SEND`)
  - The text field **clears** (message was sent and the field reset)
  - **30 seconds of inactivity** elapse (captures draft/partial messages)
- Stored with `source_layer = "keyboard"`, `direction = "outgoing"`.

#### 2. Notifications (Incoming)
- **File:** `NotificationCaptureService.kt`, `notification/NotificationParser.kt`
- Implemented as a `NotificationListenerService` — receives every notification posted on the device.
- Filters to monitored packages: WhatsApp, WhatsApp Business, Google Messages, Samsung Messages, Instagram, Snapchat, Discord, Telegram, and others.
- Per-app parsers extract sender and message text from notification extras (`EXTRA_TEXT`, `EXTRA_TEXT_LINES`, `EXTRA_TITLE`).
- Handles group chat format (`"Sender: message"`), multi-message stacks, and inline reply formatting.
- Stored with `source_layer = "notification"`, `direction = "incoming"`.

#### 3. Screen Scraper (Visible Messages)
- **File:** `ScreenScraperService.kt`, `scraper/`
- Implemented as an `AccessibilityService` — monitors `TYPE_WINDOW_CONTENT_CHANGED` and `TYPE_WINDOW_STATE_CHANGED` events.
- Debounced to 150 ms per package to avoid excessive processing.
- Per-app scrapers use Android view IDs to locate message bubbles:
  - `WhatsAppScraper` — matches view IDs `message_text`, `name_in_group`, etc.
  - `InstagramScraper`, `SnapchatScraper`, `SMSScraper` — similar view-ID matching.
  - `GenericScraper` — fallback; collects all TextViews > 10 characters, excludes UI labels and timestamps.
- Infers direction from node layout: left-aligned = incoming, right-aligned = outgoing.
- Stored with `source_layer = "accessibility"`.

---

### Local Storage & Deduplication

- **File:** `data/MessageDatabase.kt`, `data/DedupEngine.kt`
- All captured messages are first passed through `DedupEngine` before insertion.
- Deduplication uses a 1000-entry LRU cache of SHA-256 hashes:
  ```
  hash = SHA-256(normalized_text + sender + app_source + timestamp_minute)
  ```
  A message captured by multiple layers (e.g., keyboard + accessibility for the same outgoing message) is stored only once.
- The local Room database is encrypted with **AES-256 via SQLCipher**, key stored in the **Android Keystore** (hardware-backed).
- Messages are retained locally for **24 hours max**, then purged.
- Schema: `id`, `text`, `sender`, `direction`, `app_source`, `source_layer`, `timestamp`, `conversation_hash`, `isSent`

---

### Upload & Sync

- **Files:** `data/UploadWorker.kt`, `data/AnalysisWorker.kt`
- Both are WorkManager periodic tasks with exponential-backoff retry on failure.

| Worker | Interval | What it does |
|---|---|---|
| `UploadWorker` | Every 5 min | Reads up to 10 unsent messages, inserts into Supabase `messages` table, marks sent, purges old records |
| `AnalysisWorker` | Every 15 min | Same upload, plus optionally calls `/api/v1/analyze` if a JWT token (from pairing) is present |

- Uploads use the **Supabase anon key** (INSERT-only via RLS).
- Content analysis results (flagging) are written back to Supabase via UPDATE.

---

### Device Owner Lockdown

- **Files:** `AdminReceiver.kt`, `BootReceiver.kt`
- The app is installed as a **Device Owner** via ADB during setup (`setup.sh`).
- Once active, `AdminReceiver` uses `DevicePolicyManager` to:
  - Lock SafeType as the **default keyboard** (child cannot switch keyboards)
  - Enable the **accessibility service** and **notification listener** via secure settings (child cannot disable them)
  - **Prevent uninstall** of the app
- `BootReceiver` re-applies all settings after every device reboot.
- A **persistent notification** is always visible: `"SafeType Parental Monitor - Active"`. This is intentional transparency to the child.

---

### Parent Access (PairingActivity)

- **File:** `PairingActivity.kt`
- Accessible by **holding the spacebar for 5 seconds** in the SafeType keyboard.
- PIN-protected (default: `1234`, changeable).
- Shows:
  - Supabase connection status
  - Device pairing status (linked/unlinked to dashboard)
  - Self-test results for all three capture layers
- Pairing: parent enters a 6-digit code shown on the web dashboard → device calls `POST /api/v1/pair` → receives JWT token → enables content analysis.

---

## Web Dashboard

Deployed at: **https://dlpr2-app-production.up.railway.app**

A static single-page app served by Nginx inside Docker. Connects directly to Supabase from the browser using the anon key.

### Login

Simple hardcoded credential check (no Supabase auth involved):

- **Username:** `username`
- **Password:** `password`

Session is stored in `sessionStorage` (cleared on browser close).

### Dashboard Features

Once logged in, the dashboard shows:

**Stats Bar**

| Stat | Source |
|---|---|
| Messages Today | COUNT of messages with `timestamp >= today 00:00` |
| Flagged | COUNT where `is_flagged = true` (today) |
| Apps Monitored | COUNT(DISTINCT app_source) (today) |
| Last Sync | `MAX(created_at)` formatted as "Xm ago / Xh ago" |

**Filters**
- **App:** All Apps / WhatsApp / Messages / Instagram / Snapchat / Keyboard
- **Show:** All Messages / Flagged Only / Safe Only
- **Source:** All Sources / Screen Scraper / Keyboard / Notification

**Message Table** (50 per page, sorted newest first)

| Column | Values |
|---|---|
| Time | Capture timestamp |
| App | Color-coded badge (WhatsApp green, Instagram purple, etc.) |
| Source | `accessibility` / `keyboard` / `notification` |
| Direction | `← In` / `Out →` |
| Sender | Contact name or phone number |
| Message | Message text (HTML-escaped) |
| Flag | `✓` safe / `⚠ FLAGGED` with reason / `—` pending |

**Flagged Alerts Section** — appears automatically at the top if any flagged messages exist. Shows the 10 most recent with app badge and timestamp.

### Real-time Updates

- On page load, the dashboard subscribes to Supabase Realtime (`postgres_changes` INSERT on `messages`).
- When a new message arrives from any device:
  - It is **prepended to the message table** instantly (no refresh needed)
  - The **Messages Today** and **Flagged** stats increment live
  - **Last Sync** updates to `"just now"`
  - The **Connected** badge stays green

---

## Supabase Database

**Project URL:** `https://vdgjozaouhjhjzrwuqvi.supabase.co`

### Schema

```sql
CREATE TABLE messages (
    id                BIGSERIAL PRIMARY KEY,
    device_id         TEXT,
    text              TEXT NOT NULL,
    sender            TEXT,
    direction         TEXT,            -- 'incoming' | 'outgoing' | 'unknown'
    app_source        TEXT,            -- 'com.whatsapp', 'com.instagram.android', etc.
    source_layer      TEXT,            -- 'accessibility' | 'notification' | 'keyboard'
    timestamp         BIGINT,          -- capture time (ms since epoch)
    conversation_hash TEXT,            -- SHA-256 of sender+app (for grouping)
    is_flagged        BOOLEAN,         -- NULL=pending, TRUE=flagged, FALSE=safe
    flag_reason       TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast dashboard queries
CREATE INDEX idx_messages_timestamp    ON messages (timestamp DESC);
CREATE INDEX idx_messages_app_source   ON messages (app_source);
CREATE INDEX idx_messages_is_flagged   ON messages (is_flagged);
CREATE INDEX idx_messages_source_layer ON messages (source_layer);
CREATE INDEX idx_messages_device_id    ON messages (device_id);
```

Apply the schema from: `web/supabase_schema.sql`

### Row-Level Security

| Role | Operation | Allowed |
|---|---|---|
| `anon` (device) | INSERT | Yes (all rows) |
| `anon` (device) | SELECT | No |
| `authenticated` (parent) | SELECT | Yes (all rows) |
| `authenticated` (parent) | UPDATE | Yes (for flagging) |

Realtime is enabled on the `messages` table via:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

---

## Data Flow (End to End)

```
1. CAPTURE (real-time, on device)
   SafeTypeIME / NotificationCaptureService / ScreenScraperService
       └─> DedupEngine (LRU SHA-256 cache, 1000 entries)
           └─> Room DB INSERT (isSent=false, encrypted AES-256)

2. UPLOAD (every 5–15 minutes, background)
   UploadWorker
       └─> SELECT * FROM room_db WHERE isSent=false LIMIT 10
           └─> POST https://vdgjozaouhjhjzrwuqvi.supabase.co/rest/v1/messages
               Headers: Authorization: Bearer <anon_key>
               Body: [{ device_id, text, sender, direction, app_source, source_layer, timestamp }]
               └─> Supabase inserts row, sets created_at=NOW()
               └─> Realtime broadcasts INSERT event to all subscribers
           └─> UPDATE room_db SET isSent=true WHERE id IN (...)
           └─> DELETE FROM room_db WHERE timestamp < (now - 24h)

   AnalysisWorker (additionally, if paired)
       └─> Same upload
       └─> POST /api/v1/analyze with JWT Bearer token
           └─> Returns flagged message IDs + reasons
           └─> PATCH supabase/messages SET is_flagged=true, flag_reason=... WHERE id=...

3. DASHBOARD (parent's browser, continuous)
   Initial load:
       └─> fetchStats()        → SELECT COUNT, MAX(created_at) FROM messages WHERE timestamp >= today
       └─> fetchMessages()     → SELECT * FROM messages ORDER BY timestamp DESC LIMIT 50
       └─> fetchFlaggedAlerts() → SELECT * FROM messages WHERE is_flagged=true LIMIT 10
       └─> subscribeRealtime() → WebSocket on supabase_realtime, listens for INSERT

   On new INSERT event from Supabase:
       └─> Prepend row to message table
       └─> Increment stats counters
       └─> Set last sync to "just now"

   On filter change:
       └─> Re-query Supabase with new WHERE clauses
       └─> Re-render table

Total latency:
  Device capture → Supabase : up to 5 min (worker interval)
  Supabase → Dashboard      : < 100 ms (realtime WebSocket)
```

---

## Project Structure

```
DLPR2-APP/
├── app/
│   └── src/main/
│       ├── java/com/safetype/keyboard/
│       │   ├── SafeTypeIME.kt                   # Custom keyboard IME
│       │   ├── NotificationCaptureService.kt    # Notification listener
│       │   ├── ScreenScraperService.kt          # Accessibility service
│       │   ├── PairingActivity.kt               # Parent setup (PIN-protected)
│       │   ├── AboutActivity.kt                 # Disclosure screen for child
│       │   ├── AdminReceiver.kt                 # Device Owner receiver
│       │   ├── BootReceiver.kt                  # Re-applies settings on boot
│       │   ├── KeyboardView.kt                  # Keyboard UI
│       │   ├── api/
│       │   │   ├── ApiClient.kt                 # Retrofit client factory
│       │   │   └── ApiService.kt                # /api/v1/analyze, /api/v1/pair
│       │   ├── data/
│       │   │   ├── MessageDatabase.kt           # Room DB (SQLCipher)
│       │   │   ├── MessageEntity.kt             # Room entity
│       │   │   ├── MessageDao.kt                # DB queries
│       │   │   ├── DedupEngine.kt               # LRU deduplication
│       │   │   ├── SupabaseConfig.kt            # Supabase credentials (device-side)
│       │   │   ├── UploadWorker.kt              # 5-min upload task
│       │   │   └── AnalysisWorker.kt            # 15-min analysis + upload task
│       │   ├── scraper/
│       │   │   ├── AppScraper.kt                # Base interface
│       │   │   ├── WhatsAppScraper.kt
│       │   │   ├── InstagramScraper.kt
│       │   │   ├── SnapchatScraper.kt
│       │   │   ├── SMSScraper.kt
│       │   │   └── GenericScraper.kt            # Fallback for unknown apps
│       │   └── notification/
│       │       ├── NotificationParser.kt        # Dispatcher to per-app parsers
│       │       └── ParsedMessage.kt
│       ├── res/
│       │   ├── layout/keyboard_layout.xml
│       │   └── xml/
│       │       ├── accessibility_service_config.xml
│       │       ├── device_admin.xml
│       │       └── method.xml
│       └── AndroidManifest.xml
│
├── web/
│   ├── index.html                               # Dashboard UI
│   ├── js/
│   │   ├── config.js                            # Supabase URL + anon key
│   │   ├── auth.js                              # Hardcoded login
│   │   ├── dashboard.js                         # Data fetching & rendering
│   │   └── app.js                               # Controller, events, realtime
│   ├── css/style.css                            # Dark theme
│   ├── Dockerfile                               # Nginx Alpine container
│   ├── nginx.conf                               # SPA routing
│   └── supabase_schema.sql                      # DB schema + RLS policies
│
├── setup.sh                                     # ADB install + Device Owner setup
├── build.gradle.kts
└── settings.gradle.kts
```

---

## Setup & Deployment

### 1. Supabase (Database)

1. Create a Supabase project.
2. Run `web/supabase_schema.sql` in the Supabase SQL editor.
3. Enable Realtime on the `messages` table (or the SQL script handles it).
4. Copy the **Project URL** and **anon/public key**.

### 2. Android App

Requirements: Android device with USB debugging enabled. No Google accounts should be active on the device (Device Owner requirement).

```bash
# Connect device via USB, then:
bash setup.sh
```

`setup.sh` will:
- Build the APK via Gradle
- Install via `adb install`
- Set the app as Device Owner: `adb shell dpm set-device-owner com.safetype.keyboard/.AdminReceiver`
- Verify all services are running

Set the Supabase credentials in `app/src/main/java/com/safetype/keyboard/data/SupabaseConfig.kt` before building.

### 3. Web Dashboard

The dashboard is a static site — no backend needed. Served by Nginx in Docker.

```bash
cd web
docker build -t safetype-dashboard .
docker run -p 3000:3000 safetype-dashboard
```

Deployed on Railway: `https://dlpr2-app-production.up.railway.app`

---

## Credentials

| What | Value |
|---|---|
| Dashboard login username | `username` |
| Dashboard login password | `password` |
| Parent PIN (device) | `1234` (default, change via PairingActivity) |
| Supabase Project URL | `https://vdgjozaouhjhjzrwuqvi.supabase.co` |
| Dashboard URL | `https://dlpr2-app-production.up.railway.app` |

The Supabase anon key is baked into `web/js/config.js` and `app/.../SupabaseConfig.kt`. It is INSERT-only for anonymous clients (devices) — Row-Level Security enforces this at the database level.
