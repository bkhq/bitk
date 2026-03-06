ALTER TABLE issues ADD COLUMN tag text;--> statement-breakpoint
UPDATE issues SET tag = '["' || priority || '"]' WHERE priority IS NOT NULL AND priority != '';--> statement-breakpoint
ALTER TABLE issues DROP COLUMN priority;