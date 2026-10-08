CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"starting_cash_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_prints" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"price_cents" integer NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"ok" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"method" text NOT NULL,
	"direction" text NOT NULL,
	"amount_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"market_cents" integer NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"game" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"set_name" text DEFAULT '' NOT NULL,
	"card_number" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"rarity" text DEFAULT '' NOT NULL,
	"condition" text DEFAULT '' NOT NULL,
	"grader" text DEFAULT '' NOT NULL,
	"grade" text DEFAULT '' NOT NULL,
	"cert" text DEFAULT '' NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"natural_key" text NOT NULL,
	"market_cents" integer,
	"market_updated_at" timestamp with time zone,
	"tcgplayer_product_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"unit_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"unit_id" uuid,
	"direction" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"sticker_cents" integer,
	"cost_cents" integer,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"event_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"voids_transaction_id" uuid,
	"device" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"cost_cents" integer,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"import_id" uuid,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"price_cents" integer,
	"stickered_price_cents" integer,
	"stickered_at" timestamp with time zone,
	"stickered_market_cents" integer,
	"reprint" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "label_prints_unit_idx" ON "label_prints" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "payments_txn_idx" ON "payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_natural_key_uq" ON "products" USING btree ("natural_key");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");--> statement-breakpoint
CREATE INDEX "transaction_lines_txn_idx" ON "transaction_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_unit_idx" ON "transaction_lines" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "transactions_event_idx" ON "transactions" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_voids_uq" ON "transactions" USING btree ("voids_transaction_id") WHERE voids_transaction_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "units_code_uq" ON "units" USING btree ("code");--> statement-breakpoint
CREATE INDEX "units_product_idx" ON "units" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "units_status_idx" ON "units" USING btree ("status");--> statement-breakpoint
CREATE INDEX "units_updated_idx" ON "units" USING btree ("updated_at");