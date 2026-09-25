CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY NOT NULL, preferences TEXT NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS saved_reports (member_id TEXT NOT NULL, report_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(member_id,report_id));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS member_watches (member_id TEXT NOT NULL, token_key TEXT NOT NULL, report_id TEXT NOT NULL, quantity REAL, cost_basis_usd REAL, monitor_enabled INTEGER NOT NULL DEFAULT 1, baseline TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(member_id,token_key));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS watches_token ON member_watches(token_key);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS member_alerts (id TEXT PRIMARY KEY NOT NULL, member_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, report_id TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS alerts_member_time ON member_alerts(member_id,created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS monitor_tokens (token_key TEXT PRIMARY KEY NOT NULL, address TEXT NOT NULL, chain TEXT NOT NULL, report_id TEXT NOT NULL, snapshot TEXT NOT NULL, last_checked_at INTEGER NOT NULL, last_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0);
