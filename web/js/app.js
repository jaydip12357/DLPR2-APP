/**
 * Main app controller.
 */
(function () {
    // --- DOM refs ---
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    const client = SafeTypeConfig.getSupabaseClient();

    // --- Boot ---
    async function boot() {
        SafeTypeAuth.init();
        SafeTypeDashboard.init(client);

        const session = await SafeTypeAuth.getSession();
        if (session) {
            showDashboard();
        } else {
            showLogin();
        }
    }

    // --- Screens ---
    function showLogin() {
        loginScreen.classList.add('active');
        dashboardScreen.classList.remove('active');
        SafeTypeDashboard.stopAutoAnalysis();
    }

    function showDashboard() {
        loginScreen.classList.remove('active');
        dashboardScreen.classList.add('active');
        loadDashboard();
    }

    function showError(msg) {
        loginError.textContent = msg;
        loginError.style.display = 'block';
        setTimeout(() => { loginError.style.display = 'none'; }, 5000);
    }

    // --- Analysis UI ---
    function showAnalyzeStatus(text, isError) {
        const el = document.getElementById('analyze-status');
        el.textContent = text;
        el.className = 'analyze-status' + (isError ? ' error' : ' success');
        setTimeout(() => { el.textContent = ''; }, 4000);
    }

    async function runAnalysis() {
        const btn = document.getElementById('btn-analyze');
        btn.disabled = true;
        btn.textContent = 'Analyzing...';
        try {
            const result = await SafeTypeDashboard.analyzeMessages();
            if (result && result.analyzed !== undefined) {
                showAnalyzeStatus(
                    'Analyzed ' + result.analyzed + ', flagged ' + result.flagged,
                    false
                );
                // Refresh dashboard to show updated flags
                if (result.flagged > 0) {
                    await loadDashboard();
                }
            } else {
                showAnalyzeStatus('Analysis complete', false);
            }
        } catch (err) {
            console.error('Analysis error:', err);
            showAnalyzeStatus('Analysis failed: ' + (err.message || 'unknown error'), true);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Analyze Now';
        }
    }

    // --- Dashboard loading ---
    async function loadDashboard() {
        try {
            const stats = await SafeTypeDashboard.fetchStats();
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-flagged').textContent = stats.flagged;
            document.getElementById('stat-apps').textContent = stats.apps;
            document.getElementById('stat-last-sync').textContent = stats.lastSync;

            const deviceBadge = document.getElementById('device-status');
            if (stats.lastSync !== '---' && !stats.lastSync.includes('d ago')) {
                deviceBadge.textContent = 'Online';
                deviceBadge.className = 'status-badge online';
            } else {
                deviceBadge.textContent = 'Offline';
                deviceBadge.className = 'status-badge offline';
            }

            const flagged = await SafeTypeDashboard.fetchFlaggedAlerts();
            const alertsSection = document.getElementById('alerts-section');
            const alertsList = document.getElementById('alerts-list');
            if (flagged.length > 0) {
                alertsSection.style.display = 'block';
                alertsList.innerHTML = flagged.map(m =>
                    SafeTypeDashboard.renderAlertItem(m)
                ).join('');
            } else {
                alertsSection.style.display = 'none';
            }

            await loadMessages();

            SafeTypeDashboard.subscribeRealtime((newMsg) => {
                const tbody = document.getElementById('messages-body');
                const firstRow = tbody.querySelector('.empty-state');
                if (firstRow) tbody.innerHTML = '';
                tbody.insertAdjacentHTML('afterbegin',
                    SafeTypeDashboard.renderMessageRow(newMsg)
                );

                const totalEl = document.getElementById('stat-total');
                totalEl.textContent = parseInt(totalEl.textContent) + 1;
                if (newMsg.is_flagged) {
                    const flagEl = document.getElementById('stat-flagged');
                    flagEl.textContent = parseInt(flagEl.textContent) + 1;
                }
                document.getElementById('stat-last-sync').textContent = 'just now';
                const db = document.getElementById('device-status');
                db.textContent = 'Online';
                db.className = 'status-badge online';
            });

            // Start auto-analysis (every 60s)
            SafeTypeDashboard.startAutoAnalysis(async (result) => {
                if (result && result.flagged > 0) {
                    await loadDashboard();
                }
            });

        } catch (err) {
            console.error('Dashboard load error:', err);
        }
    }

    async function loadMessages(append) {
        const filters = {
            app: document.getElementById('filter-app').value,
            flag: document.getElementById('filter-flag').value,
            source: document.getElementById('filter-source').value,
        };

        const messages = await SafeTypeDashboard.fetchMessages(filters, append);
        const tbody = document.getElementById('messages-body');
        const loadMoreBtn = document.getElementById('btn-load-more');

        if (!append) {
            if (messages.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No messages yet. Waiting for device sync...</td></tr>';
            } else {
                tbody.innerHTML = messages.map(m =>
                    SafeTypeDashboard.renderMessageRow(m)
                ).join('');
            }
        } else {
            tbody.innerHTML = messages.map(m =>
                SafeTypeDashboard.renderMessageRow(m)
            ).join('');
        }

        loadMoreBtn.style.display = messages.length >= SafeTypeDashboard.pageSize ? 'inline-block' : 'none';
    }

    // --- Event listeners ---

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await SafeTypeAuth.signIn(
                document.getElementById('email').value,
                document.getElementById('password').value
            );
            showDashboard();
        } catch (err) {
            showError(err.message || 'Sign in failed');
        }
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        SafeTypeDashboard.unsubscribeRealtime();
        SafeTypeDashboard.stopAutoAnalysis();
        await SafeTypeAuth.signOut();
        showLogin();
    });

    ['filter-app', 'filter-flag', 'filter-source'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => loadMessages());
    });

    document.getElementById('btn-refresh').addEventListener('click', () => loadDashboard());
    document.getElementById('btn-analyze').addEventListener('click', () => runAnalysis());
    document.getElementById('btn-load-more').addEventListener('click', () => loadMessages(true));

    // --- Start ---
    boot();
})();
