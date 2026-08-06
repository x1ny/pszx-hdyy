import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("flex", false && "hidden", undefined)).toBe("flex");
  });
});

describe("rendering", () => {
  it("renders a component into the DOM", () => {
    render(<button type="button">Click me</button>);
    expect(
      screen.getByRole("button", { name: "Click me" }),
    ).toBeInTheDocument();
  });
});
