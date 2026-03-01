ALTER TABLE `issues` ADD `status_updated_at` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `issues` SET `status_updated_at` = `created_at` WHERE `status_updated_at` = 0;
--> statement-breakpoint
CREATE INDEX `issues_project_id_status_updated_at_idx` ON `issues` (`project_id`, `status_updated_at`);
