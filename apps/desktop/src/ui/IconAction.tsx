import type { ReactNode } from "react";
import {
  Button,
  Tooltip,
  TooltipTrigger,
  type ButtonProps,
} from "react-aria-components";

/** Compact actions retain the same label on hover, keyboard focus, and assistive tech. */
export function IconAction({
  label,
  children,
  className = "icon-button",
  ...props
}: Omit<ButtonProps, "children"> & { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={250}>
      <Button {...props} className={className} aria-label={label}>
        {children}
      </Button>
      <Tooltip placement="top" className="rail-tooltip">
        {label}
      </Tooltip>
    </TooltipTrigger>
  );
}
