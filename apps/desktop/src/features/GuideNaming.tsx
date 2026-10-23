import {
  ArrowDown,
  ArrowRight,
  Database,
  MessageCircle,
  Tag,
} from "lucide-react";
import { Button } from "react-aria-components";
import { useTranslation } from "react-i18next";
import type {
  Anchor,
  GuideSection,
  NamingDecision,
  NamingKind,
} from "../lib/api";
import { CommentMarkdown } from "../ui/CommentMarkdown";

const kinds: Record<NamingKind, string> = {
  database: "Database name",
  api: "API contract",
  domain: "Domain concept",
  configuration: "Configuration name",
};

function Name({ decision }: { decision: NamingDecision }) {
  const { t } = useTranslation();
  return (
    <span className="naming-name">
      {decision.previousName && (
        <>
          <code className="muted">{decision.previousName}</code>
          <ArrowRight size={14} aria-hidden />
          <span className="sr-only">{t("renamed to")}</span>
        </>
      )}
      <code>{decision.name}</code>
    </span>
  );
}

export function NamingOverview({
  sections,
  onNavigate,
}: {
  sections: GuideSection[];
  onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const decisions = sections.flatMap((s) =>
    (s.namingDecisions ?? []).map((decision) => ({ section: s, decision })),
  );
  if (!decisions.length) return null;
  return (
    <section className="naming-overview" aria-label={t("Naming decisions")}>
      <header className="walkthrough-heading">
        <Tag size={17} aria-hidden />
        <h3>{t("Names to confirm")}</h3>
        <span className="naming-count">{decisions.length}</span>
      </header>
      <p>
        {t(
          "Names become contracts. Review the vocabulary this PR introduces before it becomes expensive to change.",
        )}
      </p>
      <ul role="list">
        {decisions.map(({ section, decision }) => (
          <li key={`${decision.anchor.path}/${decision.name}`}>
            <Button
              className="naming-summary"
              onPress={() => onNavigate(section.id)}
              aria-label={t("Review naming decision: {{name}}", {
                name: decision.name,
              })}
            >
              {decision.kind === "database" ? (
                <Database size={16} aria-hidden />
              ) : (
                <Tag size={16} aria-hidden />
              )}
              <span>
                <Name decision={decision} />
                <small>
                  {t(kinds[decision.kind])} · {section.title}
                </small>
              </span>
              <ArrowDown size={15} aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NamingDecisions({
  section,
  onDiscuss,
}: {
  section: GuideSection;
  onDiscuss: (anchor: Anchor) => void;
}) {
  const { t } = useTranslation();
  if (!section.namingDecisions?.length) return null;
  return (
    <section
      className="naming-decisions"
      aria-label={t("Naming decisions for this section")}
    >
      <header className="walkthrough-heading">
        <Tag size={16} aria-hidden />
        <h3>{t("Names to confirm")}</h3>
      </header>
      {section.namingDecisions.map((decision) => (
        <article
          className="naming-decision"
          key={`${decision.anchor.path}/${decision.name}`}
        >
          <div className="naming-kind">{t(kinds[decision.kind])}</div>
          <h4>
            <Name decision={decision} />
          </h4>
          <CommentMarkdown body={decision.reason} diagrams={false} />
          <div className="naming-question">
            <strong>{t("Decision to make")}</strong>
            <CommentMarkdown body={decision.question} diagrams={false} />
          </div>
          <footer>
            <code title={decision.anchor.path}>
              {decision.anchor.path} ·{" "}
              {t(decision.anchor.side === "LEFT" ? "Old" : "New")}{" "}
              {decision.anchor.startLine}
              {decision.anchor.line !== decision.anchor.startLine
                ? `–${decision.anchor.line}`
                : ""}
            </code>
            <Button
              className="text-button"
              onPress={() => onDiscuss(decision.anchor)}
              aria-label={t("Discuss name: {{name}}", { name: decision.name })}
            >
              <MessageCircle size={15} aria-hidden />
              {t("Discuss name")}
            </Button>
          </footer>
        </article>
      ))}
    </section>
  );
}
