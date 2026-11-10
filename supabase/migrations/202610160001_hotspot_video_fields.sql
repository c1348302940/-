alter table public.trend_items
  add column if not exists board_rank integer,
  add column if not exists video_like_count text,
  add column if not exists video_comment_count text,
  add column if not exists video_published_at text,
  add column if not exists video_link text;
