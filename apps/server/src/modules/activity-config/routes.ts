import { and, count, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { invitationBatch, invitationRecord } from "../invitation/schema";
import { activityMember } from "../member/schema";
import { activity } from "../project/schema";
import { summarizeDemands } from "../resource/stats";
import { type SeatingSummary, summarizeSeating } from "../seating/stats";
import { activityVenue, activityVenueZone } from "../venue/schema";

// ---------------------------------------------------------------------------
// 这个模块**没有 schema.ts**，是有意的
// ---------------------------------------------------------------------------
//
// 文档 §8.1 把"活动配置项完成情况"写成了一个数据对象（活动ID、应完成项清单、
// 已完成项清单、缺失项清单、配置项状态、**更新时间、触发来源**），§7.1 第 8 条
// 还写着配置中心"自动更新完整性提示"——两处合起来就是一张要维护的表。
//
// 这里不建。理由和资源需求项的配置状态是同一条，但更强烈：
//
// 那张表要聚合**五个来源**（环节、资源、场地、排位、人员绑定）。落成存储就
// 意味着这五个模块每一次写入都要记得触发重算，漏一个，总览就开始说谎——而且
// 是往"已配置"的方向说谎，体检表报绿灯而实际没配。这种谎最难发现：页面看着
// 一切正常，只有到了活动当天才知道漏了。
//
// 配置项撑死十来项，读时现算就是几个 count。真到了要"记录谁在什么时候把它
// 配齐的"，那是操作日志该干的事，不是让一张汇总表兼职。

// ---------------------------------------------------------------------------
// 配置项描述符
// ---------------------------------------------------------------------------

/**
 * 一个配置项的状态。
 *
 * `not_applicable` **不计入分母**，含义是"这个活动确实不需要这一项"——没声明任何
 * 资源需求、没有环节开排位、没生成过邀请函。它和 `missing`（该有而没有）的区别
 * 是整张表的意义所在：混成一个，页面就只会一片红。
 *
 * 曾经还有第四个 `module_pending`（"这块功能还没建成"），场地、排位、邀请函三项
 * 靠它占位。三个模块建成之后它一个生产者都不剩，已删除——一个有定义、有图标、有
 * 样式却永远不会出现的分支，只会让下一个人先花时间确认"是不是哪里漏了没接上"。
 */
export const CONFIG_ITEM_STATUSES = [
  "done",
  "missing",
  "not_applicable",
] as const;
export type ConfigItemStatus = (typeof CONFIG_ITEM_STATUSES)[number];

export type ConfigItem = {
  key: string;
  label: string;
  status: ConfigItemStatus;
  /** 当前情况的一句话，done 和 missing 都要有。 */
  detail: string;
  /** 缺什么、怎么补。只有 missing 才有。 */
  hint: string | null;
  /**
   * 跳去哪个标签页。用活动详情下的相对路径段，前端拼完整路由——服务端不该
   * 知道前端的路由形状，但"这一项归哪个标签管"确实是业务知识。
   */
  tab: string | null;
};

/** 分母只算真正适用的项：`已配置项 / 应配置项`，不出百分比。 */
const countable = (item: ConfigItem) =>
  item.status === "done" || item.status === "missing";

// ---------------------------------------------------------------------------
// 各项的判定
// ---------------------------------------------------------------------------

/**
 * 活动基础信息。
 *
 * 名称和起止时间在表上就是 notNull，永远不缺，判不判都一样；真正会空着的是
 * 这四项。挑它们不是随手划的线：地点和简介是 H5 展示要读的，主办/承办单位
 * 是邀请函正文要套的——都有确定的下游消费方。预算、支持单位、指导单位不算，
 * 那几项确实存在"这场活动就是没有"的正常情况。
 *
 * 缺哪几项直接写进 hint，不做黑盒——"基础信息未完善"这种提示，用户还得自己
 * 回去一个字段一个字段找。
 */
function checkBasic(row: {
  location: string | null;
  description: string | null;
  hostOrg: string | null;
  organizerOrg: string | null;
}): ConfigItem {
  const missing = [
    !row.location && "活动地点",
    !row.description && "活动简介",
    !row.hostOrg && "主办单位",
    !row.organizerOrg && "承办单位",
  ].filter((x): x is string => typeof x === "string");

  return {
    key: "basic",
    label: "活动基础信息",
    status: missing.length === 0 ? "done" : "missing",
    detail:
      missing.length === 0
        ? "地点、简介、主办和承办单位均已填写"
        : `还差 ${missing.length} 项：${missing.join("、")}`,
    hint: missing.length === 0 ? null : "回到活动概览，编辑活动补齐这几项",
    tab: null,
  };
}

/**
 * 场地空间。
 *
 * 适用性跟排位走。BR-DEV-031A 明说这一层**不是环节保存的前置条件**：普通环节的
 * 地点先用一行文本录入就行，只有"需要精确空间或要排位"时才进这里。"需要精确
 * 空间"系统判断不了，"要排位"判断得了——而且排位方案建立时必须选一块活动区域，
 * 没底图就根本建不起来。所以一个环节都没开排位时这一项是 not_applicable，而不是
 * 一个永远红着的待办。
 *
 * ⚠️ **done 的判断排在适用性前面**，顺序不能换：已经引用过场地的活动，哪怕一个
 * 环节都没开排位也报"已配置"。已经做过的事不该被系统说成"不需要做"。
 *
 * "配好了"的判据是**有没有可用区域**，不是有没有引用场地——区域才是排位真正要挑
 * 的东西。零区域也算缺：源场地本身没画区域时就会撞上，那时排位照样建不起来，
 * 报 done 是骗人的。
 */
export function checkVenue(input: {
  venues: number;
  zones: number;
  capacity: number;
  venueRows: number;
  seatingApplicable: number;
}): ConfigItem {
  const item = { key: "venue", label: "场地空间", tab: "venue" };

  if (input.zones > 0) {
    return {
      ...item,
      status: "done",
      detail: `已引用 ${input.venues} 个场地、${input.zones} 个区域，可用点位 ${input.capacity}`,
      hint: null,
    };
  }

  if (input.seatingApplicable === 0) {
    return {
      ...item,
      status: "not_applicable",
      detail: "本活动没有环节需要排位，未使用空间底图",
      hint: null,
    };
  }

  return {
    ...item,
    status: "missing",
    detail:
      input.venueRows === 0
        ? "还没有从场地库引用任何场地"
        : `已引用 ${input.venueRows} 个场地，但一个可用区域都没有`,
    hint:
      input.venueRows === 0
        ? "排位方案要从活动区域里选，先从场地库引用一个场地"
        : "到场地空间把要用的区域启用，或者重新引用一个带区域的场地",
  };
}

/**
 * 排位方案。
 *
 * 适用范围完全交给 `seating/stats.ts`，这里一个 filter 都不重写——那条规则漂移过
 * 一次，代价写在那个文件的注释里。
 *
 * **pending 不算配齐**：confirm 才是对外生效的动作（方案的 `version` 只在 confirm
 * 时 +1，H5 将来读的是确认快照）。保存了但没人确认的方案，现实里等于没排。
 *
 * hint 分两种走向，因为补法不一样：场地还没配好时，用户点进排位页能做的只有被
 * 区域选择器告知"先去场地空间"，所以这里直接把他指过去。`hint` 这个字段的定义
 * 就是"缺什么、**怎么补**"，指向前置步骤不是滥用。
 *
 * 但那句话**只说"先把场地配好"，不说具体怎么配**——"去引用一个场地"这种话在
 * "场地引用了、区域全停用了"的状态下会把人指错地方。具体补法归场地那一项，它
 * 自己分得清两种情况；这里只负责把人指到那一行。
 */
export function checkSeating(
  summary: SeatingSummary,
  venueReady: boolean,
): ConfigItem {
  const item = { key: "seating", label: "排位方案", tab: "seating" };

  if (summary.applicable === 0) {
    return {
      ...item,
      status: "not_applicable",
      detail: "本活动没有环节开启排位",
      hint: null,
    };
  }

  if (summary.confirmed === summary.applicable) {
    return {
      ...item,
      status: "done",
      detail: `${summary.applicable} 个环节的排位方案均已确认`,
      hint: null,
    };
  }

  // 不列"已确认几个"：这一行是待办，说的应该是还差什么。
  const open = [
    summary.unconfigured > 0 && `${summary.unconfigured} 个未配置`,
    summary.pending > 0 && `${summary.pending} 个待确认`,
    summary.rejected > 0 && `${summary.rejected} 个已驳回`,
  ].filter((x): x is string => typeof x === "string");

  return {
    ...item,
    status: "missing",
    detail: `${summary.applicable} 个环节开启排位：${open.join("、")}`,
    hint: venueReady
      ? `到排位页给这 ${summary.applicable - summary.confirmed} 个环节建方案并提交确认`
      : "排位要先有可用区域：按上面「场地空间」那一项补好，再回排位页建方案",
  };
}

/**
 * 邀请函。**只有 done 和 not_applicable 两态，永远不产生待办。**
 *
 * 这一项是三个里唯一没有文档口径的：两份设计文档都没写，原型那一行写的是"已生成
 * 82 份 / 待提醒"，而"待提醒"依赖消息模块（未建）。所以口径是现定的——
 *
 * 系统**无从知道**这个活动该不该发邀请函，更无从知道哪些人该收。`activity_member`
 * 上没有任何"受邀人"标记，几十个活动人员里混着工作人员、司机、供应商代表，他们
 * 不收函。按"人人都该有"算覆盖率，这一项就永远红着，用户很快学会无视它，顺带
 * 无视旁边真正的待办。`invitation/schema.ts` 自己也把"活动级邀请状态"推给了将来。
 *
 * 于是适用信号只能是"用户有没有主动启用过这个能力"，也就是生成过没有——和 resource
 * 那项的 not_applicable（环节未声明任何资源需求）同构，两个都正好落在 BR-DEV-034
 * 那句「按**已启用能力**动态计算」上。
 */
export function checkInvitation(input: {
  batches: number;
  letters: number;
}): ConfigItem {
  const item = { key: "invitation", label: "邀请函", tab: "invitations" };

  if (input.batches === 0) {
    return {
      ...item,
      status: "not_applicable",
      detail: "本活动未生成邀请函",
      hint: null,
    };
  }

  return {
    ...item,
    status: "done",
    detail: `已生成 ${input.batches} 批共 ${input.letters} 份`,
    hint: null,
  };
}

export const activityConfigRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 活动配置完成情况。
   *
   * 返回的是一个**描述符数组**而不是一堆散装字段：加一个模块 = 往数组里加
   * 一项，前端一个字不用改。
   *
   * 每一项的判定都是**纯函数**（`checkBasic` / `checkVenue` / `checkSeating` /
   * `checkInvitation`），取数留在 handler 里。这么切是为了让判定能被测：判定
   * 错了不报错，只会在页面上显示一个错的数字或一个错的颜色，是最难发现的那
   * 类 bug；取数那几个 count 反而没什么可测的。
   */
  .post(
    "/status",
    jsonBody(z.object({ activityId: z.number().int().positive() })),
    async (c) => {
      const { activityId } = c.req.valid("json");

      const [row] = await db
        .select({
          id: activity.id,
          location: activity.location,
          description: activity.description,
          hostOrg: activity.hostOrg,
          organizerOrg: activity.organizerOrg,
        })
        .from(activity)
        .where(eq(activity.id, activityId));

      if (!row) {
        return c.json(
          err({ code: "NOT_FOUND" as const, message: "活动不存在" }),
        );
      }

      const [
        [segments],
        [members],
        demands,
        [zoneRow],
        [venueRow],
        seating,
        [batchRow],
        [letterRow],
      ] = await Promise.all([
        db
          .select({ n: count() })
          .from(activitySegment)
          .where(
            and(
              eq(activitySegment.activityId, activityId),
              eq(activitySegment.status, "active"),
            ),
          ),
        db
          .select({ n: count() })
          .from(activityMember)
          .where(eq(activityMember.activityId, activityId)),
        // "什么算待办"只有 resource/stats.ts 一处定义，这里不重写一遍 filter
        // ——两边各写一次，迟早出现汇总页说还差 1 项、总览说全配齐了。
        summarizeDemands(activityId),
        /**
         * 场地的三个数一次查完，**都按 `status = active` 的区域算**。
         *
         * 口径要和排位区域选择器逐字一致：它挑区域时只看 `zone.status`，
         * 不看所属场地的状态（seating-zone-picker.tsx）。这里要是多加一个
         * 场地状态的条件，就会出现"总览说场地没配好、选择器里区域好好
         * 摆着"——同一件事两处口径，正是 resource/stats.ts 那条注释在防的。
         *
         * 场地数取**拥有可用区域的场地数**（distinct），而不是另查一次场地表：
         * 三个数出自同一行过滤，显示上不会自相矛盾（否则场地停用、区域还开着
         * 时会显示"已引用 0 个场地、2 个区域"）。
         */
        db
          .select({
            venues: sql<number>`count(distinct ${activityVenueZone.activityVenueId})::int`,
            zones: count(),
            capacity: sql<number>`coalesce(sum(${activityVenueZone.capacity}), 0)::int`,
          })
          .from(activityVenueZone)
          .where(
            and(
              eq(activityVenueZone.activityId, activityId),
              eq(activityVenueZone.status, "active"),
            ),
          ),
        // 只为了把"一个场地都没引用"和"引用了但区域都停用了"分开说——两种
        // 情况的补法不一样，一句笼统的提示会把人指错地方。
        db
          .select({ n: count() })
          .from(activityVenue)
          .where(eq(activityVenue.activityId, activityId)),
        // 同 summarizeDemands：「哪些环节算开了排位」只有 seating/stats.ts
        // 一处定义，排位页和这里是同一条规则的两个读者。
        summarizeSeating(activityId),
        db
          .select({ n: count() })
          .from(invitationBatch)
          .where(eq(invitationBatch.activityId, activityId)),
        db
          .select({ n: count() })
          .from(invitationRecord)
          .where(eq(invitationRecord.activityId, activityId)),
      ]);

      const segmentCount = segments?.n ?? 0;
      const memberCount = members?.n ?? 0;
      const zoneStats = {
        venues: zoneRow?.venues ?? 0,
        zones: zoneRow?.zones ?? 0,
        capacity: zoneRow?.capacity ?? 0,
      };
      const venueRows = venueRow?.n ?? 0;
      const seatingApplicable = seating.applicable;
      const invitations = {
        batches: batchRow?.n ?? 0,
        letters: letterRow?.n ?? 0,
      };

      const items: ConfigItem[] = [
        checkBasic(row),

        {
          key: "agenda",
          label: "议程 / 环节",
          status: segmentCount > 0 ? "done" : "missing",
          detail:
            segmentCount > 0
              ? `已配置 ${segmentCount} 个正常环节`
              : "还没有任何环节",
          hint:
            segmentCount > 0
              ? null
              : "议程是活动的骨架，先把环节建起来，排位和资源需求都挂在它下面",
          tab: "agenda",
        },

        {
          key: "members",
          label: "活动人员",
          status: memberCount > 0 ? "done" : "missing",
          detail:
            memberCount > 0
              ? `已有 ${memberCount} 名活动人员`
              : "还没有活动人员",
          hint:
            memberCount > 0
              ? null
              : "邀请函、排位、资源服务绑定都从活动人员取数，这一层不建后面都动不了",
          tab: "members",
        },

        /**
         * 资源只占**一项**，不拆成"资源需求"和"资源台账"两项。
         *
         * 原型的配置域表里那两行说的是同一件事的两面：需求配没配齐，恰恰取决
         * 于台账里有没有对应记录。拆两行的结果是用户看到两个"配置中"，以为有
         * 两个待办，其实是一个；而且"台账"那一行根本没有完成的定义——一个活动
         * 完全可以不需要任何资源记录。
         */
        {
          key: "resource",
          label: "资源需求",
          status:
            demands.total === 0
              ? "not_applicable"
              : demands.open > 0
                ? "missing"
                : "done",
          detail:
            demands.total === 0
              ? "本活动的环节未声明任何资源需求"
              : demands.open > 0
                ? `${demands.total} 项声明中，${demands.pending} 项待配置、${demands.configuring} 项配置中`
                : `${demands.total} 项声明已全部落实`,
          hint:
            demands.open > 0
              ? "到资源需求页看待办，按类型跳资源台账建记录或绑定服务名单"
              : null,
          tab: "resources",
        },

        checkVenue({ ...zoneStats, venueRows, seatingApplicable }),

        checkSeating(seating, zoneStats.zones > 0),

        checkInvitation(invitations),
      ];

      const applicable = items.filter(countable);

      return c.json(
        ok({
          items,
          /**
           * 分数而不是百分比——文档两处强调过，值得守住：百分比会让 6/8 看着
           * 像个能被考核的 KPI，而这些项之间根本不等权（缺基础信息和缺邀请函
           * 差一个数量级）。
           *
           * ⚠️ 分母是**活的**：按"已启用能力"算，给某个环节打开排位开关，
           * 分母就从 5 变 6，进度看起来会倒退。这是这个口径的固有性质，
           * 不是 bug——但业务得先知道。
           */
          done: applicable.filter((item) => item.status === "done").length,
          total: applicable.length,
        }),
      );
    },
  );
