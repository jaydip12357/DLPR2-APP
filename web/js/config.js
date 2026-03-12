/**
 * Supabase configuration — credentials are baked in.
 */
const SUPABASE_URL = 'https://vdgjozaouhjhjzrwuqvi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZ2pvemFvd'; // PASTE FULL KEY HERE

const SafeTypeConfig = {
    getSupabaseClient() {
        return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
};
