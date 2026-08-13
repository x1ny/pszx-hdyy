import { Badge } from "#/shared/components/ui/badge.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import type { Member } from "../-queries";
import { MEMBER_STATUS_CHIP, MEMBER_STATUS_LABELS, formatDateTime } from "../-utils";

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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
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

            <div className="flex flex-col gap-6">
              <Section title="基本信息">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
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
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  <Row label="证件类型">{member.idType || "-"}</Row>
                  <Row label="证件号码">{member.idNumber || "-"}</Row>
                </dl>
              </Section>

              <Section title="联系方式">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  <Row label="手机号">{member.mobile || "-"}</Row>
                  <Row label="电话">{member.phone || "-"}</Row>
                  <Row label="邮箱">{member.email || "-"}</Row>
                  <Row label="语种">{member.language || "-"}</Row>
                </dl>
              </Section>

              <Section title="记录信息">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
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
            </div>
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
