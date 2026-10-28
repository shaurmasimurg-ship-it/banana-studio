import { createHandler } from './core.ts';

// These platform-provided credentials are read only inside the Edge runtime.
// They are never returned, printed, or copied into frontend/Vercel settings.
Deno.serve(createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
}));
