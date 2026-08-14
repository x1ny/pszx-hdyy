import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Member } from "#/features/member/queries";
import { Button } from "#/shared/components/ui/button.tsx";
import { Field, FieldLabel } from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
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
import { buildInvitationDocument } from "../-shared/document.ts";
import { InvitationPreview } from "../-shared/invitation-preview.tsx";
import { ISSUER_LABELS, ISSUER_VALUES } from "../-shared/issuer-visual.ts";
import type { InvitationTemplate } from "../-shared/types.ts";
import { SelectTargetsDialog } from "./-components/select-targets-dialog";
import { maskMobile } from "./-utils";
import {
  createInvitationBatch,
  getInvitationTemplate,
  invitationTemplateListQueryOptions,
} from "./-queries";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "#/shared/components/ui/dialog.tsx";

const GenerateSearchSchema = z.object({
  templateId: z.number().optional().catch(undefined),
  projectId: z.number().optional().catch(undefined),
  activityId: z.number().optional().catch(undefined),
  returnTo: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/invitation/generate/")({
  validateSearch: GenerateSearchSchema,
  component: GeneratePage,
});

type ParamFields = {
  issuer: InvitationTemplate["issuer"] | "";
  templateId: number | undefined;
  contactPerson: string;
  contactPhone: string;
  signOff: string;
  issueDate: string;
};

const todayIsoDate = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function GeneratePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [currentTemplate, setCurrentTemplate] = useState<InvitationTemplate>();
  const [targets, setTargets] = useState<Member[]>([]);
  const [selectOpen, setSelectOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRecipientName, setPreviewRecipientName] = useState<string>();

  const templatesQuery = useQuery(
    invitationTemplateListQueryOptions({ status: "enabled", page: 1, pageSize: 100 }),
  );
  const templates = templatesQuery.data?.list ?? [];

  const form = useForm({
    defaultValues: {
      issuer: "",
      templateId: search.templateId,
      contactPerson: "",
      contactPhone: "",
      signOff: "",
      issueDate: todayIsoDate(),
    } as ParamFields,
    onSubmit: async ({ value }) => {
      if (!currentTemplate) {
        toast.warning("请先选择模板");
        return;
      }
      if (targets.length === 0) {
        toast.warning("请先选择邀请对象");
        return;
      }
      await submitMutation.mutateAsync({
        projectId: search.projectId,
        activityId: search.activityId,
        templateId: currentTemplate.id,
        contactPerson: value.contactPerson || undefined,
        contactPhone: value.contactPhone || undefined,
        signOff: value.signOff || undefined,
        issueDate: value.issueDate,
        targets: targets.map((item) => item.id),
      });
    },
  });

  const templateType = useStore(form.store, (s) => s.values.issuer);

  const applyTemplateParams = (detail: InvitationTemplate) => {
    setCurrentTemplate(detail);
    form.setFieldValue("issuer", detail.issuer);
    form.setFieldValue("templateId", detail.id);
    form.setFieldValue("contactPerson", detail.contactPerson);
    form.setFieldValue("contactPhone", detail.contactPhone);
    form.setFieldValue("signOff", detail.signOff);
  };

  // 初始 templateId 来自 URL（模板列表页的「生成」按钮带过来的）。
  useEffect(() => {
    if (!search.templateId) return;
    getInvitationTemplate(search.templateId).then((detail) => {
      if (!detail) {
        toast.error("模板不存在");
        return;
      }
      applyTemplateParams(detail);
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: 只在初始 templateId 变化时拉一次
  }, [search.templateId]);

  const templateNameOptions = useMemo(
    () =>
      templates
        .filter((item) => !templateType || item.issuer === templateType)
        .map((item) => ({ label: item.name, value: item.id })),
    [templates, templateType],
  );

  const submitMutation = useMutation({
    mutationFn: createInvitationBatch,
    onSuccess: () => {
      toast.success(`已生成 ${targets.length} 份邀请函`);
      if (search.returnTo) {
        navigate({ to: search.returnTo as never });
        return;
      }
      navigate({
        to: "/invitation/batch",
        search: search.activityId ? { activityId: search.activityId } : {},
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const handleTemplateChange = async (id: number) => {
    const detail = await getInvitationTemplate(id);
    if (!detail) {
      toast.error("模板不存在");
      return;
    }
    applyTemplateParams(detail);
  };

  const handlePreview = (member: Member) => {
    if (!currentTemplate) {
      toast.warning("请先选择模板");
      return;
    }
    setPreviewRecipientName(member.name);
    setPreviewOpen(true);
  };

  const previewValues = useStore(form.store, (s) => s.values);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-semibold text-xl tracking-tight">生成邀请函</h1>
          <p className="text-muted-foreground text-sm">
            选择模板与邀请对象，批量生成本次邀请函。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.history.back()}>
            取消
          </Button>
          <Button
            disabled={submitMutation.isPending}
            onClick={() => form.handleSubmit()}
          >
            {submitMutation.isPending && <Loader2Icon className="animate-spin" />}
            确认生成
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 font-medium text-sm">模板信息</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="issuer">
            {(field) => (
              <Field>
                <FieldLabel>发函主体</FieldLabel>
                <Select
                  items={ISSUER_LABELS}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as ParamFields["issuer"]);
                    form.setFieldValue("templateId", undefined);
                    setCurrentTemplate(undefined);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择发函主体" />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUER_VALUES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ISSUER_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="templateId">
            {(field) => (
              <Field>
                <FieldLabel>模板名称</FieldLabel>
                <Select
                  items={templateNameOptions}
                  value={field.state.value ?? null}
                  onValueChange={(value) => {
                    if (value == null) return;
                    field.handleChange(value as number);
                    handleTemplateChange(value as number);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择模板名称" />
                  </SelectTrigger>
                  <SelectContent>
                    {templateNameOptions.length === 0 ? (
                      <div className="px-2 py-4 text-center text-muted-foreground text-sm">
                        {templatesQuery.isPending
                          ? "加载中..."
                          : templates.length === 0
                            ? "暂无可用模板，请先到模板管理新建"
                            : "该发函主体下暂无可用模板"}
                      </div>
                    ) : (
                      templateNameOptions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-1 font-medium text-sm">本次参数信息</div>
        <p className="mb-3 text-muted-foreground text-xs">
          默认读取模板配置，支持临时修改，只影响本次邀请函，不会回写模板。
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <form.Field name="contactPerson">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>联系人</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="contactPhone">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>联系电话</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="signOff">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>落款</FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="issueDate">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>发函日期</FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium text-sm">邀请对象管理</div>
          <Button size="sm" onClick={() => setSelectOpen(true)}>
            选择对象
          </Button>
        </div>

        <Table>
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              <TableHead>姓名</TableHead>
              <TableHead>企业（社会）职务</TableHead>
              <TableHead>国别/地区</TableHead>
              <TableHead>手机号码</TableHead>
              <TableHead className="text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  还没有选择邀请对象
                </TableCell>
              </TableRow>
            ) : (
              targets.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.name}</TableCell>
                  <TableCell>{member.companyPosition || "-"}</TableCell>
                  <TableCell>{member.countryRegion || "-"}</TableCell>
                  <TableCell>{maskMobile(member.mobile)}</TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-primary hover:text-primary"
                        onClick={() => handlePreview(member)}
                      >
                        预览
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          setTargets((prev) => prev.filter((item) => item.id !== member.id))
                        }
                      >
                        移除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <SelectTargetsDialog
        open={selectOpen}
        selected={targets}
        onCancel={() => setSelectOpen(false)}
        onOk={(selected) => {
          setTargets(selected);
          setSelectOpen(false);
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>邀请函预览</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {currentTemplate ? (
              <InvitationPreview
                doc={buildInvitationDocument(
                  {
                    issuer: currentTemplate.issuer,
                    bodyContent: currentTemplate.bodyContent,
                    annexTitle: currentTemplate.annexTitle,
                    annexContent: currentTemplate.annexContent,
                    contactPerson: previewValues.contactPerson || currentTemplate.contactPerson,
                    contactPhone: previewValues.contactPhone || currentTemplate.contactPhone,
                    signOff: previewValues.signOff || currentTemplate.signOff,
                  },
                  {
                    recipientName: previewRecipientName,
                    issueDate: previewValues.issueDate,
                  },
                )}
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
