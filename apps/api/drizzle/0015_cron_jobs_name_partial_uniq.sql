-- Replace unconditional unique index with partial unique index
-- that excludes soft-deleted rows, so deleted job names can be reused
DROP INDEX IF EXISTS `cron_jobs_name_uniq`;
--> statement-breakpoint
CREATE UNIQUE INDEX `cron_jobs_name_uniq` ON `cron_jobs` (`name`) WHERE `is_deleted` = 0;
