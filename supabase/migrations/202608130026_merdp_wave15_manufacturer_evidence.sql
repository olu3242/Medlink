insert into public.etl_sources(source_code, authority, name, description)
values ('NAFDAC_GREENBOOK_MANUFACTURER_PRODUCTS', 'NAFDAC', 'NAFDAC Greenbook manufacturer-product evidence', 'Wave 1.5 raw regulatory relationship evidence; not a canonical convergence source')
on conflict (source_code) do update set authority=excluded.authority, name=excluded.name, description=excluded.description, updated_at=now();
