import { Construction } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty.tsx";

/** 占位页，只为验证布局与导航；业务页面写好后逐个替换掉。 */
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Construction />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>此页面尚未实现。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
