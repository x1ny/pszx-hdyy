import type { InvitationIssuer } from "./types.ts";

export const ISSUER_VALUES = [
  "alliance",
  "chamber",
  "taskforce",
  "plain",
] as const satisfies readonly InvitationIssuer[];

export const ISSUER_LABELS = {
  alliance: "联盟",
  chamber: "商会",
  taskforce: "专班",
  plain: "通用",
} as const satisfies Record<InvitationIssuer, string>;

export type IssuerVisual = {
  label: string;
  /** 联盟才有 logo 图片，商会/专班用抬头文字，通用两者都没有。 */
  logo?: string;
  headerText?: string;
  /** 底部波浪装饰，通用样式不显示。 */
  showWave: boolean;
  salutation: (recipientName: string) => string;
};

/**
 * 发函主体 → 视觉样式（logo/抬头/称谓）的唯一查表点。
 *
 * 旧系统是拿字典标签做正则匹配「联盟/商会/专班」关键字去猜该用哪套样式，
 * 字典标签一改渲染就跟着漂移。issuer 现在是显式存在数据库里的枚举字段，
 * 直接查表，`satisfies Record<...>` 保证新增一个 issuer 值必须同时补上视觉
 * 映射，不会出现「新枚举值没有样式」的漏网之鱼。
 */
// **不用 `as const satisfies`。** 四个分支的可选字段（logo/headerText）形状
// 不完全一样，`as const` 会让每个分支保留各自的窄类型，索引访问
// `ISSUER_VISUAL[someIssuerUnion]` 时 TS 给回来的是四个分支类型的联合，
// 而不是统一的 `IssuerVisual`，导致 `.logo`/`.headerText` 在其它分支上访问不到。
// 显式标注成 `Record<InvitationIssuer, IssuerVisual>` 把每个分支都加宽成同一个
// 接口，索引访问才会得到确定的 `IssuerVisual`——穷尽性检查（少一个 key 编译不过）
// 不受影响，两种写法都有。
export const ISSUER_VISUAL: Record<InvitationIssuer, IssuerVisual> = {
  alliance: {
    label: ISSUER_LABELS.alliance,
    logo: "/invitation/alliance-logo.png",
    showWave: true,
    salutation: (name) => `尊敬的 ${name}：`,
  },
  chamber: {
    label: ISSUER_LABELS.chamber,
    headerText: "泉州市纺织服装商会",
    showWave: true,
    salutation: (name) => `${name}：`,
  },
  taskforce: {
    label: ISSUER_LABELS.taskforce,
    headerText: "泉州市打造“世遗泉州 时尚之都”工作专班办公室",
    showWave: true,
    salutation: (name) => `${name}：`,
  },
  plain: {
    label: ISSUER_LABELS.plain,
    showWave: false,
    salutation: (name) => `尊敬的 ${name}：`,
  },
};
