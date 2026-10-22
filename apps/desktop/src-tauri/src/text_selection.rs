//! Exact selected text is validated against immutable captured code before reaching Codex.
use crate::{contracts::*, domain, service::Service};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn slice_utf16(text: &str, start: u32, end: u32) -> Result<String> {
    let units: Vec<_> = text.encode_utf16().collect();
    let range = units
        .get(start as usize..end as usize)
        .context("Selected columns are outside the source line")?;
    String::from_utf16(range).context("A text selection cannot split a Unicode character")
}
impl Service {
    pub(crate) fn text_selection_code(&self, review: &Snapshot, anchor: &Anchor) -> Result<Value> {
        let selected = anchor
            .text_selection
            .as_ref()
            .context("Missing selected text")?;
        ensure!(
            !selected.text.trim().is_empty() && selected.text.encode_utf16().count() <= 16_000,
            "Select between 1 and 16,000 characters of code"
        );
        ensure!(
            anchor.start_line > 0
                && anchor.line >= anchor.start_line
                && anchor.line - anchor.start_line < 200,
            "Select at most 200 consecutive source lines"
        );
        let source = self.snapshot(&selected.snapshot_id)?;
        ensure!(
            source
                .pull
                .repository
                .eq_ignore_ascii_case(&review.pull.repository)
                && source.pull.number == review.pull.number
                && source.pull.head == review.pull.head,
            "Selected text belongs to a different PR revision"
        );
        let file = source
            .files
            .iter()
            .find(|f| f.path == anchor.path && f.hunks.iter().any(|h| h.id == anchor.hunk_id))
            .context("Selected file is not in this captured revision")?;
        let mut lines: BTreeMap<u32, String> = file
            .hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter_map(|l| {
                let number = if anchor.side == Side::LEFT {
                    l.old
                } else {
                    l.new
                };
                number.map(|n| (n, l.text.clone()))
            })
            .collect();
        // Expanded context has already been verified by hunk_context and cached.
        let key = format!("{}/{}", source.id, domain::hash(&file.path));
        if let Some(cached) = self.store.get::<Value>("context-source", &key)? {
            let field = if anchor.side == Side::LEFT {
                "old"
            } else {
                "new"
            };
            if let Some(text) = cached[field].as_str() {
                for (index, text) in text.lines().enumerate() {
                    lines.entry(index as u32 + 1).or_insert_with(|| text.into());
                }
            }
        }
        let selected_lines = (anchor.start_line..=anchor.line).map(|n| {
            let text = lines.get(&n).context("Selected text spans source that has not been captured; expand its context first")?;
            let start = if n == anchor.start_line { selected.start_column } else { 0 };
            let end = if n == anchor.line { selected.end_column } else { text.encode_utf16().count() as u32 };
            slice_utf16(text, start, end)
        }).collect::<Result<Vec<_>>>()?;
        let text = selected_lines.join("\n");
        ensure!(
            text == selected.text,
            "Selected text does not match the captured source"
        );
        let mut remaining = 30_000;
        let mut truncated = false;
        let nearby: Vec<_> = lines
            .range(anchor.start_line.saturating_sub(5)..=anchor.line.saturating_add(5))
            .map(|(line, text)| {
                let excerpt: String = text.chars().take(remaining.min(2_000)).collect();
                let omitted = excerpt.len() < text.len();
                remaining -= excerpt.chars().count();
                truncated |= omitted;
                json!({"line":line,"text":excerpt,"truncated":omitted})
            })
            .collect();
        Ok(
            json!({"path":anchor.path,"side":anchor.side,"sourceSnapshotId":source.id,
            "sourceCommit":if anchor.side == Side::RIGHT { Some(source.pull.head.clone()) } else { self.store.get::<String>("context-base", &source.id)? },
            "selectedText":text,"startLine":anchor.start_line,"endLine":anchor.line,
            "startColumnUtf16":selected.start_column,"endColumnUtf16Exclusive":selected.end_column,
            "nearbyLines":nearby,"contextTruncated":truncated,"scope":"AI-only text selection; do not reinterpret it as a full-line comment"}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Service, Snapshot, Anchor) {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path()).unwrap();
        let (snapshot, _) = crate::fixtures::sample().unwrap();
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let hunk = &snapshot.files[2].hunks[0];
        let anchor = Anchor {
            hunk_id: hunk.id.clone(),
            path: hunk.path.clone(),
            side: Side::RIGHT,
            start_line: 1,
            line: 1,
            text_selection: Some(TextSelection {
                snapshot_id: snapshot.id.clone(),
                start_column: 13,
                end_column: 29,
                text: "invitationExpiry".into(),
            }),
        };
        (dir, service, snapshot, anchor)
    }
    fn note(snapshot: &Snapshot, anchor: Anchor) -> Note {
        Note {
            model: None,
            id: String::new(),
            snapshot_id: snapshot.id.clone(),
            anchor: Some(anchor),
            body: "Help me understand this code.".into(),
            role: "user".into(),
            parent_id: None,
            github_draft: false,
            published_url: None,
            created_at: String::new(),
        }
    }
    #[test]
    fn precise_text_and_nearby_lines_are_distinct_and_unicode_offsets_are_checked() {
        let (_dir, service, snapshot, mut anchor) = setup();
        let code = service.text_selection_code(&snapshot, &anchor).unwrap();
        assert_eq!(code["selectedText"], "invitationExpiry");
        assert!(
            code["nearbyLines"][0]["text"]
                .as_str()
                .unwrap()
                .starts_with("export const")
        );
        anchor.text_selection.as_mut().unwrap().text = "otherVariable".into();
        assert!(service.text_selection_code(&snapshot, &anchor).is_err());
        assert_eq!(slice_utf16("a😀é", 1, 3).unwrap(), "😀");
        assert!(slice_utf16("a😀é", 1, 2).is_err());
        assert!(slice_utf16("abc", 3, 2).is_err());
    }
    #[test]
    fn bounds_surrounding_context_without_truncating_the_selection() {
        let (_dir, service, mut snapshot, mut anchor) = setup();
        let text = format!("{}needle", "x".repeat(100_000));
        snapshot.files[2].hunks[0].lines[0].text = text;
        service
            .store
            .put("snapshot", &snapshot.id, &snapshot)
            .unwrap();
        let selection = anchor.text_selection.as_mut().unwrap();
        selection.start_column = 100_000;
        selection.end_column = 100_006;
        selection.text = "needle".into();
        let code = service.text_selection_code(&snapshot, &anchor).unwrap();
        assert_eq!(code["selectedText"], "needle");
        assert_eq!(code["contextTruncated"], true);
        assert!(code.to_string().len() < 4_000);
    }
    #[test]
    fn validates_multiline_expanded_context_and_rejects_missing_or_cross_revision_source() {
        let (_dir, service, snapshot, mut anchor) = setup();
        anchor.start_line = 3;
        anchor.line = 4;
        let selected = anchor.text_selection.as_mut().unwrap();
        selected.start_column = 6;
        selected.end_column = 6;
        selected.text = "helper = () => {\n  body".into();
        assert!(service.text_selection_code(&snapshot, &anchor).is_err());
        service.store.put("context-source", &format!("{}/{}", snapshot.id, domain::hash(&anchor.path)), &json!({"new":"export const invitationExpiry = (now: Date) =>\n  new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);\nconst helper = () => {\n  body();\n}"})).unwrap();
        assert_eq!(
            service.text_selection_code(&snapshot, &anchor).unwrap()["selectedText"],
            "helper = () => {\n  body"
        );
        let mut unrelated = snapshot.clone();
        unrelated.id = "other".into();
        unrelated.pull.head = "different-head".into();
        service
            .store
            .put("snapshot", &unrelated.id, &unrelated)
            .unwrap();
        anchor.text_selection.as_mut().unwrap().snapshot_id = unrelated.id;
        assert!(service.text_selection_code(&snapshot, &anchor).is_err());
    }
    #[test]
    fn private_threads_persist_and_cannot_be_saved_converted_or_published_as_github_drafts() {
        let (dir, service, snapshot, anchor) = setup();
        let saved = service.save_note(note(&snapshot, anchor)).unwrap();
        let offline = Service::new(dir.path()).unwrap();
        assert_eq!(
            offline.store.notes(&snapshot.id).unwrap()[0].anchor,
            saved.anchor
        );
        let mut draft = saved.clone();
        draft.github_draft = true;
        assert!(service.save_note(draft.clone()).is_err());
        let request = PublishRequest {
            snapshot_id: snapshot.id.clone(),
            event: "COMMENT".into(),
            body: String::new(),
            note_ids: vec![draft.id.clone()],
        };
        assert!(
            crate::github::payload(&snapshot, &request, &[draft], "viewer")
                .unwrap_err()
                .to_string()
                .contains("AI-only")
        );
        let mut stripped = saved.clone();
        stripped.anchor.as_mut().unwrap().text_selection = None;
        assert!(service.save_note(stripped.clone()).is_err());
        stripped.id = String::new();
        stripped.parent_id = Some(saved.id);
        assert!(service.save_note(stripped).is_err());
    }
    #[tokio::test]
    async fn comparison_text_uses_reviewed_source_while_sharing_the_full_pr_conversation() {
        let (_dir, service, snapshot, _) = setup();
        let baseline = service
            .review_baseline(&snapshot.id, false)
            .await
            .unwrap()
            .checkpoint
            .unwrap();
        let delta = service
            .compare_review(&snapshot.id, baseline)
            .await
            .unwrap();
        let file = delta
            .snapshot
            .files
            .iter()
            .find(|f| f.path == "src/invitations.ts")
            .unwrap();
        let line = file.hunks[0]
            .lines
            .iter()
            .find(|l| l.kind == LineKind::Deletion)
            .unwrap();
        let anchor = Anchor {
            hunk_id: file.hunks[0].id.clone(),
            path: file.path.clone(),
            side: Side::LEFT,
            start_line: 2,
            line: 2,
            text_selection: Some(TextSelection {
                snapshot_id: delta.snapshot.id,
                start_column: 0,
                end_column: line.text.encode_utf16().count() as u32,
                text: line.text.clone(),
            }),
        };
        let saved = service.save_note(note(&snapshot, anchor)).unwrap();
        assert_eq!(saved.snapshot_id, snapshot.id);
        let code = service
            .text_selection_code(&snapshot, saved.anchor.as_ref().unwrap())
            .unwrap();
        assert!(code["selectedText"].as_str().unwrap().contains("1 * 24"));
    }
}
