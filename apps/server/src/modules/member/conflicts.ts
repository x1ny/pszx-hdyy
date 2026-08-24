/**
 * 人员时间冲突：同一个人被排进两个时间重叠的环节。
 *
 * C-016 点名了"人员冲突"这一类，并定死了处理方式——**允许保存但提示**。所以这
 * 段逻辑不进保存路径：不同议程线本来就允许并行（BR-DEV-031），"这个人两边都得
 * 到场"只有运营判断得了（挂名不到场、中途赶场都是常态），后端没有判断依据，
 * 拦下来只会逼人把真实排期改成假的。它只在议程页顶部报一句，让人自己确认。
 *
 * 写成纯函数而不是一条 SQL 自连接：半开区间、零时长环节、成对去重这三条语义
 * 都需要用例钉住，而这个仓库的测试不连库（见 routes.test.ts 的同一处取舍）。
 * 数据量也撑得住——一个活动几十个环节乘上每环节百来号人，是一次全量查询就
 * 拉得回来的规模。
 */

/** 一行"某人出现在某环节"。字段由 routes.relation.ts 那条 join 拼出来。 */
export type SegmentAttendance = {
  memberId: number;
  memberName: string;
  segmentId: number;
  segmentName: string;
  startTime: Date;
  endTime: Date;
};

export type ConflictSegment = {
  id: number;
  name: string;
  startTime: Date;
  endTime: Date;
};

export type MemberTimeConflict = {
  memberId: number;
  memberName: string;
  /** 恰好两个，按开始时间排序——前端要拼"在 A、B 中存在时间冲突"这句话。 */
  segments: ConflictSegment[];
};

const toConflictSegment = (row: SegmentAttendance): ConflictSegment => ({
  id: row.segmentId,
  name: row.segmentName,
  startTime: row.startTime,
  endTime: row.endTime,
});

/**
 * 按**冲突对**输出，不是按人聚合。
 *
 * 一个人排了三个环节、其中 A∩B、B∩C 但 A∩C 不相交时，按人聚合就只能说
 * "他在 A、B、C 里有冲突"——那是句假话，A 和 C 并不冲突。成对输出让每一行
 * 都是一句能直接读的真陈述。
 */
export function findMemberTimeConflicts(
  rows: SegmentAttendance[],
): MemberTimeConflict[] {
  const byMember = new Map<number, SegmentAttendance[]>();
  for (const row of rows) {
    const bucket = byMember.get(row.memberId);
    if (bucket) bucket.push(row);
    else byMember.set(row.memberId, [row]);
  }

  const conflicts: MemberTimeConflict[] = [];

  for (const attendances of byMember.values()) {
    const sorted = [...attendances].sort(
      (a, b) =>
        a.startTime.getTime() - b.startTime.getTime() ||
        a.segmentId - b.segmentId,
    );

    // 只往后看，每对因此只会被数一次。
    for (let i = 0; i < sorted.length; i += 1) {
      const earlier = sorted[i];
      for (let j = i + 1; j < sorted.length; j += 1) {
        const later = sorted[j];

        // 已按开始时间排序：后面那个的开始一旦不早于 earlier 的结束，再往后
        // 的开始只会更晚，这一轮可以收工。
        if (later.startTime >= earlier.endTime) break;

        // 半开区间 [start, end)，和环节保存时的同线重叠判定同一套规则
        // （agenda/routes.ts 的 findOverlap）。零时长环节不占时间段，因此不和
        // 任何人任何环节冲突——上面那个 break 兜不住"零时长环节恰好卡在
        // earlier 开始那一刻"的情形，所以这里还要再判一次。
        if (later.endTime <= earlier.startTime) continue;

        conflicts.push({
          memberId: earlier.memberId,
          memberName: earlier.memberName,
          segments: [toConflictSegment(earlier), toConflictSegment(later)],
        });
      }
    }
  }

  // 页面只展示前几条，顺序必须稳定，不能跟着 Map 的插入顺序（= 数据库返回
  // 顺序）跑。最早发生的排前面。
  return conflicts.sort(
    (a, b) =>
      a.segments[0].startTime.getTime() - b.segments[0].startTime.getTime() ||
      a.segments[0].id - b.segments[0].id ||
      a.segments[1].id - b.segments[1].id ||
      a.memberId - b.memberId,
  );
}
