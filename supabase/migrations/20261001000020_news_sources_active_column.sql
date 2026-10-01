-- Members may see whether a source is active (so the UI lists only live
-- feeds). URLs and error text stay hidden.
grant select (is_active) on public.news_sources to authenticated;
