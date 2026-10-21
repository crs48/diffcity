import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { Check, Monitor, Moon, Sun } from "lucide-react";

const themes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

export function ThemeSwitcher({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const Icon = themes.find((theme) => theme.id === value)?.icon || Monitor;
  return (
    <MenuTrigger>
      <Button
        aria-label={`Appearance: ${value}`}
        isDisabled={disabled}
        className="icon-button"
      >
        <Icon size={17} aria-hidden="true" />
      </Button>
      <Popover
        placement="bottom end"
        className="z-50 rounded-lg border border-line bg-surface p-1 text-ink shadow-xl"
      >
        <Menu
          aria-label="Appearance"
          selectionMode="single"
          selectedKeys={[value]}
          onAction={(key) => onChange(String(key))}
          className="min-w-40 outline-none"
        >
          {themes.map(({ id, label, icon: ThemeIcon }) => (
            <MenuItem
              id={id}
              key={id}
              textValue={label}
              className="flex cursor-default items-center gap-3 rounded px-3 py-2 text-sm outline-none data-focused:bg-subtle data-focus-visible:ring-2 data-focus-visible:ring-inset data-focus-visible:ring-ink"
            >
              <ThemeIcon size={16} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {id === value && <Check size={14} aria-hidden="true" />}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
