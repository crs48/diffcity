import { useId, useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Text,
} from "react-aria-components";
import { ChevronDown, Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  api,
  type AgentAccess,
  type AgentPrompt,
  type AgentAnswer,
} from "../lib/api";

const modes = [
  {
    id: "limited",
    title: "Limited access",
    description: "Read local code. No edits or integrations.",
    Icon: Shield,
  },
  {
    id: "ask",
    title: "Ask before actions",
    description: "Confirm commands, edits, and integration calls.",
    Icon: ShieldCheck,
  },
  {
    id: "full",
    title: "Full access",
    description: "Use tools and make changes without routine confirmations.",
    Icon: ShieldAlert,
  },
] as const;

export function useAgentAccess() {
  const [access, setAccess] = useState<AgentAccess>(() => {
    try {
      const stored = localStorage.getItem("diffcity.agent-access");
      return modes.find((mode) => mode.id === stored)?.id ?? "ask";
    } catch {
      return "ask";
    }
  });
  const change = (value: AgentAccess) => {
    setAccess(value);
    try {
      localStorage.setItem("diffcity.agent-access", value);
    } catch {
      /* This session still has the selected mode. */
    }
  };
  return { access, change };
}

export function AgentAccessSelector({
  value,
  onChange,
}: {
  value: AgentAccess;
  onChange: (value: AgentAccess) => void;
}) {
  const { t } = useTranslation();
  const selected = modes.find((mode) => mode.id === value)!;
  return (
    <MenuTrigger>
      <Button
        className={`text-button agent-access-trigger access-${value}`}
        aria-label={`${t("Agent access")}: ${t(selected.title)}`}
      >
        <selected.Icon size={15} aria-hidden />
        {t(selected.title)}
        <ChevronDown size={12} aria-hidden />
      </Button>
      <Popover className="agent-access-popover" placement="top start">
        <Menu
          aria-label={t("Agent access")}
          selectionMode="single"
          selectedKeys={[value]}
          onAction={(key) => onChange(key as AgentAccess)}
        >
          {modes.map(({ id, title, description, Icon }) => (
            <MenuItem
              key={id}
              id={id}
              textValue={t(title)}
              className="agent-access-option"
            >
              <Icon size={17} aria-hidden />
              <div>
                <Text slot="label">{t(title)}</Text>
                <Text slot="description">{t(description)}</Text>
              </div>
            </MenuItem>
          ))}
        </Menu>
        <p>
          {t(
            "Uses your provider’s configured integrations. Provider policies still apply.",
          )}
        </p>
        <p>
          {t(
            "Applies to new messages. Queued messages keep their access. Guides remain read-only.",
          )}
        </p>
      </Popover>
    </MenuTrigger>
  );
}

export function AgentApproval({
  prompt,
  runId,
  onRespond,
}: {
  prompt: AgentPrompt;
  runId: string;
  onRespond: (
    runId: string,
    requestId: string,
    answer: AgentAnswer,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const groupId = useId();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const respond = async (allow: boolean) => {
    setBusy(true);
    setError("");
    try {
      await onRespond(runId, prompt.id, { allow, answers });
    } catch (error) {
      setError(String(error));
      setBusy(false);
    }
  };
  const ready = prompt.questions.every(
    (q) => !q.required || answers[q.id]?.some((v) => v.trim()),
  );
  return (
    <section className="agent-approval" aria-label={t("Agent request")}>
      <strong>
        <ShieldCheck size={16} aria-hidden />
        {prompt.title}
      </strong>
      {prompt.description && <p>{prompt.description}</p>}
      {prompt.details && (
        <details open>
          <summary>{t("Action details")}</summary>
          <pre>{prompt.details}</pre>
        </details>
      )}
      {prompt.url && (
        <Button
          className="text-button"
          onPress={() =>
            void api.external(prompt.url!).catch((e) => setError(String(e)))
          }
        >
          {t("Open integration page")}
        </Button>
      )}
      {prompt.questions.map((q) => (
        <fieldset key={q.id} disabled={busy}>
          <legend>{q.label}</legend>
          {q.options.map((option) => (
            <label className="agent-answer-option" key={option.value}>
              <input
                type={q.multiple ? "checkbox" : "radio"}
                name={`${groupId}-${q.id}`}
                checked={answers[q.id]?.includes(option.value) ?? false}
                onChange={(event) =>
                  setAnswers((prev) => ({
                    ...prev,
                    [q.id]: q.multiple
                      ? event.target.checked
                        ? [...(prev[q.id] ?? []), option.value]
                        : (prev[q.id] ?? []).filter((v) => v !== option.value)
                      : [option.value],
                  }))
                }
              />
              <span>
                {option.label}
                {option.description && <small>{option.description}</small>}
              </span>
            </label>
          ))}
          {q.kind !== "choice" && (
            <input
              aria-label={q.label}
              type={
                q.kind === "password"
                  ? "password"
                  : ["number", "integer"].includes(q.kind)
                    ? "number"
                    : "text"
              }
              step={q.kind === "integer" ? 1 : "any"}
              value={
                q.options.some((o) => o.value === answers[q.id]?.[0])
                  ? ""
                  : (answers[q.id]?.[0] ?? "")
              }
              placeholder={
                q.options.length ? t("Or enter an answer…") : undefined
              }
              onChange={(event) =>
                setAnswers((prev) => ({
                  ...prev,
                  [q.id]: [event.target.value],
                }))
              }
            />
          )}
        </fieldset>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="agent-approval-actions">
        <Button
          className="secondary"
          isDisabled={busy}
          onPress={() => void respond(false)}
        >
          {t("Decline")}
        </Button>
        <Button
          className="primary"
          isDisabled={busy || !ready}
          onPress={() => void respond(true)}
        >
          {t(
            busy
              ? "Sending…"
              : prompt.questions.length
                ? "Send answer"
                : "Allow once",
          )}
        </Button>
      </div>
    </section>
  );
}
