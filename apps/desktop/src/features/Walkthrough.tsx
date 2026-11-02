import { memo } from "react";
import { BookOpen, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GuideSection } from "../lib/api";
import { CommentMarkdown } from "../ui/CommentMarkdown";
import { normalizeGuideMarkdown } from "../lib/guideMarkdown";

/** Full explanations share the document scroll, with separate reading and review cues. */
export const Walkthrough = memo(function Walkthrough({
  id,
  section,
}: {
  id: string;
  section: GuideSection;
}) {
  const { t } = useTranslation();
  return (
    <section
      id={id}
      className="chapter-context"
      aria-label={t("Full section context")}
    >
      <header className="walkthrough-heading">
        <BookOpen size={15} aria-hidden />
        <h3>{t("Walkthrough")}</h3>
      </header>
      <div className="walkthrough-explanation">
        <CommentMarkdown
          body={normalizeGuideMarkdown(section.explanation || section.summary)}
        />
      </div>
      <div className="walkthrough-review">
        <div className="walkthrough-impact">
          <h4>{t("Why it matters")}</h4>
          <CommentMarkdown body={section.reason} />
        </div>
        {section.questions.length > 0 && (
          <div className="walkthrough-checks">
            <div className="walkthrough-heading">
              <ListChecks size={15} aria-hidden />
              <h4>{t("What to verify")}</h4>
            </div>
            <ol role="list">
              {section.questions.map((question, index) => (
                <li key={`${index}/${question}`}>
                  <span className="walkthrough-check-number" aria-hidden>
                    {index + 1}
                  </span>
                  <CommentMarkdown body={question} />
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
});
