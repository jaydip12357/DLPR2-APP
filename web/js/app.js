/**
 * Main app controller — ties config, auth, and dashboard together.
 */
(function () {
    // ─── DOM refs ───
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const loginError = document.getElementById('login-error');
    const configModal = document.getElementById('config-modal');

    // ─── Boot ───
    async function boot() {
        // Check if Supabase is configured
        if (!SafeTypeConfig.isConfigured()) {
            showConfigModal();
            return;
        }

        const client = SafeTypeConfig.getSupabaseClient();
        SafeTypeAuth.init(client);
        SafeTypeDashboard.init(client);

        // Check existing session
        const session = await SafeTypeAuth.getSession();
        if (session) {
            showDashboard();
        } else {
            showLogin();
        }

        // Listen for auth changes
        SafeTypeAuth.onAuthChange((session) => {
            if (session) {
                showDashboard();
            } else {
                showLogin();
            }
        });
    }

    // ─── Screens ───
    function showLogin() {
        loginScreen.classList.add('active');
        dashboardScreen.classList.remove('active');
    }

    function showDashboard() {
        loginScreen.classList.remove('active');
        dashboardScreen.classList.add('active');
        loadDashboard();
    }

    function showConfigModal() {
        configModal.style.display = 'flex';
        // Pre-fill if already configured
        const config = SafeTypeConfig.getConfig();
        if (config) {
            document.getElementById('config-url').value = config.url || '';
            document.getElementById('config-key').value = config.key || '';
        }
    }

    function showError(msg) {
        loginError.textContent = msg;
        loginError.style.display = 'block';
        setTimeout(() => { loginError.style.display = 'none'; }, 5000);
    }

    // ─── Dashboard loading ───
    async function loadDashboard() {
        try {
            // Load stats
            const stats = await SafeTypeDashboard.fetchStats();
            document.getElementById('stat-total').textContent = stats.total;
            document.getElementById('stat-flagged').textContent = stats.flagged;
            document.getElementById('stat-apps').textContent = stats.apps;
            document.getElementById('stat-last-sync').textContent = stats.lastSync;

            // Device status
            const deviceBadge = document.getElementById('device-status');
            if (stats.lastSync !== '—' && !stats.lastSync.includes('d ago')) {
                deviceBadge.textContent = 'Online';
                deviceBadge.className = 'status-badge online';
            } else {
                deviceBadge.textContent = 'Offline';
                deviceBadge.className = 'status-badge offline';
            }

            // Flagged alerts
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

            // Messages
            await loadMessages();

            // Realtime subscription
            SafeTypeDashboard.subscribeRealtime((newMsg) => {
                // Prepend new message to table
                const tbody = document.getElementById('messages-body');
                const firstRow = tbody.querySelector('.empty-state');
                if (firstRow) tbody.innerHTML = '';
                tbody.insertAdjacentHTML('afterbegin',
                    SafeTypeDashboard.renderMessageRow(newMsg)
                );

                // Update stats
                const totalEl = document.getElementById('stat-total');
                totalEl.textContent = parseInt(totalEl.textContent) + 1;
                if (newMsg.is_flagged) {
                    const flagEl = document.getElementById('stat-flagged');
                    flagEl.textContent = parseInt(flagEl.textContent) + 1;
                }
                document.getElementById('stat-last-sync').textContent = 'just now';
                const deviceBadge = document.getElementById('device-status');
                deviceBadge.textContent = 'Online';
                deviceBadge.className = 'status-badge online';
            });

        } catch (err) {
            console.error('Dashboard load error:', err);
        }
    }

    async function loadMessages(append = false) {
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
            const newRows = messages.slice(SafeTypeDashboard.currentOffset - messages.length + (messages.length - SafeTypeDashboard.pageSize));
            // Simpler: just re-render all
            tbody.innerHTML = messages.map(m =>
                SafeTypeDashboard.renderMessageRow(m)
            ).join('');
        }

        // Show/hide load more
        loadMoreBtn.style.display = messages.length >= SafeTypeDashboard.pageSize ? 'inline-block' : 'none';
    }

    // ─── Event listeners ───

    // Config modal save
    document.getElementById('btn-save-config').addEventListener('click', () => {
        const url = document.getElementById('config-url').value.trim();
        const key = document.getElementById('config-key').value.trim();
        if (!url || !key) return;
        SafeTypeConfig.saveConfig(url, key);
        configModal.style.display = 'none';
        boot();
    });

    // Login form
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await SafeTypeAuth.signIn(
                document.getElementById('email').value,
                document.getElementById('password').value
            );
        } catch (err) {
            showError(err.message || 'Sign in failed');
        }
    });

    // Signup form
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await SafeTypeAuth.signUp(
                document.getElementById('signup-email').value,
                document.getElementById('signup-password').value
            );
            showError('Account created! Check your email to verify, then sign in.');
        } catch (err) {
            showError(err.message || 'Sign up failed');
        }
    });

    // Toggle login/signup
    document.getElementById('show-signup').addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        signupForm.style.display = 'block';
    });
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        signupForm.style.display = 'none';
        loginForm.style.display = 'block';
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', async () => {
        SafeTypeDashboard.unsubscribeRealtime();
        await SafeTypeAuth.signOut();
    });

    // Filters
    ['filter-app', 'filter-flag', 'filter-source'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => loadMessages());
    });

    // Refresh
    document.getElementById('btn-refresh').addEventListener('click', () => loadDashboard());

    // Load more
    document.getElementById('btn-load-more').addEventListener('click', () => loadMessages(true));

    // ─── Start ───
    boot();
})();
