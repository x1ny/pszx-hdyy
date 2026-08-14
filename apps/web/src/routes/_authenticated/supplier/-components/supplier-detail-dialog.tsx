import { Badge } from "#/shared/components/ui/badge.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";
import type { Supplier } from "../-queries";
import {
  CATEGORY_BADGE_CLASS,
  SUPPLIER_STATUS_LABELS,
  categoryLabel,
  formatDateTime,
} from "../-utils";

type SupplierDetailDialogProps = {
  supplier?: Supplier;
  onOpenChange: (open: boolean) => void;
};

export function SupplierDetailDialog({
  supplier,
  onOpenChange,
}: SupplierDetailDialogProps) {
  return (
    <Dialog open={!!supplier} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {supplier && (
          <>
            <DialogHeader>
              <DialogTitle>{supplier.name}</DialogTitle>
              <DialogDescription>
                {[supplier.city, supplier.contactPerson]
                  .filter(Boolean)
                  .join(" · ") || "暂无联系信息"}
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="flex flex-col gap-6">
              <Section title="服务类目">
                <div className="flex flex-wrap gap-1.5">
                  {supplier.serviceCategories.length ? (
                    supplier.serviceCategories.map((category) => (
                      <Badge
                        key={category}
                        className={CATEGORY_BADGE_CLASS[category]}
                      >
                        {categoryLabel(category)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      暂无服务类目
                    </span>
                  )}
                </div>
              </Section>

              <Section title="基本信息">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                  <Row label="所在城市">{supplier.city || "-"}</Row>
                  <Row label="启用状态">
                    <Badge
                      variant={
                        supplier.status === "enabled" ? "default" : "outline"
                      }
                    >
                      {SUPPLIER_STATUS_LABELS[supplier.status]}
                    </Badge>
                  </Row>
                  <Row label="联系人">{supplier.contactPerson || "-"}</Row>
                  {/* 详情页展示完整号码，列表里打码 —— 跟旧系统一致。
                      注意那只是排版，不是权限控制（列表接口本来就返回了完整号码）。 */}
                  <Row label="联系电话">{supplier.contactPhone || "-"}</Row>
                  <Row label="创建时间">
                    {formatDateTime(supplier.createdAt)}
                  </Row>
                  <Row label="修改时间">
                    {formatDateTime(supplier.updatedAt)}
                  </Row>
                </dl>
              </Section>

              {supplier.remark && (
                <Section title="备注说明">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {supplier.remark}
                  </p>
                </Section>
              )}
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
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
      <dd className="flex items-center justify-end text-right">{children}</dd>
    </>
  );
}
