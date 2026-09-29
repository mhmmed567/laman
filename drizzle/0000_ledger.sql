CREATE TABLE `products` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `default_cost` integer DEFAULT 0 NOT NULL,
  `default_price` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_products_name` ON `products` (`name`);
--> statement-breakpoint
CREATE TABLE `movements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `product_id` integer NOT NULL,
  `sale_id` integer,
  `quantity` integer NOT NULL,
  `unit_cost` integer DEFAULT 0 NOT NULL,
  `unit_price` integer DEFAULT 0 NOT NULL,
  `store` text DEFAULT '' NOT NULL,
  `occurred_on` text NOT NULL,
  `note` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_movements_product` ON `movements` (`product_id`);
--> statement-breakpoint
CREATE INDEX `idx_movements_date` ON `movements` (`occurred_on`);
--> statement-breakpoint
CREATE INDEX `idx_movements_sale` ON `movements` (`sale_id`);
