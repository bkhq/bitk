CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`task_type` text NOT NULL,
	`task_config` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cron_jobs_name_uniq` ON `cron_jobs` (`name`);
--> statement-breakpoint
CREATE INDEX `cron_jobs_enabled_idx` ON `cron_jobs` (`enabled`);
--> statement-breakpoint
CREATE TABLE `cron_job_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL REFERENCES `cron_jobs`(`id`),
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`status` text NOT NULL,
	`result` text,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `cron_job_logs_job_id_idx` ON `cron_job_logs` (`job_id`);
--> statement-breakpoint
CREATE INDEX `cron_job_logs_job_id_started_at_idx` ON `cron_job_logs` (`job_id`, `started_at`);
--> statement-breakpoint
CREATE INDEX `cron_job_logs_status_idx` ON `cron_job_logs` (`status`);
