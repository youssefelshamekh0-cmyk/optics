import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type AuthUser = { id: string; email: string | null; phone: string; name: string; roles: string[]; permissions: string[]; branchIds: string[] };

export async function getCurrentUser(): Promise<AuthUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const admin = getSupabaseAdmin();
  const [profile, roleRows, directPermissions, branchRows] = await Promise.all([
    admin.from("user_profiles").select("id,email,phone,full_name,status").eq("id", user.id).maybeSingle(),
    admin.from("user_roles").select("roles(key,role_permissions(permissions(key)))").eq("user_id", user.id),
    admin.from("user_permissions").select("permissions(key)").eq("user_id", user.id),
    admin.from("user_branch_access").select("branch_id").eq("user_id", user.id),
  ]);
  if ([profile, roleRows, directPermissions, branchRows].some((r) => r.error)) throw new Error("Unable to load account access");
  if (!profile.data || profile.data.status !== "active") return null;
  const roles = (roleRows.data ?? []) as unknown as Array<{ roles: { key: string; role_permissions: Array<{ permissions: { key: string } | null }> } | null }>;
  const direct = (directPermissions.data ?? []) as unknown as Array<{ permissions: { key: string } | null }>;
  const permissions = new Set<string>();
  for (const row of roles) for (const item of row.roles?.role_permissions ?? []) if (item.permissions) permissions.add(item.permissions.key);
  for (const row of direct) if (row.permissions) permissions.add(row.permissions.key);
  return { id: user.id, email: profile.data.email, phone: profile.data.phone ?? user.phone ?? "", name: profile.data.full_name, roles: roles.flatMap((row) => row.roles ? [row.roles.key] : []), permissions: [...permissions], branchIds: (branchRows.data ?? []).map((row) => row.branch_id) };
}

export async function requirePermission(permission: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin") && !user.permissions.includes(permission)) return { user, response: Response.json({ error: "ليست لديك صلاحية لتنفيذ هذا الإجراء" }, { status: 403 }) };
  return { user, response: null };
}

export async function requireSameOrigin(request?: Request) {
  const requestHeaders = request?.headers ?? await headers();
  const origin = requestHeaders.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const configuredOrigin = process.env.APP_ORIGIN?.trim();
    if (configuredOrigin && originUrl.origin === new URL(configuredOrigin).origin) return true;

    // In local development the browser may use localhost or 127.0.0.1 interchangeably.
    // Compare against the incoming request so either address works without editing .env.local.
    if (process.env.NODE_ENV !== "production" && request) {
      const requestUrl = new URL(request.url);
      const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
      if (loopbackHosts.has(originUrl.hostname) && loopbackHosts.has(requestUrl.hostname)) return true;
    }

    const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost ?? requestHeaders.get("host");
    if (!host) return false;
    const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? new URL(request?.url ?? "http://localhost").protocol.slice(0, -1);
    return originUrl.origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}
