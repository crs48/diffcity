import { Pin, PinOff } from "lucide-react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";

export function PinToggle({
  id,
  label,
  pinned,
  disabled,
  onPress,
}: {
  id?: string;
  label: string;
  pinned: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const Icon = pinned ? PinOff : Pin;
  return (
    <TooltipTrigger delay={300}>
      <Button
        id={id}
        className="pin-toggle"
        aria-label={label}
        aria-pressed={pinned}
        isDisabled={disabled}
        onPress={onPress}
      >
        <Icon size={15} aria-hidden="true" />
      </Button>
      <Tooltip placement="top" className="rail-tooltip">
        {label}
      </Tooltip>
    </TooltipTrigger>
  );
}
