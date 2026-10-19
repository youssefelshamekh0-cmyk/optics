-- Restore the permission catalogue missing from the isolated staging database.
-- This is additive and idempotent; it does not touch production.
insert into public.permissions(key, description) values
 ('branches.read','عرض الفروع'),
 ('branches.manage','إدارة الفروع'),
 ('users.read','عرض المستخدمين'),
 ('users.manage','إدارة المستخدمين والصلاحيات'),
 ('customers.read','عرض العملاء'),
 ('customers.manage','إدارة العملاء'),
 ('sales.read','عرض الفواتير'),
 ('sales.create','إنشاء الفواتير'),
 ('payments.record','تسجيل المدفوعات'),
 ('deliveries.complete','إتمام التسليمات'),
 ('returns.manage','إدارة المرتجعات'),
 ('reports.own.read','عرض التقارير الشخصية'),
 ('inventory.manage','إدارة المخزون والتحويلات'),
 ('purchases.manage','إدارة المشتريات والموردين'),
 ('finance.manage','إدارة الخزائن والمصروفات'),
 ('staff.manage','إدارة الموظفين والرواتب'),
 ('expenses.create','تسجيل مصروفات الفرع'),
 ('payroll.advance.request','طلب مسحوبات أو سلفة راتب'),
 ('leave.request','طلب إجازة أو استئذان')
on conflict (key) do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'super_admin'
on conflict do nothing;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'salesperson'
  and p.key in ('branches.read','customers.read','sales.read','sales.create',
                'payments.record','deliveries.complete','reports.own.read',
                'expenses.create','payroll.advance.request','leave.request')
on conflict do nothing;
