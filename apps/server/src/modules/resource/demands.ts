import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { db } from "../../infra/db";
import { activitySegment } from "../agenda/schema";
import { activityMember } from "../member/schema";
import {
  activityResource,
  type DemandHandling,
  RESOURCE_TYPE_LABELS,
  type ResourceType,
  resourceDemandLink,
  resourceMemberBinding,
  segmentResourceDemand,
} from "./schema";

/**
 * 资源模块的**事务级写入原语**。
 *
 * 抽出来的原因和 member/ladder.ts 是同一个：环节配置页（agenda 模块的
 * saveSegmentConfig）要在自己的事务里写需求项、资源记录和人员绑定，而这三件事
 * 各自都带着不写进表约束的业务规则——资源类型必须和需求一致、`record_only`
 * 的需求不能挂资源、物料不绑人、作废资源不再接受绑定。
 *
 * 如果让 agenda 那边照着 routes.ts 再实现一遍，两份实现迟早漂移，而漂移的
 * 症状是"从台账页建的车会拦，从环节页建的车不拦"——同一条规则在两个入口下
 * 表现不同，是最难查的一类问题。
 *
 * 所以规矩同 ladder：**这些规则只有这一份实现，两个模块的 routes 都调它。**
 * 全部函数都要求调用方传事务句柄——它们从来不是独立的一步，中途失败必须
 * 跟着外层一起回滚。
 */

/** 事务句柄。drizzle 没导出这个类型，从 db.transaction 的回调参数上取。 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const demandFields = {
  id: segmentResourceDemand.id,
  activityId: segmentResourceDemand.activityId,
  segmentId: segmentResourceDemand.segmentId,
  resourceType: segmentResourceDemand.resourceType,
  handling: segmentResourceDemand.handling,
  description: segmentResourceDemand.description,
  estimatedCount: segmentResourceDemand.estimatedCount,
  ownerName: segmentResourceDemand.ownerName,
};

export const resourceFields = {
  id: activityResource.id,
  activityId: activityResource.activityId,
  resourceType: activityResource.resourceType,
  transportScene: activityResource.transportScene,
  name: activityResource.name,
  quantity: activityResource.quantity,
  startTime: activityResource.startTime,
  endTime: activityResource.endTime,
  location: activityResource.location,
  vehicleInfo: activityResource.vehicleInfo,
  driverName: activityResource.driverName,
  driverPhone: activityResource.driverPhone,
  ownerName: activityResource.ownerName,
  remark: activityResource.remark,
  status: activityResource.status,
  createdAt: activityResource.createdAt,
  updatedAt: activityResource.updatedAt,
};

/**
 * 校验这批需求项可以被这条资源满足。三件事一起查：
 *
 * 1. **同属一个活动**。表上的复合外键已经保证了这点，但违反时抛的是一条
 *    Postgres 约束错误，会穿过 index.ts 的 onError 变成 500——用户看到
 *    "服务器内部错误"，而这本该是一句人话。
 * 2. **资源类型一致**。一条"用车"需求只能由用车记录满足。不校验的话，把一条
 *    物料记录关联到用车需求上，那条需求立刻变成"已配置"——完整性检查报的是
 *    绿灯，实际那个环节的车根本没人管。这是最隐蔽的一种脏数据：状态是对的
 *    形状，内容是错的。
 * 3. **处理要求必须是"落实安排"**。`record_only` 按定义就不产生台账记录，
 *    deriveDemandStatus 对它连关联数都不看，硬关联上去只会攒出一份查不到、
 *    用不上的死数据。
 *
 * **必须在任何写入之前调用**——`/update` 曾经把它放在 UPDATE 之后，校验失败
 * 时事务照常提交，用户收到一句错误提示，但名称、时间、车辆已经改掉了，
 * 而关联没换。半提交比彻底失败更难查。
 */
export async function checkDemandsLinkable(
  tx: Tx,
  activityId: number,
  resourceType: ResourceType,
  demandIds: readonly number[],
): Promise<string | null> {
  if (demandIds.length === 0) return null;

  const rows = await tx
    .select({
      id: segmentResourceDemand.id,
      resourceType: segmentResourceDemand.resourceType,
      handling: segmentResourceDemand.handling,
    })
    .from(segmentResourceDemand)
    .where(
      and(
        inArray(segmentResourceDemand.id, [...demandIds]),
        eq(segmentResourceDemand.activityId, activityId),
      ),
    );

  if (rows.length !== demandIds.length) {
    return "所选的环节资源需求不存在或不属于当前活动";
  }

  const mismatched = rows.find((row) => row.resourceType !== resourceType);
  if (mismatched) {
    return `资源类型与所选需求不一致：该需求要的是${RESOURCE_TYPE_LABELS[mismatched.resourceType]}`;
  }

  const recordOnly = rows.find((row) => row.handling !== "arrange");
  if (recordOnly) {
    return "处理要求为「仅记录需求」的需求项不需要关联资源记录";
  }

  return null;
}

/** 整体替换一条资源记录关联的需求项。调用前须已通过 checkDemandsLinkable。 */
export async function replaceDemandLinks(
  tx: Tx,
  resourceId: number,
  activityId: number,
  demandIds: readonly number[],
  userId: string,
) {
  await tx
    .delete(resourceDemandLink)
    .where(eq(resourceDemandLink.resourceId, resourceId));

  if (demandIds.length === 0) return;

  await tx.insert(resourceDemandLink).values(
    demandIds.map((demandId) => ({
      demandId,
      resourceId,
      activityId,
      createdBy: userId,
    })),
  );
}

/**
 * 建一条需求↔资源关联，已存在时什么都不做。
 *
 * ⚠️ 和 replaceDemandLinks 的差别是整个环节配置页能不能安全并存的关键：台账页
 * 站在**资源**的角度，"这条车服务哪几条需求"是它的完整视野，整体替换是对的；
 * 环节配置页站在**一条需求**的角度，它根本看不到这条车还服务着别的环节，用
 * 替换语义就会把别人的关联抹掉。所以这边只能是增量。
 */
export async function ensureDemandLink(
  tx: Tx,
  input: {
    demandId: number;
    resourceId: number;
    activityId: number;
    userId: string;
  },
) {
  await tx
    .insert(resourceDemandLink)
    .values({
      demandId: input.demandId,
      resourceId: input.resourceId,
      activityId: input.activityId,
      createdBy: input.userId,
    })
    .onConflictDoNothing();
}

/** 解除一条需求↔资源关联。资源本身不受影响——它是活动级的。 */
export async function removeDemandLink(
  tx: Tx,
  demandId: number,
  resourceId: number,
) {
  await tx
    .delete(resourceDemandLink)
    .where(
      and(
        eq(resourceDemandLink.demandId, demandId),
        eq(resourceDemandLink.resourceId, resourceId),
      ),
    );
}

export type DemandDraft = {
  resourceType: ResourceType;
  handling: DemandHandling;
  description: string | null;
  estimatedCount: number | null;
  ownerName: string | null;
};

/**
 * 整体替换一个环节的需求项集合。传进来的 upsert，没传的删除。
 *
 * 调用方必须已经锁住环节行并确认它不是作废态——两个入口（台账页的
 * saveForSegment 和环节配置页的 saveSegmentConfig）各自有更早的校验需要做，
 * 把锁和校验留在外面，这里只负责写。
 */
export async function replaceSegmentDemands(
  tx: Tx,
  input: {
    segmentId: number;
    activityId: number;
    demands: readonly DemandDraft[];
    userId: string;
  },
) {
  const keepTypes = input.demands.map((d) => d.resourceType);

  // 先删：本次没提交的类型 = 用户关掉的需求。
  // link 表上 fk_link_demand_activity 带 cascade，关联关系跟着走。
  await tx
    .delete(segmentResourceDemand)
    .where(
      and(
        eq(segmentResourceDemand.segmentId, input.segmentId),
        keepTypes.length > 0
          ? notInArray(segmentResourceDemand.resourceType, keepTypes)
          : undefined,
      ),
    );

  if (input.demands.length === 0) return [];

  // 再 upsert。冲突键就是矩阵那条唯一约束——重复保存同一个环节时走更新，
  // 不会因为"已经有一条用车需求"而报错。
  return await tx
    .insert(segmentResourceDemand)
    .values(
      input.demands.map((d) => ({
        ...d,
        segmentId: input.segmentId,
        activityId: input.activityId,
        createdBy: input.userId,
        updatedBy: input.userId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        segmentResourceDemand.segmentId,
        segmentResourceDemand.resourceType,
      ],
      set: {
        handling: sql`excluded.handling`,
        description: sql`excluded.description`,
        estimatedCount: sql`excluded.estimated_count`,
        ownerName: sql`excluded.owner_name`,
        updatedBy: input.userId,
        updatedAt: new Date(),
      },
    })
    .returning(demandFields);
}

/**
 * 绑定服务名单，入参是**活动人员关系 id**。
 *
 * 和 routes.ts 的 `/bindMembers` 差一层：那个入口拿的是主档 memberId（选择器
 * 从全量库出来），这里拿的是 activity_member.id（环节配置页的候选池就是本
 * 环节人员，它们本来就带着活动关系 id）。多绕一次 memberId → 关系 id 的换算
 * 只会多一次可能失败的查询。
 *
 * 增量 + 幂等：`onConflictDoNothing`。**绝不整表替换**——这条车上可能绑着不
 * 属于本环节的人，环节配置页看不到他们，按页面状态替换就是静默删数据。
 */
export async function bindResourceMembers(
  tx: Tx,
  input: {
    resourceId: number;
    activityMemberIds: readonly number[];
    userId: string;
  },
): Promise<string | null> {
  if (input.activityMemberIds.length === 0) return null;

  const [resource] = await tx
    .select({
      activityId: activityResource.activityId,
      resourceType: activityResource.resourceType,
      status: activityResource.status,
    })
    .from(activityResource)
    .where(eq(activityResource.id, input.resourceId));

  if (!resource) return "资源记录不存在";

  // 物料是活动通用型资源，不绑人（BR-DEV-033A）。挡在这里而不是让它存进去：
  // 存进去的绑定既不参与配置状态判定，台账页也不会展示，是一份查不到、
  // 用不上、还会在导出时冒出来的数据。
  if (resource.resourceType === "material") return "物料记录不绑定人员";

  if (resource.status === "voided") {
    return "已作废的资源记录不能再绑定人员";
  }

  const relations = await tx
    .select({ id: activityMember.id, memberId: activityMember.memberId })
    .from(activityMember)
    .where(
      and(
        eq(activityMember.activityId, resource.activityId),
        inArray(activityMember.id, [...input.activityMemberIds]),
      ),
    );

  if (relations.length !== input.activityMemberIds.length) {
    return "所选人员中有人不在本活动人员库，请先加入活动人员";
  }

  await tx
    .insert(resourceMemberBinding)
    .values(
      relations.map((relation) => ({
        resourceId: input.resourceId,
        activityId: resource.activityId,
        activityMemberId: relation.id,
        memberId: relation.memberId,
        createdBy: input.userId,
      })),
    )
    .onConflictDoNothing();

  return null;
}

/** 按绑定记录 id 精确解绑。同样是增量语义，见 bindResourceMembers 的说明。 */
export async function unbindResourceMembers(
  tx: Tx,
  bindingIds: readonly number[],
) {
  if (bindingIds.length === 0) return;

  await tx
    .delete(resourceMemberBinding)
    .where(inArray(resourceMemberBinding.id, [...bindingIds]));
}

/**
 * 环节必须存在、不是作废态，并**锁住它那一行**。
 *
 * 锁的理由和 saveForSegment 里那句一样：需求项是"先删后插"的整体替换，两个
 * 并发请求交叉执行会互相删掉对方刚插入的行。锁在环节粒度，不同环节互不阻塞。
 */
export async function lockWritableSegment(
  tx: Tx,
  segmentId: number,
): Promise<
  { ok: true; activityId: number } | { ok: false; message: string | null }
> {
  const [segment] = await tx
    .select({
      activityId: activitySegment.activityId,
      status: activitySegment.status,
    })
    .from(activitySegment)
    .where(eq(activitySegment.id, segmentId))
    .for("update");

  // message 为 null 表示"环节不存在"，由调用方翻译成 NOT_FOUND；有 message
  // 的是业务失败。两种要分开，前者不该报成一句校验错误。
  if (!segment) return { ok: false, message: null };

  // 作废环节不再接受新的资源需求声明。文档 §8.2 对环节作废的定义是
  // "不再进入新排位"，同一口径下也不该再产生新的资源待办——它的需求项
  // 本来就被 isOpenTodo 过滤在待办之外，改了也是死数据。
  if (segment.status === "voided") {
    return { ok: false, message: "环节已作废，不能再维护它的资源需求" };
  }

  return { ok: true, activityId: segment.activityId };
}
