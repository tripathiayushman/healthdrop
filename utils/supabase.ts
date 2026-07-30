// Re-export the app's single shared Supabase client.
// Creating a second createClient() here would spawn a duplicate GoTrueClient
// fighting over the same AsyncStorage session key.
export { supabase } from '../lib/supabase';
