begin;

alter table public.profiles
  add column username text;

alter table public.profiles
  add constraint profiles_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

create unique index profiles_username_unique
  on public.profiles (lower(username))
  where username is not null;

comment on column public.profiles.username is
  'Case-normalized login name. Supabase Auth uses username@users.tianyu.invalid internally.';

commit;
