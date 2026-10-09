CREATE TABLE "unit_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'own' NOT NULL,
	"fee_bps" integer,
	"min_fee_cents" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_groups_name_uq" ON "unit_groups" USING btree ("name");--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_group_id_unit_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."unit_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_group_idx" ON "units" USING btree ("group_id");