import { PlusIcon, UsersRoundIcon } from "lucide-react";
import { useState } from "react";
import {
  MemberPickerDialog,
  type PickedMember,
} from "#/features/member/member-picker-dialog.tsx";
import { MemberQuickCreateDialog } from "#/features/member/member-quick-create-dialog.tsx";
import { SEGMENT_MEMBER_ROLE_VALUES } from "#/features/member/relation-queries.ts";
import { Badge } from "#/shared/components/ui/badge.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/shared/components/ui/empty.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/shared/components/ui/table.tsx";
import type { MemberDraft, NewMemberDraft, SegmentRoleDraft } from "../-draft";
import { SectionCard } from "./section-card";

const ROLE_ITEMS = [
  { value: "", label: "请选择" },
  ...SEGMENT_MEMBER_ROLE_VALUES.map((value) => ({ value, label: value })),
];

/**
 * 环节人员配置。
 *
 * 三个和旧弹窗一致的口径，不要以为是漏做：
 *
 * - **只有「环节身份」可编辑。** 来源 / 团体 / 负责人显示的是 COALESCE 之后的
 *   值（环节层没填就取活动层），标「继承」。环节级覆盖是少数情况，先不给入口，
 *   免得运营在两层之间反复横跳还搞不清哪个生效。
 * - **「按团体添加」不在这里。** 它的冲突检测（历史异团体快照）是服务端在
 *   写入事务里做的，草稿模式下没法预演；硬把它展开成一批个人会**绕过那道
 *   检查**。要按团体加，去活动人员页或旧的环节人员弹窗。
 * - 选人和手动录入沿用现成的 MemberPickerDialog / MemberQuickCreateDialog，
 *   只是把"确认后立刻提交"换成"确认后进草稿"。
 */
export function MembersSection({
  enabled,
  members,
  projectId,
  activityId,
  onToggle,
  onAddPicked,
  onAddManual,
  onRemove,
  onRoleChange,
}: {
  enabled: boolean;
  members: MemberDraft[];
  projectId: number;
  activityId: number;
  onToggle: (checked: boolean) => void;
  onAddPicked: (rows: PickedMember[]) => void;
  onAddManual: (member: NewMemberDraft) => void;
  onRemove: (key: string) => void;
  onRoleChange: (key: string, role: SegmentRoleDraft) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  return (
    <SectionCard
      id="section-members"
      title="环节人员配置"
      summary={enabled ? `已添加 ${members.length} 人` : undefined}
      toggle={{
        checked: enabled,
        label: "开启环节人员管理",
        keptSummary: `保留 ${members.length} 人`,
        onChange: onToggle,
      }}
      actions={
        enabled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPickerOpen(true)}
          >
            <PlusIcon />
            添加人员
          </Button>
        ) : null
      }
    >
      {members.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersRoundIcon />
            </EmptyMedia>
            <EmptyTitle>还没有加人</EmptyTitle>
            <EmptyDescription>
              从活动 / 项目 / 全量人员库里选，或者直接手动录入一个新人。
              保存时会自动补齐他的活动和项目人员关系。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/60">
              <TableRow className="hover:bg-transparent">
                <TableHead className="min-w-24">姓名</TableHead>
                <TableHead className="min-w-16">性别</TableHead>
                <TableHead className="min-w-32">手机号码</TableHead>
                <TableHead className="min-w-40">企业（社会）职务</TableHead>
                <TableHead className="min-w-28">团体</TableHead>
                <TableHead className="min-w-28">来源</TableHead>
                <TableHead className="min-w-40">环节身份</TableHead>
                <TableHead className="min-w-24">负责人</TableHead>
                <TableHead className="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {row.name}
                      {row.relationId === null ? (
                        <Badge variant="outline">待保存</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{row.gender ?? "-"}</TableCell>
                  <TableCell>{row.mobile ?? "-"}</TableCell>
                  <TableCell>{row.companyPosition ?? "-"}</TableCell>
                  <TableCell>{row.groupName ?? "-"}</TableCell>
                  <TableCell>{row.source ?? "-"}</TableCell>
                  <TableCell>
                    <Select
                      items={ROLE_ITEMS}
                      value={row.segmentRole}
                      // Base UI 允许清空（回 null），空串就是「请选择」那一项。
                      onValueChange={(value) =>
                        onRoleChange(row.key, value ?? "")
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{row.ownerName ?? "-"}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onRemove(row.key)}
                    >
                      移除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-muted-foreground text-xs">
        团体、来源、负责人继承自活动人员，本页只维护环节身份。
      </p>

      <MemberPickerDialog
        open={pickerOpen}
        title="选择环节人员"
        description="选中的人会先进入草稿，点页面底部的保存才真正写入。"
        scopes={[
          { value: "activity", label: "活动人员库", activityId },
          { value: "project", label: "项目人员库", projectId },
          { value: "all", label: "全量人员库" },
        ]}
        excludeIds={members
          .map((row) => row.memberId)
          .filter((id): id is number => id !== null)}
        onOpenChange={setPickerOpen}
        onConfirmRows={(rows) => {
          onAddPicked(rows);
          setPickerOpen(false);
        }}
        // 只要行数据，id 那条回调这里用不上；两个回调是一起触发的。
        onConfirm={() => undefined}
        onCreateNew={() => {
          setPickerOpen(false);
          setQuickCreateOpen(true);
        }}
      />

      <MemberQuickCreateDialog
        open={quickCreateOpen}
        title="手动录入人员"
        description="保存整页时才会真正建档，并自动补齐项目和活动人员关系。"
        submitting={false}
        onOpenChange={setQuickCreateOpen}
        onSubmit={(values) => {
          onAddManual({
            name: values.name,
            gender: values.gender ?? "",
            companyPosition: values.companyPosition ?? "",
            mobile: values.mobile ?? "",
            idType: values.idType ?? "",
            idNumber: values.idNumber ?? "",
            remark: values.remark ?? "",
          });
          setQuickCreateOpen(false);
        }}
      />
    </SectionCard>
  );
}
