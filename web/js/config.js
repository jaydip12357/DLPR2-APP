/**
 * Supabase configuration manager.
 * Stores credentials in localStorage so parent doesn't re-enter every visit.
 */
const SafeTypeConfig = {
    STORAGE_KEY: 'safetype_config',

    getConfig() {
        const saved = localStorage.getItem(this.STORAGE_KEY);
        if (saved) {
            try { return JSON.parse(saved); } catch { return null; }
        }
        return null;
    },

    saveConfig(url, key) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ url, key }));
    },

    clearConfig() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    isConfigured() {
        const config = this.getConfig();
        return config && config.url && config.key;
    },

    getSupabaseClient() {
        const config = this.getConfig();
        if (!config) return null;
        return supabase.createClient(config.url, config.key);
    }
};
