import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "#/shared/components/ui/tooltip.tsx";
import { SegmentConfigIcons } from "./segment-config-icons";

describe("SegmentConfigIcons", () => {
  it("uses one-character text marks for every resource type", () => {
    const { container } = render(
      <SegmentConfigIcons
        segment={{ memberEnabled: false, seatingEnabled: false }}
        demands={[
          { id: 1, resourceType: "transport", status: "recorded" },
          { id: 2, resourceType: "dining", status: "recorded" },
          { id: 3, resourceType: "accommodation", status: "recorded" },
          { id: 4, resourceType: "material", status: "recorded" },
        ]}
      />,
    );

    expect(container.firstElementChild).toHaveClass("gap-1");
    expect(screen.getByLabelText("用车：仅记录")).toHaveTextContent("车");
    expect(screen.getByLabelText("用车：仅记录")).toHaveClass(
      "size-4",
      "rounded-[4px]",
      "font-normal",
      "text-[10px]",
      "text-white",
    );
    expect(screen.getByLabelText("用车：仅记录")).toHaveStyle({
      background: "rgb(26, 158, 80)",
    });
    expect(screen.getByLabelText("用餐：仅记录")).toHaveTextContent("餐");
    expect(screen.getByLabelText("住宿：仅记录")).toHaveTextContent("住");
    expect(screen.getByLabelText("物料：仅记录")).toHaveTextContent("物");
  });

  it("uses gray text marks when an item needs attention", () => {
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

    expect(screen.getByLabelText("人员：已配置 2 人")).toHaveTextContent("人");
    expect(screen.getByLabelText("人员：已配置 2 人")).toHaveClass(
      "text-white",
    );
    expect(screen.getByLabelText("人员：已配置 2 人")).toHaveStyle({
      background: "rgb(26, 158, 80)",
    });
    expect(screen.getByLabelText("排位：待确认")).toHaveTextContent("位");
    expect(screen.getByLabelText("排位：待确认")).toHaveClass("text-white");
    expect(screen.getByLabelText("排位：待确认")).toHaveStyle({
      background: "rgb(179, 185, 194)",
    });
    expect(screen.getByLabelText("用车：配置中")).toHaveTextContent("车");
    expect(screen.getByLabelText("用车：配置中")).toHaveClass("text-white");
    expect(screen.getByLabelText("用车：配置中")).toHaveStyle({
      background: "rgb(179, 185, 194)",
    });
    expect(screen.getByLabelText("物料：已配置")).toHaveTextContent("物");
    expect(screen.getByLabelText("物料：已配置")).toHaveClass("text-white");
    expect(screen.getByLabelText("物料：已配置")).toHaveStyle({
      background: "rgb(26, 158, 80)",
    });
    expect(
      container.querySelectorAll('[data-slot="tooltip-trigger"]'),
    ).toHaveLength(2);
  });

  it("keeps problem details in tooltips with gray text marks", () => {
    const { container } = render(
      <TooltipProvider>
        <SegmentConfigIcons
          segment={{ memberEnabled: true, seatingEnabled: true }}
          demands={[{ id: 1, resourceType: "dining", status: "recorded" }]}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("人员：未配置")).toHaveTextContent("人");
    expect(screen.getByLabelText("人员：未配置")).toHaveStyle({
      background: "rgb(179, 185, 194)",
    });
    expect(screen.getByLabelText("排位：未配置")).toHaveTextContent("位");
    expect(screen.getByLabelText("排位：未配置")).toHaveStyle({
      background: "rgb(179, 185, 194)",
    });
    expect(screen.getByLabelText("用餐：仅记录")).toHaveTextContent("餐");
    expect(screen.getByLabelText("用餐：仅记录")).toHaveStyle({
      background: "rgb(26, 158, 80)",
    });
    expect(
      container.querySelectorAll('[data-slot="tooltip-trigger"]'),
    ).toHaveLength(2);
  });
});
