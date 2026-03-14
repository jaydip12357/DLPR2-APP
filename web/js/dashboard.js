/**
 * Dashboard data module — fetches messages from Supabase and renders UI.
 * Analysis uses the Duke custom model API (Render).
 */
var SafeTypeDashboard = {
    client: null,
    messages: [],
    pageSize: 50,
    currentOffset: 0,
    realtimeChannel: null,
    _analysisInterval: null,

    CUSTOM_MODEL_URL: 'https://dl-project-2-second-version.onrender.com',

    init: function (supabaseClient) {
        this.client = supabaseClient;
    },

    fetchMessages: function (filters, append) {
        var self = this;
        var query = this.client
            .from('messages')
            .select('*')
            .order('timestamp', { ascending: false })
            .range(
                append ? this.currentOffset : 0,
                (append ? this.currentOffset : 0) + this.pageSize - 1
            );

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

        return query.then(function (result) {
            var data = result.data;
            var error = result.error;
            if (error) throw error;

            if (append) {
                self.messages = self.messages.concat(data || []);
                self.currentOffset += (data || []).length;
            } else {
                self.messages = data || [];
                self.currentOffset = self.messages.length;
            }
            return self.messages;
        });
    },

    fetchStats: function () {
        var self = this;
        var todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        return this.client
            .from('messages')
            .select('id, is_flagged, app_source', { count: 'exact' })
            .gte('timestamp', todayStart.getTime())
            .then(function (result) {
                var messages = result.data || [];
                var total = messages.length;
                var flagged = messages.filter(function (m) { return m.is_flagged; }).length;
                var appSet = {};
                messages.forEach(function (m) { appSet[m.app_source] = true; });
                var apps = Object.keys(appSet).length;

                return self.client
                    .from('messages')
                    .select('created_at')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .then(function (lastResult) {
                        var lastMsg = lastResult.data;
                        var lastSync = lastMsg && lastMsg.length > 0
                            ? self.timeAgo(new Date(lastMsg[0].created_at))
                            : '--';
                        return { total: total, flagged: flagged, apps: apps, lastSync: lastSync };
                    });
            });
    },

    fetchFlaggedAlerts: function () {
        return this.client
            .from('messages')
            .select('*')
            .eq('is_flagged', true)
            .order('timestamp', { ascending: false })
            .limit(10)
            .then(function (result) { return result.data || []; });
    },

    subscribeRealtime: function (onNewMessage) {
        this.realtimeChannel = this.client
            .channel('messages-realtime')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                function (payload) { onNewMessage(payload.new); }
            )
            .subscribe();
    },

    unsubscribeRealtime: function () {
        if (this.realtimeChannel) {
            this.client.removeChannel(this.realtimeChannel);
            this.realtimeChannel = null;
        }
    },

    // ─── Settings ───

    getModelUrl: function () {
        var self = this;
        return this.client
            .from('settings')
            .select('value')
            .eq('key', 'custom_model_url')
            .single()
            .then(function (result) {
                return (result.data && result.data.value) || self.CUSTOM_MODEL_URL;
            })
            .catch(function () {
                return self.CUSTOM_MODEL_URL;
            });
    },

    saveModelUrl: function (url) {
        return this.client
            .from('settings')
            .upsert([{ key: 'custom_model_url', value: url || this.CUSTOM_MODEL_URL }], { onConflict: 'key' })
            .then(function (result) {
                if (result.error) throw result.error;
                return { status: 'ok' };
            });
    },

    // ─── Analysis (Duke custom model via Render) ───

    analyzeMessages: function () {
        var self = this;
        return this.getModelUrl().then(function (baseUrl) {
            return self._analyzeWithCustomModel(baseUrl);
        });
    },

    _analyzeWithCustomModel: function (baseUrl) {
        var self = this;

        // 1. Fetch unanalyzed messages from Supabase
        return this.client
            .from('messages')
            .select('id, text, sender, app_source, direction, source_layer')
            .is('is_flagged', null)
            .order('timestamp', { ascending: false })
            .limit(25)
            .then(function (result) {
                if (result.error) throw result.error;
                var messages = result.data || [];
                if (messages.length === 0) {
                    return { status: 'ok', analyzed: 0, flagged: 0 };
                }

                // 2. Send each message to the custom Render API
                var apiUrl = baseUrl.replace(/\/$/, '') + '/api/predict';
                var promises = messages.map(function (msg) {
                    return fetch(apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: msg.text })
                    })
                    .then(function (resp) { return resp.json(); })
                    .then(function (data) {
                        // Map custom model response to our flag format
                        var isFlagged = data.label !== 'clean';
                        var reason = isFlagged
                            ? data.label + ' (' + Math.round(data.confidence * 100) + '% confidence)'
                            : null;

                        return {
                            id: msg.id,
                            is_flagged: isFlagged,
                            flag_reason: reason
                        };
                    })
                    .catch(function (err) {
                        console.warn('Custom model error for msg ' + msg.id + ':', err);
                        return { id: msg.id, is_flagged: null, flag_reason: null };
                    });
                });

                return Promise.all(promises).then(function (results) {
                    // 3. Write results back to Supabase
                    var flaggedCount = 0;
                    var updatePromises = results
                        .filter(function (r) { return r.is_flagged !== null; })
                        .map(function (r) {
                            if (r.is_flagged) flaggedCount++;
                            return self.client
                                .from('messages')
                                .update({
                                    is_flagged: r.is_flagged,
                                    flag_reason: r.flag_reason
                                })
                                .eq('id', r.id);
                        });

                    return Promise.all(updatePromises).then(function () {
                        return {
                            status: 'ok',
                            analyzed: results.filter(function (r) { return r.is_flagged !== null; }).length,
                            flagged: flaggedCount
                        };
                    });
                });
            });
    },

    startAutoAnalysis: function (onComplete) {
        var self = this;
        this.analyzeMessages()
            .then(onComplete)
            .catch(function (err) { console.warn('Auto-analysis:', err.message); });

        this._analysisInterval = setInterval(function () {
            self.analyzeMessages()
                .then(onComplete)
                .catch(function (err) { console.warn('Auto-analysis:', err.message); });
        }, 60000);
    },

    stopAutoAnalysis: function () {
        if (this._analysisInterval) {
            clearInterval(this._analysisInterval);
            this._analysisInterval = null;
        }
    },

    // --- Rendering ---

    renderAppBadge: function (appSource) {
        var appMap = {
            'com.whatsapp': { label: 'WhatsApp', cls: 'whatsapp' },
            'com.whatsapp.w4b': { label: 'WA Business', cls: 'whatsapp' },
            'com.google.android.apps.messaging': { label: 'Messages', cls: 'messages' },
            'com.samsung.android.messaging': { label: 'Samsung Msg', cls: 'messages' },
            'com.android.mms': { label: 'MMS', cls: 'messages' },
            'com.instagram.android': { label: 'Instagram', cls: 'instagram' },
            'com.snapchat.android': { label: 'Snapchat', cls: 'snapchat' },
            'keyboard': { label: 'Keyboard', cls: 'keyboard' }
        };
        var info = appMap[appSource] || { label: appSource.split('.').pop(), cls: 'other' };
        return '<span class="app-badge ' + info.cls + '">' + info.label + '</span>';
    },

    renderDirection: function (dir) {
        var d = (dir || 'unknown').toLowerCase();
        var labels = { incoming: 'IN', outgoing: 'OUT', unknown: '--' };
        return '<span class="dir-badge ' + d + '">' + (labels[d] || '--') + '</span>';
    },

    renderFlag: function (isFlagged, flagReason) {
        if (isFlagged === true) {
            return '<span class="flag-danger" title="' + this.escapeHtml(flagReason || '') + '">FLAGGED</span>';
        }
        if (isFlagged === false) {
            return '<span class="flag-safe">OK</span>';
        }
        return '<span class="flag-pending">--</span>';
    },

    renderMessageRow: function (msg) {
        var time = new Date(msg.timestamp).toLocaleString();
        var text = this.escapeHtml(msg.text || '');
        var textClass = msg.is_flagged ? 'msg-text flagged-text' : 'msg-text';
        return '<tr>' +
            '<td style="white-space:nowrap">' + time + '</td>' +
            '<td>' + this.renderAppBadge(msg.app_source) + '</td>' +
            '<td><span class="source-badge">' + (msg.source_layer || '--') + '</span></td>' +
            '<td>' + this.renderDirection(msg.direction) + '</td>' +
            '<td>' + this.escapeHtml(msg.sender || '--') + '</td>' +
            '<td class="' + textClass + '">' + text + '</td>' +
            '<td>' + this.renderFlag(msg.is_flagged, msg.flag_reason) + '</td>' +
            '</tr>';
    },

    renderAlertItem: function (msg) {
        var time = new Date(msg.timestamp).toLocaleString();
        var appBadge = this.renderAppBadge(msg.app_source);
        var reason = msg.flag_reason ? ' &middot; ' + this.escapeHtml(msg.flag_reason) : '';
        return '<div class="alert-item">' +
            '<div class="alert-text">' + this.escapeHtml(msg.text) + '</div>' +
            '<div class="alert-meta">' + appBadge + reason + '<br>' + time + '</div>' +
            '</div>';
    },

    // --- Utils ---

    escapeHtml: function (str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    timeAgo: function (date) {
        var seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }
};
