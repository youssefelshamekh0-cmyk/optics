alter table public.brand_settings add column if not exists brand_name varchar(80) not null default 'نظرة';

alter table public.brand_settings drop constraint if exists brand_settings_brand_name_length;
alter table public.brand_settings add constraint brand_settings_brand_name_length check (length(trim(brand_name)) between 2 and 80);
