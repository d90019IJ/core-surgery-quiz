import { createHandler } from './application.mjs';
import { supabaseRepository } from './supabase-repository.mjs';

// Student identity is deliberately self-reported, as requested by the instructor.
// Teacher operations require a random 256-bit code, verified inside the handler.
// All database access is server-only; student responses never contain grades.
const repository = supabaseRepository(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
Deno.serve(createHandler(repository));
