import { createClient } from "@supabase/supabase-js";

const required = (key) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { autoRefreshToken: false, persistSession: false } });
const local = required("OWNER_PHONE").trim().replace(/^\+20|^0020/, "").replace(/^0/, "").replace(/\D/g, "");
const phone = /^1[0125]\d{8}$/.test(local) ? { phone: `+20${local}`, initialPassword: local } : null;
if (!phone) throw new Error("OWNER_PHONE must be a valid Egyptian mobile number");
const name = required("OWNER_NAME").trim();
const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const { data: existingProfiles, error: profileLookupError } = await supabase
  .from("user_profiles")
  .select("id,phone,email")
  .or(`phone.eq.${phone.phone}${email ? `,email.eq.${email}` : ""}`)
  .limit(1);
if (profileLookupError) throw new Error(`Could not check for an existing profile: ${profileLookupError.message}`);
if (existingProfiles?.length) throw new Error("An account with this phone number or email already exists. Use a different number/email; existing users were not changed.");
const { data, error } = await supabase.auth.admin.createUser({ phone: phone.phone, ...(email ? { email, email_confirm: true } : {}), password: process.env.OWNER_PASSWORD ?? phone.initialPassword, phone_confirm: true, user_metadata: { full_name: name } });
if (error || !data.user) throw new Error(error?.message ?? "Supabase did not create the owner account");
const { error: profileError } = await supabase.rpc("admin_create_phone_profile", { p_user_id: data.user.id, p_phone: phone.phone, p_full_name: name, p_role_key: "super_admin", p_branch_ids: [], p_permission_keys: [] });
if (profileError) {
  await supabase.auth.admin.deleteUser(data.user.id);
  throw new Error(`Could not create owner profile: ${profileError.message}`);
}
console.log(`Owner created with phone login: ${phone.phone}`);
