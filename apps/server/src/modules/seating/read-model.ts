import { type SQLWrapper, sql } from "drizzle-orm";
import { seatAssignment, segmentSeat } from "./schema";

/** 个人的全部有效座位，按方案位置顺序展示；子查询避免将人员或环节展开成多行。 */
export const personSeatLabels = (
  segmentMemberId: SQLWrapper,
  planId: SQLWrapper | number,
) => sql<string | null>`(
  select string_agg(${segmentSeat.label}, '、' order by ${segmentSeat.ordinal}, ${segmentSeat.id})
  from ${seatAssignment}
  join ${segmentSeat} on ${segmentSeat.id} = ${seatAssignment.segmentSeatId}
  where ${seatAssignment.segmentMemberId} = ${segmentMemberId}
    and ${seatAssignment.planId} = ${planId}
    and ${seatAssignment.occupantType} = 'person'
    and ${seatAssignment.revokedAt} is null
    and ${segmentSeat.removedAt} is null
)`;
