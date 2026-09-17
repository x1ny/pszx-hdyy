ALTER TABLE "segment_seating_plan" ADD COLUMN "allow_multiple_occupancy" boolean DEFAULT false NOT NULL;

-- 已存在的方案是在多占逻辑下创建的，统一保留原行为；列默认值只影响迁移后的新方案。
UPDATE "segment_seating_plan"
SET "allow_multiple_occupancy" = true;
