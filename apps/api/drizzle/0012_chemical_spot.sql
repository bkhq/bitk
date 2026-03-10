PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status_id` text NOT NULL,
	`issue_number` integer NOT NULL,
	`title` text NOT NULL,
	`tag` text,
	`sort_order` text DEFAULT 'a0' NOT NULL,
	`parent_issue_id` text,
	`use_worktree` integer DEFAULT false NOT NULL,
	`engine_type` text,
	`session_status` text,
	`prompt` text,
	`external_session_id` text,
	`model` text,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` text DEFAULT '0' NOT NULL,
	`status_updated_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_status_id_check" CHECK("__new_issues"."status_id" IN ('todo','working','review','done'))
);
--> statement-breakpoint
INSERT INTO `__new_issues`("id", "project_id", "status_id", "issue_number", "title", "tag", "sort_order", "parent_issue_id", "use_worktree", "engine_type", "session_status", "prompt", "external_session_id", "model", "total_input_tokens", "total_output_tokens", "total_cost_usd", "status_updated_at", "created_at", "updated_at", "is_deleted") SELECT "id", "project_id", "status_id", "issue_number", "title", "tag", "sort_order", "parent_issue_id", "use_worktree", "engine_type", "session_status", "prompt", "external_session_id", "model", "total_input_tokens", "total_output_tokens", "total_cost_usd", "status_updated_at", "created_at", "updated_at", "is_deleted" FROM `issues`;--> statement-breakpoint
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `issues_project_id_idx` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `issues_status_id_idx` ON `issues` (`status_id`);--> statement-breakpoint
CREATE INDEX `issues_parent_issue_id_idx` ON `issues` (`parent_issue_id`);--> statement-breakpoint
CREATE INDEX `issues_project_id_status_updated_at_idx` ON `issues` (`project_id`,`status_updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_project_id_issue_number_uniq` ON `issues` (`project_id`,`issue_number`);