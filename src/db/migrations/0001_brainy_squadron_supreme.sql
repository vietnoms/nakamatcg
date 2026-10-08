CREATE TABLE "catalog_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"sub_type" text NOT NULL,
	"game" text NOT NULL,
	"group_id" integer NOT NULL,
	"set_name" text NOT NULL,
	"name" text NOT NULL,
	"clean_name" text NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"number_key" text DEFAULT '' NOT NULL,
	"rarity" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"market_cents" integer,
	"low_cents" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_syncs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items" integer,
	"error" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_product_subtype_uq" ON "catalog_items" USING btree ("product_id","sub_type");--> statement-breakpoint
CREATE INDEX "catalog_items_number_idx" ON "catalog_items" USING btree ("game","number_key");--> statement-breakpoint
CREATE INDEX "catalog_items_name_idx" ON "catalog_items" USING btree ("game","clean_name");