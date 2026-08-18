import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../infra/db";
import { err, ok } from "../../shared/result";
import { jsonBody } from "../../shared/validate";
import { activitySegment } from "../agenda/schema";
import { type AuthedVariables, requireUser } from "../auth";
import { activityMember } from "../member/schema";
import { activity } from "../project/schema";
import { summarizeDemands } from "../resource/stats";

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
 * `not_applicable` 和 `module_pending` 都**不计入分母**，但含义不同：
 * 前者是"这个活动确实不需要"（没声明任何资源需求），后者是"这块功能还没建成"。
 * 混成一个的话，页面就没法告诉用户"这里将来会有东西"还是"这里本来就没有"。
 */
export const CONFIG_ITEM_STATUSES = [
  "done",
  "missing",
  "not_applicable",
  "module_pending",
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

export const activityConfigRoutes = new Hono<{ Variables: AuthedVariables }>()
  .use(requireUser)

  /**
   * 活动配置完成情况。
   *
   * 返回的是一个**描述符数组**而不是一堆散装字段：加一个模块 = 往数组里加
   * 一项，前端一个字不用改。场地、排位、邀请函现在是 `module_pending` 占位，
   * 等那三个模块建成，把对应分支换成真判定即可。
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
        return c.json(err({ code: "NOT_FOUND" as const, message: "活动不存在" }));
      }

      const [[segments], [members], demands] = await Promise.all([
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
      ]);

      const segmentCount = segments?.n ?? 0;
      const memberCount = members?.n ?? 0;

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
            memberCount > 0 ? `已有 ${memberCount} 名活动人员` : "还没有活动人员",
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

        // 下面三项的模块还没建。它们**照常出现在清单里但不进分母**——让用户
        // 看得到"这里将来会有东西"，同时不会因为功能没做而把进度算成永远不满。
        {
          key: "venue",
          label: "场地空间",
          status: "module_pending",
          detail: "场地库与活动空间底图，模块尚未建设",
          hint: null,
          tab: null,
        },
        {
          key: "seating",
          label: "排位方案",
          status: "module_pending",
          detail: "环节排位方案与座位分配，模块尚未建设",
          hint: null,
          tab: null,
        },
        {
          key: "invitation",
          label: "邀请函",
          status: "module_pending",
          detail: "邀请函模块已建成，但尚未接入活动维度",
          hint: null,
          tab: null,
        },
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
