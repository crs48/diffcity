import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard";
import { IconAction } from "./IconAction";

export function CopyAction({
  label,
  getText,
  isDisabled = false,
}: {
  label: string;
  getText: () => string;
  isDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">(
    "idle",
  );
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const feedback =
    status === "copied"
      ? t("Copied")
      : status === "error"
        ? t("Could not copy. Try again.")
        : "";
  return (
    <>
      <IconAction
        label={feedback || label}
        isDisabled={isDisabled || status === "copying"}
        onPress={async () => {
          clearTimeout(reset.current);
          setStatus("copying");
          try {
            await copyText(getText());
            setStatus("copied");
            reset.current = setTimeout(() => setStatus("idle"), 2000);
          } catch {
            setStatus("error");
          }
        }}
      >
        {status === "copied" ? (
          <Check size={14} aria-hidden className="copy-success" />
        ) : status === "error" ? (
          <AlertCircle size={14} aria-hidden className="copy-error" />
        ) : (
          <Copy size={14} aria-hidden />
        )}
      </IconAction>
      <span className="sr-only" role="status">
        {feedback}
      </span>
    </>
  );
}
