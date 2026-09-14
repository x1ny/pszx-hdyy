import type { InvitationDownloadFormat } from "#/features/invitation/queries";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/shared/components/ui/select";

const formats = [
  { value: "docx", label: "Word（.docx）" },
  { value: "pdf", label: "PDF（.pdf）" },
];

export function ExportFormatSelect({
  value,
  onValueChange,
  disabled,
}: {
  value: InvitationDownloadFormat;
  onValueChange: (value: InvitationDownloadFormat) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span>导出格式</span>
      <Select
        items={formats}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === "docx" || next === "pdf") onValueChange(next);
        }}
      >
        <SelectTrigger aria-label="导出格式" className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {formats.map((format) => (
            <SelectItem key={format.value} value={format.value}>
              {format.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
