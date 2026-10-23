//! Per-message access and one-shot, run-scoped replies to native agent requests.
use crate::contracts::*;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::oneshot;

impl AgentAccess {
    pub fn connected(self) -> bool {
        self != Self::Limited
    }
    pub fn instructions(self) -> &'static str {
        match self {
            Self::Limited => {
                "Access: Limited. Read local code only. Do not modify files, run project programs, or access external integrations."
            }
            Self::Ask => {
                "Access: Ask before actions. Use the available local tools and configured integrations to research and carry out the user's request. Permission requests are shown to the user in Diff City. Never work around a denial. Report actual actions and results; do not claim success without tool evidence."
            }
            Self::Full => {
                "Access: Full access. Use available local tools and configured integrations to carry out the user's request without routine confirmations. Stay within the user's request; tool access is not a request to change unrelated things. Respect provider and organization restrictions. Report actual actions and results; do not claim success without tool evidence."
            }
        }
    }
}

struct Pending {
    run_id: String,
    prompt: AgentPrompt,
    reply: oneshot::Sender<AgentAnswer>,
}
#[derive(Default)]
pub struct Approvals {
    entries: Mutex<HashMap<String, Pending>>,
}
pub struct Interaction<'a> {
    pub approvals: &'a Approvals,
    pub run_id: &'a str,
}
struct PendingGuard<'a> {
    owner: &'a Approvals,
    id: String,
}
impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.owner.entries.lock().unwrap().remove(&self.id);
    }
}
impl Approvals {
    pub fn respond(&self, run_id: &str, id: &str, answer: AgentAnswer) -> Result<()> {
        let mut entries = self.entries.lock().unwrap();
        let pending = entries
            .get(id)
            .context("This request is no longer waiting for a response")?;
        ensure!(
            pending.run_id == run_id,
            "This request belongs to a different conversation"
        );
        if answer.allow {
            for q in &pending.prompt.questions {
                let values = answer.answers.get(&q.id).cloned().unwrap_or_default();
                ensure!(
                    !q.required || values.iter().any(|v| !v.trim().is_empty()),
                    "Answer: {}",
                    q.label
                );
                ensure!(
                    q.multiple || values.len() <= 1,
                    "Choose one answer: {}",
                    q.label
                );
                if !q.options.is_empty() && q.kind == "choice" {
                    ensure!(
                        values
                            .iter()
                            .all(|v| q.options.iter().any(|o| o.value == *v)),
                        "Invalid choice for {}",
                        q.label
                    );
                }
                for value in values.iter().filter(|v| !v.trim().is_empty()) {
                    if q.kind == "integer" {
                        ensure!(
                            value.parse::<i64>().is_ok(),
                            "Enter a whole number: {}",
                            q.label
                        );
                    }
                    if q.kind == "number" {
                        ensure!(
                            value.parse::<f64>().is_ok_and(f64::is_finite),
                            "Enter a number: {}",
                            q.label
                        );
                    }
                }
            }
        }
        let pending = entries.remove(id).unwrap();
        pending
            .reply
            .send(answer)
            .map_err(|_| anyhow::anyhow!("This agent request has expired"))
    }
}
impl Interaction<'_> {
    pub async fn request(
        &self,
        mut prompt: AgentPrompt,
        emit: &impl Fn(&str, &str),
    ) -> Result<AgentAnswer> {
        prompt.id = uuid::Uuid::new_v4().to_string();
        let id = prompt.id.clone();
        let text = serde_json::to_string(&prompt)?;
        ensure!(
            text.len() < 500_000,
            "Agent approval is too large to display"
        );
        let (reply, response) = oneshot::channel();
        self.approvals.entries.lock().unwrap().insert(
            id.clone(),
            Pending {
                run_id: self.run_id.into(),
                prompt,
                reply,
            },
        );
        let _guard = PendingGuard {
            owner: self.approvals,
            id,
        };
        emit("approval", &text);
        let answer = response.await.context("Agent approval was cancelled")?;
        emit(
            "approval-resolved",
            if answer.allow {
                "Allowed · continuing…"
            } else {
                "Declined · continuing…"
            },
        );
        Ok(answer)
    }
}

pub fn prompt(title: &str, description: &str, details: &Value) -> AgentPrompt {
    AgentPrompt {
        id: String::new(),
        title: title.into(),
        description: description.into(),
        details: serde_json::to_string_pretty(details).unwrap_or_default(),
        questions: vec![],
        url: None,
    }
}

pub fn questions(value: &Value, claude: bool) -> Vec<AgentInputQuestion> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, q)| AgentInputQuestion {
            id: if claude {
                q["question"].as_str()
            } else {
                q["id"].as_str()
            }
            .map(str::to_owned)
            .unwrap_or_else(|| index.to_string()),
            label: q["question"].as_str().unwrap_or("Your answer").into(),
            kind: if q["isSecret"] == true {
                "password"
            } else {
                "text"
            }
            .into(),
            required: true,
            multiple: q["multiSelect"] == true,
            options: q["options"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|o| {
                    Some(AgentInputOption {
                        label: o["label"].as_str()?.into(),
                        value: o["label"].as_str()?.into(),
                        description: o["description"].as_str().unwrap_or_default().into(),
                    })
                })
                .collect(),
        })
        .collect()
}

pub fn elicitation(value: &Value) -> Result<AgentPrompt> {
    let mut p = prompt(
        "Integration needs your input",
        value["message"].as_str().unwrap_or_default(),
        &Value::Null,
    );
    p.details.clear();
    p.url = value["url"].as_str().map(str::to_owned);
    if let Some(properties) = value["requestedSchema"]["properties"].as_object() {
        for (id, field) in properties {
            let kind = field["type"].as_str().unwrap_or("string");
            ensure!(
                matches!(kind, "string" | "integer" | "number" | "boolean" | "array"),
                "Unsupported integration form field: {id}"
            );
            let choices = if kind == "array" {
                &field["items"]
            } else {
                field
            };
            let options = if kind == "boolean" {
                vec![
                    AgentInputOption {
                        label: "Yes".into(),
                        value: "true".into(),
                        description: String::new(),
                    },
                    AgentInputOption {
                        label: "No".into(),
                        value: "false".into(),
                        description: String::new(),
                    },
                ]
            } else if let Some(choices) = choices["enum"].as_array() {
                choices
                    .iter()
                    .enumerate()
                    .filter_map(|(i, v)| {
                        Some(AgentInputOption {
                            value: v.as_str()?.into(),
                            label: field["enumNames"][i].as_str().or(v.as_str())?.into(),
                            description: String::new(),
                        })
                    })
                    .collect()
            } else {
                choices["oneOf"]
                    .as_array()
                    .or(choices["anyOf"].as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|v| {
                        Some(AgentInputOption {
                            value: v["const"].as_str()?.into(),
                            label: v["title"].as_str().or(v["const"].as_str())?.into(),
                            description: String::new(),
                        })
                    })
                    .collect()
            };
            ensure!(
                kind != "array" || !options.is_empty(),
                "Unsupported integration form array: {id}"
            );
            p.questions.push(AgentInputQuestion {
                id: id.clone(),
                label: field["title"]
                    .as_str()
                    .or(field["description"].as_str())
                    .unwrap_or(id)
                    .into(),
                kind: if options.is_empty() { kind } else { "choice" }.into(),
                required: value["requestedSchema"]["required"]
                    .as_array()
                    .is_some_and(|r| r.contains(&json!(id))),
                multiple: kind == "array",
                options,
            });
        }
    }
    Ok(p)
}
pub fn elicitation_content(value: &Value, answer: &AgentAnswer) -> Result<Value> {
    let mut content = json!({});
    for (key, values) in &answer.answers {
        let Some(first) = values.first() else {
            continue;
        };
        if first.trim().is_empty() {
            continue;
        }
        content[key] = match value["requestedSchema"]["properties"][key]["type"].as_str() {
            Some("boolean") => json!(first.parse::<bool>()?),
            Some("number") => json!(first.parse::<f64>()?),
            Some("integer") => json!(first.parse::<i64>()?),
            Some("array") => json!(values),
            _ => json!(first),
        };
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn replies_are_one_shot_and_scoped_to_the_waiting_run() {
        let approvals = Approvals::default();
        let interaction = Interaction {
            approvals: &approvals,
            run_id: "run-a",
        };
        let emit = |phase: &str, text: &str| {
            if phase != "approval" {
                return;
            }
            let p: AgentPrompt = serde_json::from_str(text).unwrap();
            assert!(
                approvals
                    .respond("run-b", &p.id, AgentAnswer::default())
                    .is_err()
            );
            approvals
                .respond(
                    "run-a",
                    &p.id,
                    AgentAnswer {
                        allow: true,
                        ..Default::default()
                    },
                )
                .unwrap();
            assert!(
                approvals
                    .respond("run-a", &p.id, AgentAnswer::default())
                    .is_err()
            );
        };
        assert!(
            interaction
                .request(prompt("Write?", "", &json!({"file":"example.txt"})), &emit)
                .await
                .unwrap()
                .allow
        );
        assert!(approvals.entries.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn dropped_requests_cannot_be_approved_later() {
        let approvals = Approvals::default();
        let interaction = Interaction {
            approvals: &approvals,
            run_id: "run",
        };
        let observed = Mutex::new(String::new());
        let emit = |phase: &str, text: &str| {
            if phase == "approval" {
                *observed.lock().unwrap() = serde_json::from_str::<AgentPrompt>(text).unwrap().id;
            }
        };
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(10),
                interaction.request(prompt("Write?", "", &Value::Null), &emit)
            )
            .await
            .is_err()
        );
        assert!(
            approvals
                .respond(
                    "run",
                    &observed.lock().unwrap(),
                    AgentAnswer {
                        allow: true,
                        ..Default::default()
                    }
                )
                .is_err()
        );
    }
    #[test]
    fn integration_forms_preserve_types_and_do_not_default_to_consent() {
        let request = json!({"message":"Confirm update","requestedSchema":{"type":"object","required":["confirm"],"properties":{"confirm":{"type":"boolean"},"count":{"type":"integer"},"labels":{"type":"array","items":{"enum":["one","two"]}}}}});
        let p = elicitation(&request).unwrap();
        assert_eq!(p.questions.len(), 3);
        let answer = AgentAnswer {
            allow: true,
            answers: [
                ("confirm".into(), vec!["false".into()]),
                ("count".into(), vec!["3".into()]),
                ("labels".into(), vec!["one".into(), "two".into()]),
            ]
            .into(),
        };
        assert_eq!(
            elicitation_content(&request, &answer).unwrap(),
            json!({"confirm":false,"count":3,"labels":["one","two"]})
        );
    }
}
