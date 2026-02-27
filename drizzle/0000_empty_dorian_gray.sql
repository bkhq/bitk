CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issues_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`turn_index` integer DEFAULT 0 NOT NULL,
	`entry_index` integer NOT NULL,
	`entry_type` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`reply_to_message_id` text,
	`timestamp` text,
	`tool_call_ref_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issues_logs_issue_id_idx` ON `issues_logs` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issues_logs_issue_id_turn_entry_idx` ON `issues_logs` (`issue_id`,`turn_index`,`entry_index`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status_id` text NOT NULL,
	`issue_number` integer NOT NULL,
	`title` text NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`parent_issue_id` text,
	`use_worktree` integer DEFAULT false NOT NULL,
	`engine_type` text,
	`session_status` text,
	`prompt` text,
	`external_session_id` text,
	`model` text,
	`base_commit_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issues_status_id_check" CHECK("issues"."status_id" IN ('todo','working','review','done'))
);
--> statement-breakpoint
CREATE INDEX `issues_project_id_idx` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `issues_status_id_idx` ON `issues` (`status_id`);--> statement-breakpoint
CREATE INDEX `issues_parent_issue_id_idx` ON `issues` (`parent_issue_id`);--> statement-breakpoint
CREATE TABLE `issues_logs_tools_call` (
	`id` text PRIMARY KEY NOT NULL,
	`log_id` text NOT NULL,
	`issue_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_call_id` text,
	`kind` text NOT NULL,
	`is_result` integer DEFAULT false NOT NULL,
	`raw` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`log_id`) REFERENCES `issues_logs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issues_logs_tools_call_log_id_idx` ON `issues_logs_tools_call` (`log_id`);--> statement-breakpoint
CREATE INDEX `issues_logs_tools_call_issue_id_idx` ON `issues_logs_tools_call` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issues_logs_tools_call_kind_idx` ON `issues_logs_tools_call` (`kind`);--> statement-breakpoint
CREATE INDEX `issues_logs_tools_call_tool_name_idx` ON `issues_logs_tools_call` (`tool_name`);--> statement-breakpoint
CREATE INDEX `issues_logs_tools_call_issue_id_kind_idx` ON `issues_logs_tools_call` (`issue_id`,`kind`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`alias` text NOT NULL,
	`description` text,
	`directory` text,
	`repository_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_deleted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_alias_unique` ON `projects` (`alias`);