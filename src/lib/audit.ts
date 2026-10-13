import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

export async function audit(actorId: string | null, action: string, entityType: string, entityId?: string, details?: Json) {
  const { error } = await getSupabaseAdmin().from("audit_logs").insert({ actor_id: actorId, action, entity_type: entityType, entity_id: entityId ?? null, details: details ?? null });
  if (error) throw new Error(`Audit write failed: ${error.message}`);
}
