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

/**
 * 总览页那四块上显示的数。
 *
 * 和 `detail` **故意分开**：`detail` 是给待办清单读的一句话（"2 个环节开启排位：
 * 1 个未配置"），塞进卡片会把四块撑成四段话；这个是给"扫一眼"用的（"1/2"），
 * 反过来塞进待办行又说不清缺什么。同一份判定出两种粒度，比让前端去解析
 * `detail` 里的数字靠谱——那种解析改一个字就静默失效。
 *
 * `value` 是字符串不是数字：一半的项天然是分数（`1/2` 已确认）。
 */
export type ConfigMetric = { value: string; unit: string };

export type ConfigItem = {
  key: string;
  label: string;
  status: ConfigItemStatus;
  /** 当前情况的一句话，done 和 missing 都要有。 */
  detail: string;
  /** 缺什么、怎么补。只有 missing 才有。 */
  hint: string | null;
  /** 总览四块上的数。每一项都有——每一项都归四块中的某一块。 */
  metric: ConfigMetric;
  /**
   * 跳去哪个子页面。用活动详情下的相对路径段，前端拼完整路由——服务端不该
   * 知道前端的路由形状，但"这一项归哪一页管"确实是业务知识。
   */
  tab: string;
};

/** 分母只算真正适用的项：`已配置项 / 应配置项`，不出百分比。 */
const countable = (item: ConfigItem) =>
  item.status === "done" || item.status === "missing";

// ---------------------------------------------------------------------------
// 各项的判定
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 曾经有第七项「活动基础信息」（地点 / 简介 / 主办 / 承办 填没填全），
// **2026-09-09 按产品口径删掉了**
// ---------------------------------------------------------------------------
//
// 那四个字段确实有下游消费方（地点和简介给 H5 展示，主办/承办给邀请函正文套
// 模板），但它们**不是配置流程的一步**——"这场活动就是没有承办单位"是常态，
// 不是漏配。把它做成一条会变红的待办，用户学会的是无视那条红提示，顺带无视
// 旁边真正的待办；而字段本身就摆在活动总览的基础信息卡上，空着一眼就看得见。
//
// 删干净而不是留着不展示：一个还在算、还占分母、却没有任何读者的判定，下一个
// 人得先花时间确认"是不是哪里漏了没接上"（同这个文件顶上删 `module_pending`
// 的理由）。真要恢复，git 历史里有完整的 `checkBasic`。

/**
 * 活动场地。**只有 done 和 missing 两态：零可用区域一律报缺。**
 *
 * 这一项曾经跟着排位走——一个环节都没开排位时报 not_applicable，理由是
 * BR-DEV-031A 说这一层不是环节保存的前置条件，普通环节的地点录一行文本就行，
 * 不该挂一个永远红着的待办。
 *
 * **2026-09-09 按产品口径改掉了**：新建的活动本来就还没有环节、更没有环节开
 * 排位，于是场地这一格开局就是灰的"不适用"，而实际上"这场活动在哪个场地、
 * 分几块区域"恰恰是最该先配的东西之一。让系统按"你还没开排位"去替用户判断
 * "你不需要场地"，在空活动上一定判错，而这正是用户最需要提示的时刻。
 *
 * 代价是确实有一类活动永远不需要场地底图（纯线上、或者地点只用一行文本），
 * 它们会一直看到这一格报缺。这是有意接受的：缺失只提示、不阻断发布，一个
 * 说错了的提示比一个该说没说的沉默便宜。
 *
 * "配好了"的判据是**有没有可用区域**，不是有没有引用场地——区域才是排位和
 * 环节地点真正要挑的东西。引用了场地但区域全停用（或源场地本身没画区域）
 * 照样算缺，那时排位建不起来，报 done 是骗人的。
 */
export function checkVenue(input: {
  venues: number;
  zones: number;
  capacity: number;
  venueRows: number;
}): ConfigItem {
  // metric 两个分支同一个：区域数在 missing 分支里就是 0，正好是要说的事。
  const item = {
    key: "venue",
    label: "活动场地",
    tab: "venue",
    metric: { value: String(input.zones), unit: "个可用区域" },
  };

  if (input.zones > 0) {
    return {
      ...item,
      status: "done",
      detail: `已引用 ${input.venues} 个场地、${input.zones} 个区域，可用点位 ${input.capacity}`,
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
        ? "先从场地库引用一个场地：环节地点和座位安排都要从活动区域里选"
        : "到活动场地把要用的区域启用，或者重新引用一个带区域的场地",
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
  const item = {
    key: "seating",
    label: "座位安排",
    tab: "seating",
    // 没有环节开排位时给 0 而不是 "0/0"：分母是 0 的分数读起来像坏了。
    metric:
      summary.applicable === 0
        ? { value: "0", unit: "个环节开启排位" }
        : {
            value: `${summary.confirmed}/${summary.applicable}`,
            unit: "个环节已确认排位",
          },
  };

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
      ? `到座位安排页给这 ${summary.applicable - summary.confirmed} 个环节建方案并提交确认`
      : "排位要先有可用区域：按「活动场地」那一项补好，再回座位安排页建方案",
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
  const item = {
    key: "invitation",
    label: "邀请函",
    tab: "invitations",
    metric: { value: String(input.batches), unit: "批邀请函" },
  };

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
   * 每一项的判定都是**纯函数**（`checkVenue` / `checkSeating` /
   * `checkInvitation`），取数留在 handler 里。这么切是为了让判定能被测：判定
   * 错了不报错，只会在页面上显示一个错的数字或一个错的颜色，是最难发现的那
   * 类 bug；取数那几个 count 反而没什么可测的。
   */
  .post(
    "/status",
    jsonBody(z.object({ activityId: z.number().int().positive() })),
    async (c) => {
      const { activityId } = c.req.valid("json");

      // 只为了确认活动存在——配置项一项都不读活动表自己的列了。
      const [row] = await db
        .select({ id: activity.id })
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
         * 场地的三个数一次查完，按 `status = active` 的场地和区域算。
         *
         * 已从活动空间移除的场地不再属于当前配置，不能继续贡献区域和点位；
         * 排位选择器本身仍可读取历史快照，避免作废方案失去追溯能力。
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
          .innerJoin(
            activityVenue,
            and(
              eq(activityVenue.id, activityVenueZone.activityVenueId),
              eq(activityVenue.activityId, activityVenueZone.activityId),
            ),
          )
          .where(
            and(
              eq(activityVenueZone.activityId, activityId),
              eq(activityVenueZone.status, "active"),
              eq(activityVenue.status, "active"),
            ),
          ),
        // 只为了把"一个场地都没引用"和"引用了但区域都停用了"分开说——两种
        // 情况的补法不一样，一句笼统的提示会把人指错地方。
        db
          .select({ n: count() })
          .from(activityVenue)
          .where(
            and(
              eq(activityVenue.activityId, activityId),
              eq(activityVenue.status, "active"),
            ),
          ),
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
      const invitations = {
        batches: batchRow?.n ?? 0,
        letters: letterRow?.n ?? 0,
      };

      const items: ConfigItem[] = [
        {
          key: "agenda",
          label: "活动议程",
          status: segmentCount > 0 ? "done" : "missing",
          detail:
            segmentCount > 0
              ? `已配置 ${segmentCount} 个正常环节`
              : "还没有任何环节",
          hint:
            segmentCount > 0
              ? null
              : "议程是活动的骨架，先把环节建起来，排位和资源需求都挂在它下面",
          metric: { value: String(segmentCount), unit: "个环节" },
          tab: "agenda",
        },

        {
          key: "members",
          label: "人员名单",
          status: memberCount > 0 ? "done" : "missing",
          detail:
            memberCount > 0
              ? `已有 ${memberCount} 名活动人员`
              : "还没有活动人员",
          hint:
            memberCount > 0
              ? null
              : "邀请函、排位、资源服务绑定都从人员名单取数，这一层不建后面都动不了",
          metric: { value: String(memberCount), unit: "名活动人员" },
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
          label: "需求总览",
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
              ? "到需求总览页看待办，按类型跳资源安排建记录或绑定服务名单"
              : null,
          // 没有需求时说总数（0），有需求时说落实进度——分母是 0 的分数读不通。
          metric:
            demands.total === 0
              ? { value: "0", unit: "项资源需求" }
              : {
                  value: `${demands.total - demands.open}/${demands.total}`,
                  unit: "项需求已落实",
                },
          tab: "resources",
        },

        checkVenue({ ...zoneStats, venueRows }),

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
