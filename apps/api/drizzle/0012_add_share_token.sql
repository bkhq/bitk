ALTER TABLE `issues` ADD `share_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `issues_share_token_uniq` ON `issues` (`share_token`);