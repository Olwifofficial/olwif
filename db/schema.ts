import {sqliteTable,text,integer,index} from "drizzle-orm/sqlite-core";
export * from "./auth-schema";
export * from "./member-schema";
export const reports=sqliteTable("reports",{
 id:text("id").primaryKey(),tokenKey:text("token_key").notNull(),address:text("address").notNull(),chain:text("chain").notNull(),
 name:text("name").notNull(),symbol:text("symbol").notNull(),createdAt:integer("created_at").notNull(),classification:text("classification").notNull(),
 payload:text("payload").notNull(),hidden:integer("hidden",{mode:"boolean"}).notNull().default(false)
},t=>[index("reports_token_time").on(t.tokenKey,t.createdAt),index("reports_created").on(t.createdAt)]);
export const settings=sqliteTable("settings",{key:text("key").primaryKey(),value:text("value").notNull()});
export const owner=sqliteTable("owner",{key:text("key").primaryKey(),userId:text("user_id").notNull()});
export const limits=sqliteTable("limits",{key:text("key").primaryKey(),count:integer("count").notNull(),expires:integer("expires").notNull()});
