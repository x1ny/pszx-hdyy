import { sql } from "drizzle-orm";
import { activityVenueZone } from "./schema";

/** 业务区域容量由当前启用分区汇总，不能另填一份造成重复计数。 */
export const activityZoneCapacity = sql<number>`case
  when ${activityVenueZone.isGroup} then (
    select coalesce(sum(child.capacity), 0)::int from activity_venue_zone child
    where child.activity_venue_id = ${activityVenueZone.activityVenueId}
      and child.parent_external_id = ${activityVenueZone.externalId}
      and child.status = 'active'
  ) else ${activityVenueZone.capacity} end`.mapWith(Number);
