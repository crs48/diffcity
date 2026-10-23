use crate::contracts::Note;
use serde_json::{Value, json};

pub const INSTRUCTIONS: &str = " After your answer, append a short plain-text conversation title in this exact final-line format: <!-- diffcity-thread-title: Title here -->. Use 3–6 words, at most 72 characters, with no Markdown or line breaks. Describe the specific topic, not a generic label like Code explanation. Base it only on the supplied opening exchange; if firstResponse is null, use the answer you just wrote. This metadata is separate from the answer.";

/// Follow-ups can name older conversations, but always use their opening exchange.
pub fn context(notes: &[Note], current: &Note) -> Option<Value> {
    let mut thread: Vec<_> = notes
        .iter()
        .filter(|n| {
            n.snapshot_id == current.snapshot_id
                && n.anchor == current.anchor
                && !n.github_draft
                && n.published_url.is_none()
        })
        .collect();
    if thread
        .iter()
        .any(|n| n.role == "assistant" && n.thread_title.is_some())
    {
        return None;
    }
    thread.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
    let first = thread
        .iter()
        .find(|n| {
            n.role == "user"
                && (n.id == current.id
                    || thread.iter().any(|reply| {
                        reply.role == "assistant"
                            && reply.parent_id.as_deref() == Some(n.id.as_str())
                    }))
        })
        .copied()
        .unwrap_or(current);
    let reply = thread
        .iter()
        .find(|n| n.role == "assistant" && n.parent_id.as_deref() == Some(first.id.as_str()));
    Some(json!({
        "firstMessage": first.body.chars().take(3000).collect::<String>(),
        "firstResponse": reply.map(|n| n.body.chars().take(5000).collect::<String>()),
        "selectedText": first.anchor.as_ref().and_then(|a| a.text_selection.as_ref()).map(|s| s.text.chars().take(500).collect::<String>()),
    }))
}

/// Metadata never becomes part of a saved answer or a prepared GitHub comment.
pub fn split(answer: String) -> (String, Option<String>) {
    let Some((body, suffix)) = answer.rsplit_once("\n<!-- diffcity-thread-title:") else {
        return (answer, None);
    };
    let Some(title) = suffix.trim().strip_suffix("-->").map(str::trim) else {
        return (answer, None);
    };
    let valid = !title.is_empty()
        && title.chars().count() <= 72
        && title.split_whitespace().count() <= 8
        && !title.chars().any(|c| c.is_control() || "<>`*#".contains(c));
    (body.trim_end().to_owned(), valid.then(|| title.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, role: &str, body: &str) -> Note {
        serde_json::from_value(json!({
            "id":id,"snapshotId":"s","anchor":null,"body":body,"role":role,
            "parentId":null,"githubDraft":false,"publishedUrl":null,"createdAt":id,
        }))
        .unwrap()
    }

    #[test]
    fn uses_opening_exchange_and_keeps_titles_stable_and_thread_scoped() {
        let first = note("1", "user", "Explain DNSSEC storage");
        let mut reply = note("2", "assistant", "Stores the zone and check timestamp");
        reply.parent_id = Some(first.id.clone());
        let followup = note("3", "user", "Draw a diagram");
        let mut notes = vec![followup.clone(), reply.clone(), first.clone()];
        let input = context(&notes, &followup).unwrap();
        assert_eq!(input["firstMessage"], first.body);
        assert_eq!(input["firstResponse"], reply.body);
        notes[1].thread_title = Some("DNSSEC check metadata".into());
        assert!(context(&notes, &followup).is_none());
        notes[1].snapshot_id = "other-revision".into();
        assert!(context(&notes, &followup).is_some());
        notes[1].snapshot_id = "s".into();
        notes[1].github_draft = true;
        assert!(context(&notes, &followup).is_some());
        assert_eq!(
            context(std::slice::from_ref(&first), &first).unwrap()["firstResponse"],
            Value::Null
        );
    }

    #[test]
    fn titles_do_not_use_unsent_or_removed_questions_as_the_opening_exchange() {
        let unsent = note("1", "user", "An unfinished private thought");
        let current = note("2", "user", "Explain the migration rollout");
        let future = note("3", "user", "A follow-up still in the queue");
        let notes = vec![unsent, current.clone(), future];
        let title = context(&notes, &current).unwrap();
        assert_eq!(title["firstMessage"], current.body);
        assert_eq!(title["firstResponse"], Value::Null);
    }

    #[test]
    fn separates_metadata_without_damaging_markdown_or_ordinary_code() {
        let body = "Explanation.\n\n```mermaid\nflowchart TD\n A --> B\n```";
        assert_eq!(
            split(format!(
                "{body}\n<!-- diffcity-thread-title: DNSSEC check metadata -->"
            )),
            (body.into(), Some("DNSSEC check metadata".into()))
        );
        assert_eq!(split(body.into()), (body.into(), None));
        for title in ["", "<script>unsafe</script>", "two\nlines", &"x".repeat(73)] {
            assert_eq!(
                split(format!("{body}\n<!-- diffcity-thread-title: {title} -->")),
                (body.into(), None)
            );
        }
        let code = "```html\n<!-- diffcity-thread-title: literal example -->\n```";
        assert_eq!(split(code.into()), (code.into(), None));
    }
}
