import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "#/shared/components/ui/tooltip.tsx";
import { SegmentConfigIcons } from "./segment-config-icons";

describe("SegmentConfigIcons", () => {
  it("only creates tooltips for configuration items that still have a problem", () => {
    const { container } = render(
      <TooltipProvider>
        <SegmentConfigIcons
          segment={{ memberEnabled: true, seatingEnabled: true }}
          memberCount={2}
          seatingStatus="pending"
          demands={[
            { id: 1, resourceType: "transport", status: "configuring" },
            { id: 2, resourceType: "material", status: "configured" },
          ]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("人员：已配置 2 人")).toHaveClass(
      "text-success-foreground",
    );
    expect(screen.getByLabelText("排位：待确认")).toHaveClass(
      "text-destructive",
    );
    expect(screen.getByLabelText("用车：配置中")).toHaveClass(
      "text-destructive",
    );
    expect(screen.getByLabelText("物料：已配置")).toHaveClass(
      "text-success-foreground",
    );
    expect(
      container.querySelectorAll('[data-slot="tooltip-trigger"]'),
    ).toHaveLength(2);
  });

  it("treats missing people and seating as problems, but record-only demand as fine", () => {
    const { container } = render(
      <TooltipProvider>
        <SegmentConfigIcons
          segment={{ memberEnabled: true, seatingEnabled: true }}
          demands={[{ id: 1, resourceType: "dining", status: "recorded" }]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("人员：未配置")).toHaveClass(
      "text-destructive",
    );
    expect(screen.getByLabelText("排位：未配置")).toHaveClass(
      "text-destructive",
    );
    expect(screen.getByLabelText("用餐：仅记录")).toHaveClass(
      "text-success-foreground",
    );
    expect(
      container.querySelectorAll('[data-slot="tooltip-trigger"]'),
    ).toHaveLength(2);
  });
});
