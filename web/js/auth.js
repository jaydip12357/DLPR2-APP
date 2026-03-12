/**
 * Authentication module — Supabase email/password auth.
 */
const SafeTypeAuth = {
    client: null,

    init(supabaseClient) {
        this.client = supabaseClient;
    },

    async signIn(email, password) {
        const { data, error } = await this.client.auth.signInWithPassword({
            email, password
        });
        if (error) throw error;
        return data;
    },

    async signUp(email, password) {
        const { data, error } = await this.client.auth.signUp({
            email, password
        });
        if (error) throw error;
        return data;
    },

    async signOut() {
        const { error } = await this.client.auth.signOut();
        if (error) throw error;
    },

    async getSession() {
        const { data: { session } } = await this.client.auth.getSession();
        return session;
    },

    onAuthChange(callback) {
        this.client.auth.onAuthStateChange((_event, session) => {
            callback(session);
        });
    }
};
