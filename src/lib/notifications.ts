import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type NotificationPayload = {
  eventKey: string;
  title: string;
  body: string;
  href?: string;
  entityType?: string;
  entityId?: string | null;
};

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const fromB64url = (value: string) => Buffer.from(value, "base64url");
function hkdfExtract(salt: Buffer, inputKey: Buffer) {
  return createHmac("sha256", salt).update(inputKey).digest();
}
function hkdfExpand(prk: Buffer, info: Buffer, length: number) {
  let output = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  for (let counter = 1; output.length < length; counter++) {
    previous = createHmac("sha256", prk).update(Buffer.concat([previous, info, Buffer.from([counter])])).digest();
    output = Buffer.concat([output, previous]);
  }
  return output.subarray(0, length);
}
function vapidToken(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const publicBytes = fromB64url(publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error("Invalid VAPID public key");
  const key = createPrivateKey({ key: {
    kty: "EC", crv: "P-256", x: b64url(publicBytes.subarray(1, 33)),
    y: b64url(publicBytes.subarray(33, 65)), d: privateKey,
  }, format: "jwk" });
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: subject,
  }));
  const unsigned = head + "." + claims;
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return unsigned + "." + b64url(signature);
}
function encryptPushPayload(subscription: { p256dh: string; auth: string }, payload: string) {
  const userPublic = fromB64url(subscription.p256dh);
  if (userPublic.length !== 65 || userPublic[0] !== 4) throw new Error("Invalid push subscription public key");
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey(undefined, "uncompressed");
  const sharedSecret = ecdh.computeSecret(userPublic);
  const authSecret = fromB64url(subscription.auth);
  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), userPublic, serverPublic]);
  const inputKey = hkdfExpand(prkKey, keyInfo, 32);
  const salt = randomBytes(16);
  const prk = hkdfExtract(salt, inputKey);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4); recordSize.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublic.length]), serverPublic, encrypted]);
}
async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  const token = vapidToken(subscription.endpoint, publicKey, privateKey, process.env.VAPID_SUBJECT || "mailto:admin@optics.example");
  const body = encryptPushPayload(subscription, payload);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: "vapid t=" + token + ", k=" + publicKey,
      TTL: "60",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  if (!response.ok) {
    const error: any = new Error("Web push provider returned " + response.status);
    error.statusCode = response.status;
    throw error;
  }
}

export async function notifyUsers(userIds: string[], actorUserId: string | null, payload: NotificationPayload) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!recipients.length) return;
  const admin = getSupabaseAdmin() as any;
  const href = payload.href || "/dashboard";
  let freshRecipients = recipients;
  if (payload.entityId) {
    const { data: existing } = await admin.from("app_notifications").select("recipient_user_id")
      .eq("event_key", payload.eventKey).eq("entity_id", payload.entityId).in("recipient_user_id", recipients);
    const alreadyNotified = new Set((existing ?? []).map((row: any) => row.recipient_user_id));
    freshRecipients = recipients.filter((id) => !alreadyNotified.has(id));
  }
  if (!freshRecipients.length) return;
  const rows = freshRecipients.map((recipient_user_id) => ({
    recipient_user_id, actor_user_id: actorUserId, event_key: payload.eventKey,
    title: payload.title, body: payload.body, href,
    entity_type: payload.entityType ?? null, entity_id: payload.entityId ?? null,
  }));
  const inserted = await admin.from("app_notifications").insert(rows);
  if (inserted.error) console.error("notification persistence failed", inserted.error.message);
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { data: subscriptions, error } = await admin.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth").in("user_id", freshRecipients);
    if (error) throw error;
    await Promise.all((subscriptions ?? []).map(async (sub: any) => {
      try {
        await sendWebPush(sub, JSON.stringify({ title: payload.title, body: payload.body, href }));
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
