CREATE TABLE IF NOT EXISTS `wallet_challenges` (
  `id` text PRIMARY KEY NOT NULL,
  `wallet_address` text NOT NULL,
  `origin` text NOT NULL,
  `message` text NOT NULL,
  `issued_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wallet_challenges_expiry` ON `wallet_challenges` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `wallet_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `member_id` text NOT NULL,
  `wallet_address` text NOT NULL,
  `origin` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `wallet_sessions_expiry` ON `wallet_sessions` (`expires_at`);
