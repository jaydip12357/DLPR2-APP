/**
 * Authentication — simple hardcoded username/password gate.
 */
const SafeTypeAuth = {
    _loggedIn: false,

    init() {
        // Nothing to initialize
    },

    async signIn(username, password) {
        if (username === 'username' && password === 'password') {
            this._loggedIn = true;
            sessionStorage.setItem('safetype_auth', '1');
            return true;
        }
        throw new Error('Invalid username or password');
    },

    async signOut() {
        this._loggedIn = false;
        sessionStorage.removeItem('safetype_auth');
    },

    async getSession() {
        return sessionStorage.getItem('safetype_auth') === '1' ? true : null;
    },

    onAuthChange(callback) {
        // Not needed for simple auth — handled by signIn/signOut directly
    }
};
