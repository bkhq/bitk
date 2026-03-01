ALTER TABLE `issues` ADD `status_updated_at` integer NOT NULL DEFAULT (unixepoch());
--> statement-breakpoint
CREATE INDEX `issues_project_id_status_updated_at_idx` ON `issues` (`project_id`, `status_updated_at`);
