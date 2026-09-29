import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  defaultCost: integer("default_cost").notNull().default(0),
  defaultPrice: integer("default_price").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_products_name").on(table.name)]);

export const movements = sqliteTable("movements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["receipt", "sale", "return"] }).notNull(),
  productId: integer("product_id").notNull().references(() => products.id),
  saleId: integer("sale_id"),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  unitPrice: integer("unit_price").notNull().default(0),
  store: text("store").notNull().default(""),
  occurredOn: text("occurred_on").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_movements_product").on(table.productId),
  index("idx_movements_date").on(table.occurredOn),
  index("idx_movements_sale").on(table.saleId),
]);
