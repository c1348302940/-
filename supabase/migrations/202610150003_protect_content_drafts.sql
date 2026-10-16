begin;

-- Members may read the published base columns, but pending edits live in
-- draft_payload and must remain visible to the admin server only.
revoke select on public.goals from authenticated;
grant select (id, team_id, title, description, target_value, version_id, published,
  created_at, updated_at, published_at) on public.goals to authenticated;

revoke select on public.milestones from authenticated;
grant select (id, team_id, version_id, name, date, description, status, published,
  created_at, updated_at, published_at) on public.milestones to authenticated;

revoke select on public.schedule_items from authenticated;
grant select (id, team_id, title, version_id, description, make_date, publish_date,
  make_assignee_id, publish_assignee_id, published, created_at, updated_at, published_at)
  on public.schedule_items to authenticated;

revoke select on public.selling_points from authenticated;
grant select (id, team_id, version_id, title, one_liner, applicable_content,
  material_link, notes, published, created_at, updated_at, published_at)
  on public.selling_points to authenticated;

commit;
