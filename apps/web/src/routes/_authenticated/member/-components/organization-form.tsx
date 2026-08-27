import { useForm } from "@tanstack/react-form";
import { LoaderCircleIcon } from "lucide-react";
import { z } from "zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "#/shared/components/ui/alert.tsx";
import { Button } from "#/shared/components/ui/button.tsx";
import { DialogBody, DialogFooter } from "#/shared/components/ui/dialog.tsx";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "#/shared/components/ui/field.tsx";
import { Input } from "#/shared/components/ui/input.tsx";
import { Textarea } from "#/shared/components/ui/textarea.tsx";
import type {
  OrganizationDetail,
  OrganizationFormValues,
  OrganizationOption,
} from "../-queries";
import { OrganizationMemberSelector } from "./organization-member-selector";

const OrganizationFormSchema = z.object({
  name: z.string().trim().min(1, "团体名称不能为空").max(255, "团体名称过长"),
  remark: z.string().trim().max(2000, "备注过长"),
  memberIds: z.array(z.number().int().positive()),
});

type OrganizationFormState = z.infer<typeof OrganizationFormSchema>;

type OrganizationFormProps = {
  organization?: OrganizationDetail;
  organizationOptions: OrganizationOption[];
  organizationOptionsError?: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: OrganizationFormValues) => void;
};

export function OrganizationForm({
  organization,
  organizationOptions,
  organizationOptionsError,
  submitting,
  onCancel,
  onSubmit,
}: OrganizationFormProps) {
  const defaultValues: OrganizationFormState = {
    name: organization?.name ?? "",
    remark: organization?.remark ?? "",
    // 详情接口返回这个团体的完整成员集合；此后搜索和翻页只改变当前可见行，
    // 不会重新初始化或覆盖屏幕外的选择。
    memberIds: organization?.memberIds ?? [],
  };

  const form = useForm({
    defaultValues,
    validators: {
      onChange: OrganizationFormSchema,
      onSubmit: OrganizationFormSchema,
    },
    onSubmit: ({ value }) =>
      onSubmit({
        name: value.name.trim(),
        remark: value.remark.trim() || null,
        memberIds: value.memberIds,
      }),
  });

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <DialogBody className="flex flex-col gap-6">
        {organizationOptionsError && (
          <Alert variant="destructive">
            <AlertTitle>团体名称载入失败</AlertTitle>
            <AlertDescription>
              {organizationOptionsError}
              。成员仍可选择，但其当前团体可能只显示编号。
            </AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          <form.Field name="name">
            {(field) => (
              <Field data-invalid={hasError(field)}>
                <FieldLabel htmlFor={field.name}>
                  团体名称
                  <span className="text-destructive" aria-hidden>
                    *
                  </span>
                </FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  placeholder="请输入团体名称"
                  value={field.state.value}
                  disabled={submitting}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field)}
                />
                <FieldDescription>
                  有效团体名称不可重复，前后空格会自动忽略。
                </FieldDescription>
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>

          <form.Field name="remark">
            {(field) => (
              <Field data-invalid={hasError(field)}>
                <FieldLabel htmlFor={field.name}>备注</FieldLabel>
                <Textarea
                  id={field.name}
                  name={field.name}
                  rows={3}
                  placeholder="请输入备注（选填）"
                  value={field.state.value}
                  disabled={submitting}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field)}
                />
                <FieldError errors={fieldErrors(field)} />
              </Field>
            )}
          </form.Field>
        </FieldGroup>

        <FieldSet>
          <FieldLegend>团体成员</FieldLegend>
          <FieldDescription>
            可跨页搜索和选择。成员一次最多属于一个团体；选择其他团体现有成员后，保存时会将其移动到本团体。
          </FieldDescription>
          <form.Field name="memberIds">
            {(field) => (
              <OrganizationMemberSelector
                currentOrganizationId={organization?.id}
                organizationOptions={organizationOptions}
                selectedMemberIds={field.state.value}
                disabled={submitting}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </FieldSet>
      </DialogBody>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting && (
            <LoaderCircleIcon
              data-icon="inline-start"
              className="animate-spin"
            />
          )}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}

function hasError(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched && field.state.meta.errors.length > 0;
}

function fieldErrors(field: {
  state: {
    meta: {
      isTouched: boolean;
      errors: Array<{ message?: string } | undefined>;
    };
  };
}) {
  return field.state.meta.isTouched ? field.state.meta.errors : [];
}
