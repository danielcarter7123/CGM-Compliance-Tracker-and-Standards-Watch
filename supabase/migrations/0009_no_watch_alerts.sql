-- Dan decided Standards Watch sends no alert emails: NERC already offers its own alerts, and the point of
-- Watch is one reviewed weekly digest instead of a stream of emails (docs/OPEN-QUESTIONS.md, 14).
-- Removes what 0008 added for alerts. drafts.previous stays: the digest's corrections box uses it.

drop table public.alert_log;
alter table public.profiles drop column alerts_opt_in;
