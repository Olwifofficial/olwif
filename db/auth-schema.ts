import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const walletChallenges = sqliteTable("wallet_challenges", {
  id: text("id").primaryKey(),
  walletAddress: text("wallet_address").notNull(),
  origin: text("origin").notNull(),
  message: text("message").notNull(),
  issuedAt: integer("issued_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("wallet_challenges_expiry").on(table.expiresAt)]);

export const walletSessions = sqliteTable("wallet_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  memberId: text("member_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  origin: text("origin").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("wallet_sessions_expiry").on(table.expiresAt)]);
