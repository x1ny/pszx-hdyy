import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect } from "react";
import { Button } from "./ui/button.tsx";
import { cn } from "../lib/utils.ts";

export type RichTextEditorProps = {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * 邀请函正文/附则的富文本编辑器。工具栏只开公文常用的加粗/下划线/列表/引用，
 * **故意不接 @tiptap/extension-image**——插图不在这次迁移范围内，见
 * docs 讨论：不装图片扩展，工具栏和 schema 里天然就没有插图这个选项，
 * 不用另外写「排除」逻辑。
 */
export function RichTextEditor({
  value = "",
  onChange,
  placeholder = "请输入内容",
  disabled,
  className,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        heading: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editable: !disabled,
    editorProps: {
      attributes: { class: "invitation-rich-text-content" },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      if (html === value) return;
      onChange?.(html);
    },
  });

  // 外部（比如切换编辑对象、表单 reset）改了 value，且跟编辑器当前内容不一致时，
  // 才回填——避免每次 onUpdate 触发的 value 变化又反过来重置光标位置。
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
    // biome-ignore lint/correctness/useExhaustiveDependencies: 只在 value 变化时同步，editor 本身变化不需要重跑
  }, [value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  return (
    <div
      className={cn(
        "rounded-md border",
        disabled && "opacity-60",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <ToolbarButton
          icon={BoldIcon}
          label="加粗"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon={ItalicIcon}
          label="斜体"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon={UnderlineIcon}
          label="下划线"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <Separator />
        <ToolbarButton
          icon={ListIcon}
          label="无序列表"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon={ListOrderedIcon}
          label="有序列表"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon={QuoteIcon}
          label="引用"
          active={editor.isActive("blockquote")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <Separator />
        <ToolbarButton
          icon={Undo2Icon}
          label="撤销"
          disabled={disabled || !editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon={Redo2Icon}
          label="重做"
          disabled={disabled || !editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>
      <EditorContent editor={editor} className="invitation-rich-text-editor" />
    </div>
  );
}

function Separator() {
  return <div className="mx-1 h-5 w-px bg-border" aria-hidden />;
}

function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: typeof BoldIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7", active && "bg-accent text-accent-foreground")}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}
