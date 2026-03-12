/**
 * Dashboard data module — fetches messages from Supabase and renders UI.
 */
const SafeTypeDashboard = {
    client: null,
    messages: [],
    pageSize: 50,
    currentOffset: 0,
    realtimeChannel: null,

    init(supabaseClient) {
        this.client = supabaseClient;
    },

    /**
     * Fetch messages with filters applied.
     */
    async fetchMessages(filters = {}, append = false) {
        let query = this.client
            .from('messages')
            .select('*')
            .order('timestamp', { ascending: false })
            .range(
                append ? this.currentOffset : 0,
                (append ? this.currentOffset : 0) + this.pageSize - 1
            );

        // Apply filters
        if (filters.app && filters.app !== 'all') {
            if (filters.app === 'keyboard') {
                query = query.eq('source_layer', 'keyboard');
            } else {
                query = query.eq('app_source', filters.app);
            }
        }
        if (filters.flag === 'flagged') {
            query = query.eq('is_flagged', true);
        } else if (filters.flag === 'safe') {
            query = query.eq('is_flagged', false);
        }
        if (filters.source && filters.source !== 'all') {
            query = query.eq('source_layer', filters.source);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (append) {
            this.messages = [...this.messages, ...data];
            this.currentOffset += data.length;
        } else {
            this.messages = data || [];
            this.currentOffset = this.messages.length;
        }

        return this.messages;
    },

    /**
     * Get today's stats.
     */
    async fetchStats() {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: allToday } = await this.client
            .from('messages')
            .select('id, is_flagged, app_source', { count: 'exact' })
            .gte('timestamp', todayStart.getTime());

        const messages = allToday || [];
        const total = messages.length;
        const flagged = messages.filter(m => m.is_flagged).length;
        const apps = new Set(messages.map(m => m.app_source)).size;

        // Last sync time
        const { data: lastMsg } = await this.client
            .from('messages')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastSync = lastMsg && lastMsg.length > 0
            ? this.timeAgo(new Date(lastMsg[0].created_at))
            : '—';

        return { total, flagged, apps, lastSync };
    },

    /**
     * Get flagged messages for the alerts section.
     */
    async fetchFlaggedAlerts() {
        const { data } = await this.client
            .from('messages')
            .select('*')
            .eq('is_flagged', true)
            .order('timestamp', { ascending: false })
            .limit(10);

        return data || [];
    },

    /**
     * Subscribe to realtime inserts for live updates.
     */
    subscribeRealtime(onNewMessage) {
        this.realtimeChannel = this.client
            .channel('messages-realtime')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => { onNewMessage(payload.new); }
            )
            .subscribe();
    },

    unsubscribeRealtime() {
        if (this.realtimeChannel) {
            this.client.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
        }
    },

    // ─── Rendering helpers ───

    renderAppBadge(appSource) {
        const appMap = {
            'com.whatsapp': { label: 'WhatsApp', cls: 'whatsapp' },
            'com.whatsapp.w4b': { label: 'WA Business', cls: 'whatsapp' },
            'com.google.android.apps.messaging': { label: 'Messages', cls: 'messages' },
            'com.samsung.android.messaging': { label: 'Samsung Msg', cls: 'messages' },
            'com.android.mms': { label: 'MMS', cls: 'messages' },
            'com.instagram.android': { label: 'Instagram', cls: 'instagram' },
            'com.snapchat.android': { label: 'Snapchat', cls: 'snapchat' },
            'keyboard': { label: 'Keyboard', cls: 'keyboard' },
        };
        const info = appMap[appSource] || { label: appSource.split('.').pop(), cls: 'other' };
        return `<span class="app-badge ${info.cls}">${info.label}</span>`;
    },

    renderDirection(dir) {
        const d = (dir || 'unknown').toLowerCase();
        const labels = { incoming: '← In', outgoing: 'Out →', unknown: '?' };
        return `<span class="dir-badge ${d}">${labels[d] || '?'}</span>`;
    },

    renderFlag(isFlagged, flagReason) {
        if (isFlagged === true) {
            return `<span class="flag-danger" title="${this.escapeHtml(flagReason || '')}">⚠ FLAGGED</span>`;
        }
        if (isFlagged === false) {
            return `<span class="flag-safe">✓</span>`;
        }
        return `<span class="flag-pending">—</span>`;
    },

    renderMessageRow(msg) {
        const time = new Date(msg.timestamp).toLocaleString();
        const text = this.escapeHtml(msg.text || '');
        const textClass = msg.is_flagged ? 'msg-text flagged-text' : 'msg-text';
        return `<tr>
            <td style="white-space:nowrap">${time}</td>
            <td>${this.renderAppBadge(msg.app_source)}</td>
            <td><span class="source-badge">${msg.source_layer || '?'}</span></td>
            <td>${this.renderDirection(msg.direction)}</td>
            <td>${this.escapeHtml(msg.sender || '—')}</td>
            <td class="${textClass}">${text}</td>
            <td>${this.renderFlag(msg.is_flagged, msg.flag_reason)}</td>
        </tr>`;
    },

    renderAlertItem(msg) {
        const time = new Date(msg.timestamp).toLocaleString();
        const appBadge = this.renderAppBadge(msg.app_source);
        return `<div class="alert-item">
            <div class="alert-text">${this.escapeHtml(msg.text)}</div>
            <div class="alert-meta">${appBadge}<br>${time}</div>
        </div>`;
    },

    // ─── Utils ───

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    timeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }
};
