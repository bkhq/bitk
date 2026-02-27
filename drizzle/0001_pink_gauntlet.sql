CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`log_id` text,
	`original_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`log_id`) REFERENCES `issues_logs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_issue_id_idx` ON `attachments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `attachments_log_id_idx` ON `attachments` (`log_id`);