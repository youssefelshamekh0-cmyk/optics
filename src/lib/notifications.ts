import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type NotificationPayload = {
  eventKey: string;
  title: string;
  body: string;
  href?: string;
  entityType?: string;
  entityId?: string | null;
};

export async function notifyUsers(userIds: string[], actorUserId: string | null, payload: NotificationPayload) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!recipients.length) return;
  const admin = getSupabaseAdmin() as any;
  const href = payload.href || "/dashboard";
  const rows = recipients.map((recipient_user_id) => ({
    recipient_user_id, actor_user_id: actorUserId, event_key: payload.eventKey,
    title: payload.title, body: payload.body, href,
    entity_type: payload.entityType ?? null, entity_id: payload.entityId ?? null,
  }));
  const inserted = await admin.from("app_notifications").insert(rows);
  if (inserted.error) console.error("notification persistence failed", inserted.error.message);
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  try {
    const webpush: any = await import("web-push");
    webpush.default.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@optics.example", publicKey, privateKey);
    const { data: subscriptions, error } = await admin.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth").in("user_id", recipients);
    if (error) throw error;
    await Promise.all((subscriptions ?? []).map(async (sub: any) => {
      try {
        await webpush.default.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: payload.title, body: payload.body, href })
        );
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("web push delivery failed", e?.statusCode ?? e?.message ?? "unknown");
        }
      }
    }));
  } catch (e: any) {
    console.error("web push unavailable", e?.message ?? "unknown");
  }
}
