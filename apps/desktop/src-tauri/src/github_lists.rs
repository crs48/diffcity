//! Batched metadata discovery. Source contents are still fetched only when opening a PR.
use crate::{
    contracts::*,
    domain,
    github::{GitHub, string},
};
use anyhow::{Context, Result, bail};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;

pub(crate) const BATCH_SIZE: usize = 5;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct PullCursor {
    pub repository: String,
    pub after: Option<String>,
}
pub(crate) struct RepoPage {
    pub pulls: Vec<PullRequest>,
    pub next: Option<PullCursor>,
}

impl GitHub {
    pub async fn organizations(&self) -> Result<Vec<String>> {
        Ok(self
            .pages("/user/orgs")
            .await?
            .iter()
            .map(|v| string(v, "login"))
            .filter(|login| domain::valid_repo(&format!("{login}/repo")))
            .collect())
    }
    pub(crate) async fn pull_pages(
        &self,
        cursors: &[PullCursor],
        closed: bool,
    ) -> Result<Vec<(String, Result<RepoPage, String>)>> {
        if cursors.is_empty() {
            return Ok(vec![]);
        }
        if cursors.len() > BATCH_SIZE || cursors.iter().any(|c| !domain::valid_repo(&c.repository))
        {
            bail!("Invalid PR batch");
        }
        let fields = cursors.iter().enumerate().map(|(i,c)| {
            let (owner,name)=c.repository.split_once('/').unwrap();
            format!("r{i}: repository(owner:{},name:{}) {{ pullRequests(first:30,after:{},states:[{}],orderBy:{{field:UPDATED_AT,direction:DESC}}) {{ nodes {{ ...PullSummary }} pageInfo {{ hasNextPage endCursor }} }} }}",
                json!(owner),json!(name),json!(c.after),if closed { "CLOSED,MERGED" } else { "OPEN" })
        }).collect::<Vec<_>>().join("\n");
        let (query, variables) = if closed {
            (format!("query {{ {fields} }} {CLOSED_SUMMARY}"), json!({}))
        } else {
            (
                format!("query($viewer:String!) {{ {fields} }} {PULL_SUMMARY}"),
                json!({"viewer":self.login().await?}),
            )
        };
        let result = self
            .request(
                Method::POST,
                "/graphql",
                Some(&json!({"query":query,"variables":variables})),
                false,
            )
            .await?;
        Ok(cursors
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let alias = format!("r{i}");
                let errors = result["errors"]
                    .as_array()
                    .map(|errors| {
                        errors
                            .iter()
                            .filter(|error| {
                                error["path"][0].as_str().is_none_or(|path| path == alias)
                            })
                            .map(|error| string(error, "message"))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let page = if errors.is_empty() {
                    parse_page(c, &result["data"][&alias]["pullRequests"])
                        .map_err(|e| e.to_string())
                } else {
                    Err(errors.join("; "))
                };
                (c.repository.clone(), page)
            })
            .collect())
    }
    /// A transient failure in a large query must not hide every repo in its batch.
    pub(crate) async fn resilient_pull_pages(
        &self,
        cursors: &[PullCursor],
        closed: bool,
    ) -> Vec<(String, Result<RepoPage, String>)> {
        let pages = match self.pull_pages(cursors, closed).await {
            Ok(pages) => pages,
            Err(error) => cursors
                .iter()
                .map(|c| (c.repository.clone(), Err(format!("{error:#}"))))
                .collect(),
        };
        let mut results = Vec::with_capacity(cursors.len());
        for (cursor, (repo, page)) in cursors.iter().zip(pages) {
            if page.is_err() && cursors.len() > 1 {
                let retried = self.pull_pages(std::slice::from_ref(cursor), closed).await;
                results.push((
                    repo,
                    match retried {
                        Ok(mut pages) => pages.remove(0).1,
                        Err(error) => Err(format!("{error:#}")),
                    },
                ));
            } else {
                results.push((repo, page));
            }
        }
        results
    }
    pub(crate) async fn inbox_batch(
        &self,
        repositories: &[String],
    ) -> HashMap<String, Result<Vec<PullRequest>, String>> {
        let mut results: HashMap<_, _> = repositories
            .iter()
            .map(|repo| (repo.clone(), Ok(vec![])))
            .collect();
        let mut pending: Vec<_> = repositories
            .iter()
            .map(|repo| PullCursor {
                repository: repo.clone(),
                after: None,
            })
            .collect();
        for page in 0..1000 {
            if pending.is_empty() {
                break;
            }
            let mut next = vec![];
            for (repo, result) in self.resilient_pull_pages(&pending, false).await {
                match result {
                    Ok(batch) => {
                        if let Some(cursor) = batch.next {
                            if page == 999 {
                                results.insert(
                                    repo.clone(),
                                    Err("PR pagination limit reached; saved results retained"
                                        .into()),
                                );
                                continue;
                            }
                            next.push(cursor);
                        }
                        if let Some(Ok(pulls)) = results.get_mut(&repo) {
                            pulls.extend(batch.pulls);
                        }
                    }
                    Err(error) => {
                        results.insert(repo, Err(error));
                    }
                }
            }
            pending = next;
        }
        results
    }
    /// Recent completions belong to the viewer, so query once rather than scanning every repo's history.
    pub(crate) async fn recent_completions(&self, days: u32) -> Result<Vec<PullRequest>> {
        if days == 0 {
            return Ok(vec![]);
        }
        let cutoff = chrono::Utc::now() - chrono::Duration::days(i64::from(days));
        let mut after: Option<String> = None;
        let mut pulls = vec![];
        for _ in 0..1000 {
            let query = format!(
                "query($after:String) {{ viewer {{ pullRequests(first:50,after:$after,states:[CLOSED,MERGED],orderBy:{{field:UPDATED_AT,direction:DESC}}) {{ nodes {{ repository {{ nameWithOwner }} ...PullSummary }} pageInfo {{ hasNextPage endCursor }} }} }} }} {CLOSED_SUMMARY}"
            );
            let result = self
                .request(
                    Method::POST,
                    "/graphql",
                    Some(&json!({"query":query,"variables":{"after":after}})),
                    false,
                )
                .await?;
            if let Some(errors) = result["errors"]
                .as_array()
                .filter(|errors| !errors.is_empty())
            {
                bail!(
                    "{}",
                    errors
                        .iter()
                        .map(|e| string(e, "message"))
                        .collect::<Vec<_>>()
                        .join("; ")
                );
            }
            let connection = &result["data"]["viewer"]["pullRequests"];
            let nodes = connection["nodes"]
                .as_array()
                .context("GitHub did not return recent completions")?;
            for node in nodes {
                let repo = string(&node["repository"], "nameWithOwner");
                if !domain::valid_repo(&repo) {
                    bail!("Missing completion repository");
                }
                let pull = parse_summary(&repo, node)?;
                if pull
                    .closed_at
                    .as_deref()
                    .is_some_and(|date| !before(date, &cutoff))
                {
                    pulls.push(pull);
                }
            }
            let next = next_cursor(after.as_deref(), connection)?;
            if next.is_none()
                || nodes
                    .last()
                    .is_some_and(|p| before(&string(p, "updatedAt"), &cutoff))
            {
                return Ok(pulls);
            }
            after = next;
        }
        bail!("Recent completion pagination limit reached; saved results retained")
    }
}
fn before(date: &str, cutoff: &chrono::DateTime<chrono::Utc>) -> bool {
    chrono::DateTime::parse_from_rfc3339(date)
        .map(|date| date < *cutoff)
        .unwrap_or(true)
}
// Diff statistics can time out on large PRs. They are not shown in inbox cards;
// opening a PR fetches its full metadata and statistics separately.
const CLOSED_SUMMARY: &str = r#"
fragment PullSummary on PullRequest {
  number title url isDraft state author { login }
  headRefOid baseRefOid headRefName baseRefName updatedAt closedAt mergedAt
}
"#;
const PULL_SUMMARY: &str = r#"
fragment PullSummary on PullRequest {
  number title url isDraft state author { login }
  headRefOid baseRefOid headRefName baseRefName updatedAt closedAt mergedAt
  reviewDecision mergeable mergeStateStatus statusCheckRollup { state }
  assignees(first:100) { nodes { login } pageInfo { hasNextPage } }
  reviewRequests(first:100) { nodes { requestedReviewer { ... on User { login } } } pageInfo { hasNextPage } }
  reviews(last:1,author:$viewer,states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) { nodes { state submittedAt } }
}
"#;
fn parse_page(cursor: &PullCursor, value: &Value) -> Result<RepoPage> {
    let nodes = value["nodes"]
        .as_array()
        .context("GitHub did not return this repository's PRs")?;
    let pulls = nodes
        .iter()
        .map(|node| parse_summary(&cursor.repository, node))
        .collect::<Result<_>>()?;
    let next = next_cursor(cursor.after.as_deref(), value)?.map(|after| PullCursor {
        repository: cursor.repository.clone(),
        after: Some(after),
    });
    Ok(RepoPage { pulls, next })
}
fn next_cursor(previous: Option<&str>, value: &Value) -> Result<Option<String>> {
    if !value["pageInfo"]["hasNextPage"]
        .as_bool()
        .context("Missing PR page information")?
    {
        return Ok(None);
    }
    let after = string(&value["pageInfo"], "endCursor");
    if after.is_empty() || previous == Some(&after) {
        bail!("GitHub returned a non-advancing PR cursor");
    }
    Ok(Some(after))
}

fn parse_summary(repository: &str, node: &Value) -> Result<PullRequest> {
    if node["assignees"]["pageInfo"]["hasNextPage"] == true
        || node["reviewRequests"]["pageInfo"]["hasNextPage"] == true
    {
        bail!("GitHub reviewer metadata exceeds the page size");
    }
    let number = node["number"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= u32::MAX as u64)
        .context("Missing PR number")? as u32;
    let open = node["state"] == "OPEN";
    let empty = vec![];
    let list = |key: &str| -> Result<&Vec<Value>> {
        match node[key]["nodes"].as_array() {
            Some(nodes) => Ok(nodes),
            None if !open => Ok(&empty),
            None => bail!("Missing {key}"),
        }
    };
    let mut pull = PullRequest {
        repository: repository.into(),
        number,
        title: string(node, "title"),
        body: String::new(),
        author: string(&node["author"], "login"),
        url: string(node, "url"),
        draft: node["isDraft"].as_bool().unwrap_or(false),
        state: string(node, "state").to_lowercase(),
        head: string(node, "headRefOid"),
        base: string(node, "baseRefOid"),
        head_ref: string(node, "headRefName"),
        base_ref: string(node, "baseRefName"),
        updated_at: string(node, "updatedAt"),
        closed_at: node["closedAt"].as_str().map(str::to_owned),
        merged_at: node["mergedAt"].as_str().map(str::to_owned),
        viewer_review: None,
        review_decision: None,
        review_metadata_available: false,
        status: crate::github::parse_pull_status(node),
        assigned: list("assignees")?
            .iter()
            .map(|v| string(v, "login"))
            .collect(),
        requested: list("reviewRequests")?
            .iter()
            .filter_map(|v| v["requestedReviewer"]["login"].as_str().map(str::to_owned))
            .collect(),
        additions: node["additions"].as_u64().unwrap_or(0) as u32,
        deletions: node["deletions"].as_u64().unwrap_or(0) as u32,
        changed_files: node["changedFiles"].as_u64().unwrap_or(0) as u32,
    };
    if open || node["reviews"].is_object() {
        crate::github::apply_review_metadata(&mut pull, node)?;
    }
    Ok(pull)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn node() -> Value {
        json!({"number":3,"title":"Fix","state":"MERGED","author":{"login":"me"},"closedAt":"2026-10-21T10:00:00Z","mergedAt":"2026-10-21T10:00:00Z","assignees":{"nodes":[{"login":"me"}],"pageInfo":{"hasNextPage":false}},"reviewRequests":{"nodes":[{"requestedReviewer":{"login":"me"}},{"requestedReviewer":{}}],"pageInfo":{"hasNextPage":false}},"reviews":{"nodes":[{"state":"APPROVED","submittedAt":"2026-10-20T10:00:00Z"}]},"reviewDecision":"APPROVED"})
    }
    #[test]
    fn closed_summaries_do_not_need_review_queries_but_open_summaries_do() {
        let mut n = json!({"number":1,"state":"MERGED","closedAt":"2026-10-21T10:00:00Z"});
        let p = parse_summary("org/repo", &n).unwrap();
        assert_eq!(p.state, "merged");
        assert!(!p.review_metadata_available);
        n["state"] = json!("OPEN");
        assert!(parse_summary("org/repo", &n).is_err());
    }
    #[test]
    fn graphql_preserves_priority_and_completion_metadata() {
        let p = parse_summary("org/repo", &node()).unwrap();
        assert_eq!(p.state, "merged");
        assert_eq!(p.requested, vec!["me"]);
        assert_eq!(p.assigned, vec!["me"]);
        assert_eq!(p.viewer_review.unwrap().state, "APPROVED");
        assert!(p.closed_at.is_some());
        assert!(p.merged_at.is_some());
    }
    #[test]
    fn status_rollups_preserve_conflicts_and_distinguish_absent_checks_from_no_checks() {
        let mut n = node();
        n["state"] = json!("OPEN");
        n["mergeable"] = json!("CONFLICTING");
        n["mergeStateStatus"] = json!("DIRTY");
        n["statusCheckRollup"] = json!({"state":"FAILURE"});
        let p = parse_summary("org/repo", &n).unwrap();
        let status = p.status.unwrap();
        assert_eq!(status.mergeable.as_deref(), Some("CONFLICTING"));
        assert_eq!(status.merge_state.as_deref(), Some("DIRTY"));
        assert_eq!(status.checks.as_deref(), Some("FAILURE"));
        n["statusCheckRollup"] = Value::Null;
        assert_eq!(
            parse_summary("org/repo", &n)
                .unwrap()
                .status
                .unwrap()
                .checks
                .as_deref(),
            Some("NONE")
        );
        n.as_object_mut().unwrap().remove("statusCheckRollup");
        assert!(
            parse_summary("org/repo", &n)
                .unwrap()
                .status
                .unwrap()
                .checks
                .is_none()
        );
        assert!(parse_summary("org/repo", &node()).unwrap().status.is_none());
    }
    #[test]
    fn incomplete_pages_and_nested_metadata_are_not_silently_accepted() {
        let cursor = PullCursor {
            repository: "org/repo".into(),
            after: Some("same".into()),
        };
        assert!(parse_page(&cursor, &Value::Null).is_err());
        assert!(
            parse_page(
                &cursor,
                &json!({"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}})
            )
            .is_err()
        );
        let mut n = node();
        n["assignees"]["pageInfo"]["hasNextPage"] = json!(true);
        assert!(parse_summary("org/repo", &n).is_err());
    }
    #[test]
    fn a_full_page_carries_a_repo_specific_cursor() {
        let cursor = PullCursor {
            repository: "org/repo".into(),
            after: None,
        };
        let page = parse_page(
            &cursor,
            &json!({"nodes":[node()],"pageInfo":{"hasNextPage":true,"endCursor":"next"}}),
        )
        .unwrap();
        assert_eq!(page.next.unwrap().after.as_deref(), Some("next"));
        assert_eq!(page.pulls.len(), 1);
    }
}
