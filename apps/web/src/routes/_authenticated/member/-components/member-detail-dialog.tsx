import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarRangeIcon } from "lucide-react";
import { Badge } from "#/shared/components/ui/badge.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import { Skeleton } from "#/shared/components/ui/skeleton.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import type { Member, MemberParticipation } from "../-queries";
import { memberParticipationQueryOptions } from "../-queries";
import {
  MEMBER_STATUS_CHIP,
  MEMBER_STATUS_LABELS,
  formatDateRange,
  formatDateTime,
  formatDateTimeRange,
} from "../-utils";

/**
 * 字段区一行放两组「标签 / 值」。
 *
 * 弹窗宽到 4xl 之后单列排不住：值被甩到很远的右边，眼睛要横扫一整行才对得上
 * 标签，而且四段字段纵向拉得比参与信息还长，参与信息就得滚很久才看得到。
 * 窄屏（sm 以下）退回单列，两组挤在一行会各自换行，更难读。
 */
const FIELD_GRID =
  "grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-10";

type MemberDetailDialogProps = {
  member?: Member;
  onOpenChange: (open: boolean) => void;
};

export function MemberDetailDialog({
  member,
  onOpenChange,
}: MemberDetailDialogProps) {
  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      {/* 原来的 lg（32rem）装不下参与信息里那张 7 列的活动表，横向滚动条会
          常驻。宽度跟着内容走，上半部分的字段区同时改成一行两组（FIELD_GRID），
          不然拉宽之后单列字段区看着更空。 */}
      <DialogContent className="sm:max-w-5xl">
        {member && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-lg">
                  {member.name.slice(0, 1) || "?"}
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate">{member.name}</DialogTitle>
                  <DialogDescription className="truncate">
                    {member.companyPosition || "暂无职务信息"}
                  </DialogDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <StatusBadge status={member.status} />
                <span className="text-muted-foreground text-sm">
                  参与活动 {member.activityCount} 次
                </span>
              </div>
            </DialogHeader>

            <DialogBody className="flex flex-col gap-6">
              <Section title="基本信息">
                <dl className={FIELD_GRID}>
                  <Row label="姓名">{member.name || "-"}</Row>
                  <Row label="性别">{member.gender || "-"}</Row>
                  <Row label="企业（社会）职务">
                    {member.companyPosition || "-"}
                  </Row>
                  <Row label="国别 / 地区">{member.countryRegion || "-"}</Row>
                  <Row label="籍贯">{member.nativePlace || "-"}</Row>
                  <Row label="启用状态">
                    <StatusBadge status={member.status} />
                  </Row>
                </dl>
              </Section>

              <Section title="证件信息">
                <dl className={FIELD_GRID}>
                  <Row label="证件类型">{member.idType || "-"}</Row>
                  <Row label="证件号码">{member.idNumber || "-"}</Row>
                </dl>
              </Section>

              <Section title="联系方式">
                <dl className={FIELD_GRID}>
                  <Row label="手机号">{member.mobile || "-"}</Row>
                  <Row label="电话">{member.phone || "-"}</Row>
                  <Row label="邮箱">{member.email || "-"}</Row>
                  <Row label="语种">{member.language || "-"}</Row>
                </dl>
              </Section>

              <Section title="记录信息">
                <dl className={FIELD_GRID}>
                  <Row label="参与活动数">{member.activityCount}</Row>
                  <Row label="创建时间">{formatDateTime(member.createdAt)}</Row>
                  <Row label="修改时间">{formatDateTime(member.updatedAt)}</Row>
                </dl>
              </Section>

              {member.remark && (
                <Section title="备注 / 说明">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {member.remark}
                  </p>
                </Section>
              )}

              <Section title="参与信息">
                <ParticipationList memberId={member.id} />
              </Section>
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  return <Badge className={MEMBER_STATUS_CHIP[status]}>{MEMBER_STATUS_LABELS[status]}</Badge>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}

const CN_NUMERALS = "一二三四五六七八九十";

/** 项目分组用中文序号，超过十个退回阿拉伯数字——十一、十二拼起来更难扫。 */
const groupIndex = (index: number) =>
  index < CN_NUMERALS.length ? CN_NUMERALS[index] : String(index + 1);

/**
 * 按项目分组的参与列表。
 *
 * 单独抽成组件而不是把 useQuery 写在弹窗里：弹窗本身在 member 为 undefined
 * 时也要渲染（Dialog 靠 open 控制），写在外面就得挂 `enabled: !!member` 再处理
 * id 可能不存在的类型。渲染在 `member &&` 里面的子组件天然拿得到确定的 id。
 */
function ParticipationList({ memberId }: { memberId: number }) {
  const { data, isPending } = useQuery(memberParticipationQueryOptions(memberId));

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  const list = data?.list ?? [];

  if (list.length === 0) {
    return (
      <Empty className="rounded-lg border border-dashed py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarRangeIcon />
          </EmptyMedia>
          <EmptyTitle>这个人还没有进入任何项目</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {list.map((group, index) => (
        <ProjectGroup group={group} index={index} key={group.projectId} />
      ))}
    </div>
  );
}

function ProjectGroup({
  group,
  index,
}: {
  group: MemberParticipation;
  index: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b bg-muted/40 px-4 py-2.5">
        <span className="font-medium text-sm">
          （{groupIndex(index)}）项目名称：{group.projectName}
        </span>
        <span className="text-muted-foreground text-xs">
          项目地点 {group.location || "-"}
          <span className="mx-3 text-border">|</span>
          起止时间 {formatDateRange(group.startTime, group.endTime)}
        </span>
      </div>

      {group.activities.length === 0 ? (
        // 项目人员关系已经建立、但还没被分到任何活动。这不是错误状态，是
        // 名单刚导入时的常态，所以说清楚"在项目里但没活动"，不用空表头糊弄。
        <p className="px-4 py-4 text-muted-foreground text-sm">
          已在项目人员名单中，暂未参与该项目下的任何活动。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-transparent">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12">序号</TableHead>
                <TableHead className="min-w-40">活动名称</TableHead>
                <TableHead className="min-w-28">活动地点</TableHead>
                {/* 活动时间最宽的形态是跨天的 `2026/09/01 09:00 - 09/05 18:00`，
                    min-w 卡在不换行的下限上，其余列才好挤。 */}
                <TableHead className="min-w-44">活动时间</TableHead>
                <TableHead className="min-w-20">人员分组</TableHead>
                <TableHead className="min-w-20">人员来源</TableHead>
                <TableHead className="min-w-28">参与环节</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.activities.map((row, rowIndex) => (
                <TableRow key={row.activityMemberId}>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {rowIndex + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {/* 原型在最后放了一列"操作 / 查看"。这里把链接挂在活动名
                        上——弹窗里少一列是实打实的宽度，能力一模一样，也跟
                        项目详情页里点活动名跳转的做法一致。 */}
                    <Link
                      className="text-primary hover:underline"
                      params={{
                        activityId: String(row.activityId),
                        projectId: String(group.projectId),
                      }}
                      to="/project/$projectId/activity/$activityId"
                    >
                      {row.activityName}
                    </Link>
                  </TableCell>
                  <TableCell>{row.location || "-"}</TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateTimeRange(row.startTime, row.endTime)}
                  </TableCell>
                  <TableCell>{row.groupName || "-"}</TableCell>
                  <TableCell>{row.source || "-"}</TableCell>
                  <TableCell>
                    {row.segmentNames.length > 0
                      ? row.segmentNames.join("、")
                      : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-right">{children}</dd>
    </>
  );
}
