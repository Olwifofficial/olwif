CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `owner` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`token_key` text NOT NULL,
	`address` text NOT NULL,
	`chain` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`created_at` integer NOT NULL,
	`classification` text NOT NULL,
	`payload` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_token_time` ON `reports` (`token_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_created` ON `reports` (`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
