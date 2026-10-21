use crate::{contracts::*, domain};
use anyhow::{Context, Result, bail};
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant},
};
use tokio::{process::Command, sync::Mutex};

struct Session {
    token: String,
    login: String,
    etags: HashMap<String, (String, Value)>,
    next_request: Instant,
}
pub struct GitHub {
    client: Client,
    session: Mutex<Option<Session>>,
}
pub fn string(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_string()
}
fn integer(v: &Value, key: &str) -> u32 {
    v[key].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32
}

pub fn executable(configured: Option<&str>, name: &str, candidates: &[&str]) -> Result<String> {
    if let Some(path) = configured.filter(|s| !s.is_empty()) {
        if Path::new(path).is_file() {
            return Ok(path.to_string());
        }
        bail!("Configured {name} executable does not exist: {path}");
    }
    for path in candidates {
        if Path::new(path).is_file() {
            return Ok(path.to_string());
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(name);
            if p.is_file() {
                return Ok(p.to_string_lossy().into());
            }
        }
    }
    bail!("{name} was not found. Set its full executable path in Connections.")
}
impl GitHub {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: Client::builder()
                .timeout(Duration::from_secs(40))
                .user_agent("diffcity/0.1.0")
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            session: Mutex::new(None),
        })
    }
    pub async fn connect(&self, settings: &Settings) -> Result<Connection> {
        self.disconnect().await;
        let path = executable(
            settings.gh_path.as_deref(),
            "gh",
            &["/opt/homebrew/bin/gh", "/usr/local/bin/gh"],
        )?;
        let output = tokio::time::timeout(
            Duration::from_secs(15),
            Command::new(&path)
                .args(["auth", "token", "--hostname", "github.com"])
                .kill_on_drop(true)
                .output(),
        )
        .await??;
        if !output.status.success() {
            bail!("GitHub CLI is not signed in. Run gh auth login, then reconnect.");
        }
        let token = String::from_utf8(output.stdout)?.trim().to_string();
        if token.is_empty() {
            bail!("GitHub CLI returned no credential");
        }
        *self.session.lock().await = Some(Session {
            token,
            login: String::new(),
            etags: HashMap::new(),
            next_request: Instant::now(),
        });
        let user = match self.request(Method::GET, "/user", None, false).await {
            Ok(user) => user,
            Err(error) => {
                self.disconnect().await;
                return Err(error);
            }
        };
        let login = string(&user, "login");
        if let Some(s) = self.session.lock().await.as_mut() {
            s.login = login.clone();
        }
        Ok(Connection {
            connected: true,
            identity: login,
            executable: path,
            detail: "Connected through your local GitHub CLI".into(),
        })
    }
    pub async fn disconnect(&self) {
        *self.session.lock().await = None;
    }
    pub async fn login(&self) -> Result<String> {
        self.session
            .lock()
            .await
            .as_ref()
            .map(|s| s.login.clone())
            .ok_or_else(|| anyhow::anyhow!("Connect GitHub first"))
    }
    pub async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        conditional: bool,
    ) -> Result<Value> {
        if !path.starts_with('/') || path.starts_with("//") {
            bail!("Invalid GitHub API path");
        }
        let mut guard = self.session.lock().await;
        let session = guard
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("Connect your GitHub CLI account first"))?;
        let now = Instant::now();
        if session.next_request > now {
            let delay = session.next_request - now;
            if delay > Duration::from_secs(3) {
                bail!("GitHub rate limit: retry in {} seconds", delay.as_secs());
            }
            tokio::time::sleep(delay).await;
        }
        let mut request = self
            .client
            .request(method.clone(), format!("https://api.github.com{path}"))
            .bearer_auth(&session.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if conditional
            && method == Method::GET
            && let Some((tag, _)) = session.etags.get(path)
        {
            request = request.header("If-None-Match", tag);
        }
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .context("Could not reach GitHub. Your local drafts are safe.")?;
        let status = response.status();
        let headers = response.headers().clone();
        session.next_request = Instant::now()
            + Duration::from_millis(if method == Method::GET || path == "/graphql" {
                100
            } else {
                1000
            });
        if status == StatusCode::NOT_MODIFIED {
            return session
                .etags
                .get(path)
                .map(|(_, v)| v.clone())
                .ok_or_else(|| anyhow::anyhow!("GitHub cache unavailable; refresh again"));
        }
        let value: Value = response.json().await.with_context(|| {
            format!(
                "GitHub returned an unreadable response (HTTP {})",
                status.as_u16()
            )
        })?;
        if !status.is_success() {
            let message = value["message"].as_str().unwrap_or("Request failed");
            if status == StatusCode::TOO_MANY_REQUESTS
                || status == StatusCode::FORBIDDEN
                    && (message.to_lowercase().contains("rate limit")
                        || headers.contains_key("retry-after"))
            {
                let wait = headers
                    .get("retry-after")
                    .and_then(|s| s.to_str().ok())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(60);
                session.next_request = Instant::now() + Duration::from_secs(wait);
            }
            bail!("GitHub {}: {}", status.as_u16(), message);
        }
        if method == Method::GET {
            if let Some(tag) = headers.get("etag").and_then(|s| s.to_str().ok()) {
                session
                    .etags
                    .insert(path.into(), (tag.into(), value.clone()));
            }
        } else if path != "/graphql" {
            session.etags.clear();
        }
        Ok(value)
    }
    pub async fn pages(&self, path: &str) -> Result<Vec<Value>> {
        let mut out = vec![];
        for page in 1..=100 {
            let join = if path.contains('?') { '&' } else { '?' };
            let value = self
                .request(
                    Method::GET,
                    &format!("{path}{join}per_page=100&page={page}"),
                    None,
                    true,
                )
                .await?;
            let values = value.as_array().context("Expected a GitHub list")?;
            out.extend(values.iter().cloned());
            if values.len() < 100 {
                return Ok(out);
            }
        }
        bail!("GitHub list exceeds the local pagination budget; narrow the repository selection")
    }
    pub async fn repositories(&self) -> Result<Vec<Repository>> {
        Ok(self
            .pages("/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member")
            .await?
            .iter()
            .map(|v| Repository {
                id: v["id"].to_string(),
                full_name: string(v, "full_name"),
                private: v["private"].as_bool().unwrap_or(true),
                description: string(v, "description"),
                updated_at: v["updated_at"].as_str().map(str::to_owned),
                pushed_at: v["pushed_at"].as_str().map(str::to_owned),
            })
            .collect())
    }
    pub async fn pulls(&self, repo: &str) -> Result<Vec<PullRequest>> {
        if !domain::valid_repo(repo) {
            bail!("Use owner/repository, or a GitHub PR URL");
        }
        let mut pulls: Vec<_> = self
            .pages(&format!(
                "/repos/{repo}/pulls?state=open&sort=updated&direction=desc"
            ))
            .await?
            .iter()
            .map(|v| parse_pull(repo, v))
            .collect();
        let login = self.login().await?;
        let (owner, name) = repo.split_once('/').context("Invalid repo")?;
        // Batch review metadata: one request per 25 PRs, not one request per PR.
        for batch in pulls.chunks_mut(25) {
            let fields = batch.iter().map(|p| format!(
                "p{}: pullRequest(number:{}) {{ reviewDecision reviews(last:1, author:$viewer, states:[APPROVED,CHANGES_REQUESTED,COMMENTED,DISMISSED]) {{ nodes {{ state submittedAt }} }} }}", p.number, p.number
            )).collect::<Vec<_>>().join(" ");
            let query = format!(
                "query($owner:String!,$name:String!,$viewer:String!) {{ repository(owner:$owner,name:$name) {{ {fields} }} }}"
            );
            let value = self.request(Method::POST, "/graphql", Some(&json!({"query":query,"variables":{"owner":owner,"name":name,"viewer":login}})), false).await?;
            if value["errors"].as_array().is_some_and(|e| !e.is_empty()) {
                bail!("GitHub review status unavailable: {}", value["errors"]);
            }
            for pull in batch {
                let node = &value["data"]["repository"][format!("p{}", pull.number)];
                apply_review_metadata(pull, node)?;
            }
        }
        Ok(pulls)
    }
    pub async fn recently_completed(
        &self,
        repos: &[String],
        days: u32,
    ) -> Result<Vec<PullRequest>> {
        if days == 0 || repos.is_empty() {
            return Ok(vec![]);
        }
        if repos.iter().any(|r| !domain::valid_repo(r)) {
            bail!("Invalid repo");
        }
        let login = self.login().await?;
        let cutoff = chrono::Utc::now() - chrono::Duration::days(i64::from(days));
        let mut pulls = vec![];
        for repo in repos {
            // Closed PRs can be updated long after completion. Page by updated_at,
            // then filter by actual completion time; never use updated_at as completion.
            for page in 1..=100 {
                let value = self.request(Method::GET, &format!("/repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page={page}"), None, true).await?;
                let items = value.as_array().context("Expected closed PRs")?;
                pulls.extend(items.iter().map(|v| parse_pull(repo, v)).filter(|p| {
                    p.author.eq_ignore_ascii_case(&login)
                        && p.closed_at
                            .as_deref()
                            .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
                            .is_some_and(|date| date >= cutoff)
                }));
                if recent_page_complete(items, &cutoff) {
                    break;
                }
                if page == 100 {
                    bail!(
                        "Recent completions exceed the pagination budget; narrow the completion window or repo selection."
                    );
                }
            }
        }
        Ok(pulls)
    }
    pub async fn history(&self, repo: &str, page: u32) -> Result<PullPage> {
        if !domain::valid_repo(repo) || page == 0 || page > 1000 {
            bail!("Invalid repository or history page");
        }
        let value = self.request(Method::GET, &format!("/repos/{repo}/pulls?state=closed&sort=updated&direction=desc&per_page=30&page={page}"), None, true).await?;
        let values = value.as_array().context("Expected a GitHub history list")?;
        Ok(PullPage { pulls: values.iter().map(|v| parse_pull(repo,v)).collect(), next_page: (values.len()==30 && page<1000).then_some(page+1), sync_error: (values.len()==30 && page==1000).then(|| "History is limited to 30,000 PRs per repository; older PRs can still be opened by URL.".into()) })
    }
    pub async fn pull(&self, repo: &str, number: u32) -> Result<PullRequest> {
        if !domain::valid_repo(repo) || number == 0 {
            bail!("Invalid pull request");
        }
        Ok(parse_pull(
            repo,
            &self
                .request(
                    Method::GET,
                    &format!("/repos/{repo}/pulls/{number}"),
                    None,
                    false,
                )
                .await?,
        ))
    }
    pub async fn snapshot(&self, repo: &str, number: u32) -> Result<Snapshot> {
        for _ in 0..3 {
            let before = self.pull(repo, number).await?;
            let files = self
                .pages(&format!("/repos/{repo}/pulls/{number}/files"))
                .await?;
            let after = self.pull(repo, number).await?;
            if before.base != after.base || before.head != after.head {
                continue;
            }
            let id = domain::hash(&format!(
                "capture-v2/{repo}/{number}/{}/{}/{}",
                after.base,
                after.head,
                serde_json::to_string(&files)?
            ));
            let mut limitations = Vec::new();
            if files.len() != after.changed_files as usize {
                limitations.push(format!(
                    "GitHub supplied {} of {} changed files.",
                    files.len(),
                    after.changed_files
                ));
            }
            let mut parsed: Vec<ChangedFile> = files.iter().map(|v| {
                let path = string(v, "filename");
                let (hunks, unavailable) = match v["patch"].as_str() {
                    Some(p) => match domain::parse_patch(&path, p, &id) {
                        Ok(h) if !h.is_empty() && crate::text_diff::matches_counts(&h, integer(v, "additions"), integer(v, "deletions")) => (h, None),
                        Ok(_) => (vec![], Some("GitHub supplied no complete text patch; inspect file metadata in GitHub.".into())),
                        Err(e) => (vec![], Some(e.to_string())),
                    },
                    None => (vec![], Some("GitHub did not supply a text patch (binary, metadata-only, or oversized content).".into())),
                };
                ChangedFile { path, previous_path: v["previous_filename"].as_str().map(str::to_string), status: string(v, "status"), additions: integer(v, "additions"), deletions: integer(v, "deletions"), hunks, unavailable }
            }).collect();
            let needs_content = parsed
                .iter()
                .any(|f| f.unavailable.is_some() && f.additions + f.deletions > 0);
            if needs_content {
                // PR diffs compare the merge base, which can differ from the target branch tip.
                let comparison = self
                    .request(
                        Method::GET,
                        &format!(
                            "/repos/{repo}/compare/{}...{}?per_page=1",
                            after.base, after.head
                        ),
                        None,
                        true,
                    )
                    .await;
                let merge_base = comparison
                    .as_ref()
                    .ok()
                    .and_then(|v| v["merge_base_commit"]["sha"].as_str());
                let mut bytes_left = 16 * 1024 * 1024;
                for (index, file) in parsed
                    .iter_mut()
                    .filter(|f| f.unavailable.is_some() && f.additions + f.deletions > 0)
                    .enumerate()
                {
                    let result = match merge_base {
                        Some(base) if index < 20 && bytes_left > 0 => {
                            self.reconstruct_file(
                                repo,
                                base,
                                &after.head,
                                file,
                                &id,
                                &mut bytes_left,
                            )
                            .await
                        }
                        Some(_) => Err(anyhow::anyhow!(
                            "Text fallback budget reached (20 files / 16 MiB)"
                        )),
                        None => Err(anyhow::anyhow!(
                            "Could not determine the immutable merge base for text reconstruction"
                        )),
                    };
                    match result {
                        Ok(hunks) => {
                            file.hunks = hunks;
                            file.unavailable = None;
                        }
                        Err(error) => {
                            file.unavailable = Some(format!("Text capture unavailable: {error}"))
                        }
                    }
                }
            }
            return Ok(Snapshot {
                id,
                pull: after,
                captured_at: chrono::Utc::now().to_rfc3339(),
                files: parsed,
                limitations,
            });
        }
        bail!("The PR kept changing during capture. Try refreshing when the push finishes.")
    }
    async fn text_at(
        &self,
        repo: &str,
        revision: &str,
        path: &str,
        bytes_left: &mut usize,
    ) -> Result<String> {
        let mut url = reqwest::Url::parse("https://api.github.com")?;
        url.path_segments_mut()
            .expect("base URL supports paths")
            .extend(["repos"])
            .extend(repo.split('/'))
            .push("contents")
            .extend(path.split('/'));
        url.query_pairs_mut().append_pair("ref", revision);
        let mut guard = self.session.lock().await;
        let session = guard.as_mut().context("Connect GitHub first")?;
        if session.next_request > Instant::now() {
            let delay = session
                .next_request
                .saturating_duration_since(Instant::now());
            if delay > Duration::from_secs(3) {
                bail!("GitHub rate limit; retry later");
            }
            tokio::time::sleep(delay).await;
        }
        let mut response = self
            .client
            .get(url)
            .bearer_auth(&session.token)
            .header("Accept", "application/vnd.github.raw+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await?;
        session.next_request = Instant::now() + Duration::from_millis(100);
        if !response.status().is_success() {
            if response.status() == StatusCode::TOO_MANY_REQUESTS
                || response.status() == StatusCode::FORBIDDEN
            {
                session.next_request = Instant::now() + Duration::from_secs(60);
            }
            bail!("GitHub content returned {}", response.status());
        }
        let limit = crate::text_diff::MAX_FILE_BYTES.min(*bytes_left);
        if response
            .content_length()
            .is_some_and(|size| size > limit as u64)
        {
            bail!("File exceeds the remaining text capture budget");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > limit {
                bail!("File exceeds the remaining text capture budget");
            }
            *bytes_left -= chunk.len();
            bytes.extend_from_slice(&chunk);
        }
        String::from_utf8(bytes).context("File is binary or not UTF-8 text")
    }
    async fn reconstruct_file(
        &self,
        repo: &str,
        base: &str,
        head: &str,
        file: &ChangedFile,
        revision: &str,
        bytes_left: &mut usize,
    ) -> Result<Vec<Hunk>> {
        let old = if file.status == "added" {
            String::new()
        } else {
            self.text_at(
                repo,
                base,
                file.previous_path.as_deref().unwrap_or(&file.path),
                bytes_left,
            )
            .await?
        };
        let new = if file.status == "removed" {
            String::new()
        } else {
            self.text_at(repo, head, &file.path, bytes_left).await?
        };
        crate::text_diff::reconstruct(file, &old, &new, revision)
    }
    pub async fn comments(&self, pull: &PullRequest) -> Result<Vec<RemoteComment>> {
        let base = format!("/repos/{}", pull.repository);
        let mut result = vec![];
        for path in [
            format!("{base}/issues/{}/comments", pull.number),
            format!("{base}/pulls/{}/comments", pull.number),
        ] {
            for v in self.pages(&path).await? {
                result.push(RemoteComment {
                    id: v["id"].to_string(),
                    author: string(&v["user"], "login"),
                    body: string(&v, "body"),
                    path: v["path"].as_str().map(str::to_string),
                    line: v["line"].as_u64().map(|n| n as u32),
                    side: v["side"]
                        .as_str()
                        .map(|s| if s == "LEFT" { Side::LEFT } else { Side::RIGHT }),
                    commit: v["commit_id"].as_str().map(str::to_string),
                    url: string(&v, "html_url"),
                    created_at: string(&v, "created_at"),
                });
            }
        }
        for review in self.reviews(pull).await? {
            if review["state"] == "PENDING" || string(&review, "body").trim().is_empty() {
                continue;
            }
            result.push(RemoteComment {
                id: format!("review-{}", review["id"]),
                author: string(&review["user"], "login"),
                body: string(&review, "body"),
                path: None,
                line: None,
                side: None,
                commit: review["commit_id"].as_str().map(str::to_string),
                url: string(&review, "html_url"),
                created_at: string(&review, "submitted_at"),
            });
        }
        result.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(result)
    }
    pub async fn checks(&self, pull: &PullRequest) -> Result<String> {
        let base = format!("/repos/{}/commits/{}", pull.repository, pull.head);
        let mut items = vec![];
        let mut complete = false;
        for page in 1..=100 {
            let value = self
                .request(
                    Method::GET,
                    &format!("{base}/check-runs?filter=latest&per_page=100&page={page}"),
                    None,
                    true,
                )
                .await?;
            let runs = value["check_runs"]
                .as_array()
                .context("GitHub check runs were incomplete")?;
            items.extend(runs.iter().cloned());
            if runs.len() < 100 {
                complete = true;
                break;
            }
        }
        if !complete {
            bail!("Check results exceed the local pagination budget");
        }
        let statuses = self
            .request(
                Method::GET,
                &format!("{base}/status?per_page=1"),
                None,
                true,
            )
            .await?;
        Ok(summarize_checks(&items, &statuses))
    }
    pub async fn review(&self, pull: &PullRequest, payload: &Value) -> Result<Value> {
        self.request(
            Method::POST,
            &format!("/repos/{}/pulls/{}/reviews", pull.repository, pull.number),
            Some(payload),
            false,
        )
        .await
    }
    pub async fn reviews(&self, pull: &PullRequest) -> Result<Vec<Value>> {
        self.pages(&format!(
            "/repos/{}/pulls/{}/reviews",
            pull.repository, pull.number
        ))
        .await
    }
}
pub fn summarize_checks(items: &[Value], statuses: &Value) -> String {
    let mut counts = [0_usize; 5]; // passed, failed, pending, skipped, unknown
    for item in items {
        let index = if item["status"] != "completed" {
            2
        } else {
            match item["conclusion"].as_str() {
                Some("success") => 0,
                Some(
                    "failure" | "timed_out" | "cancelled" | "action_required" | "stale"
                    | "startup_failure",
                ) => 1,
                Some("neutral" | "skipped") => 3,
                _ => 4,
            }
        };
        counts[index] += 1;
    }
    let mut parts: Vec<String> = counts
        .iter()
        .zip([
            "passed",
            "failed",
            "running",
            "skipped or neutral",
            "unknown",
        ])
        .filter(|(count, _)| **count > 0)
        .map(|(count, label)| format!("{count} checks {label}"))
        .collect();
    let total = statuses["total_count"].as_u64().unwrap_or(0);
    if total > 0 {
        let state = match statuses["state"].as_str() {
            Some("success") => "passed",
            Some("failure") => "failed",
            Some("pending") => "pending",
            _ => "unknown",
        };
        parts.push(format!("{total} status contexts {state}"));
    }
    if parts.is_empty() {
        "No checks reported".into()
    } else {
        parts.join(" · ")
    }
}

pub fn parse_pull(repo: &str, v: &Value) -> PullRequest {
    let users = |key: &str| {
        v[key]
            .as_array()
            .map(|vs| vs.iter().map(|v| string(v, "login")).collect())
            .unwrap_or_default()
    };
    PullRequest {
        repository: repo.into(),
        number: integer(v, "number"),
        title: string(v, "title"),
        body: string(v, "body"),
        author: string(&v["user"], "login"),
        url: string(v, "html_url"),
        draft: v["draft"].as_bool().unwrap_or(false),
        state: if v["merged_at"].as_str().is_some() || v["merged"].as_bool() == Some(true) {
            "merged".into()
        } else {
            string(v, "state")
        },
        head: string(&v["head"], "sha"),
        base: string(&v["base"], "sha"),
        head_ref: string(&v["head"], "ref"),
        base_ref: string(&v["base"], "ref"),
        updated_at: string(v, "updated_at"),
        closed_at: v["closed_at"].as_str().map(str::to_owned),
        merged_at: v["merged_at"].as_str().map(str::to_owned),
        viewer_review: None,
        review_decision: None,
        review_metadata_available: false,
        requested: users("requested_reviewers"),
        assigned: users("assignees"),
        additions: integer(v, "additions"),
        deletions: integer(v, "deletions"),
        changed_files: integer(v, "changed_files"),
    }
}
fn recent_page_complete(items: &[Value], cutoff: &chrono::DateTime<chrono::Utc>) -> bool {
    items.len() < 100
        || items
            .last()
            .and_then(|v| v["updated_at"].as_str())
            .and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok())
            .is_some_and(|date| date < *cutoff)
}

pub(crate) fn apply_review_metadata(pull: &mut PullRequest, node: &Value) -> Result<()> {
    if !node.is_object() || !node["reviews"]["nodes"].is_array() {
        bail!(
            "GitHub review status unavailable for {}#{}",
            pull.repository,
            pull.number
        );
    }
    pull.review_metadata_available = true;
    pull.review_decision = node["reviewDecision"].as_str().map(str::to_owned);
    pull.viewer_review = node["reviews"]["nodes"]
        .as_array()
        .and_then(|reviews| reviews.last())
        .and_then(|review| {
            let state = review["state"].as_str()?;
            if !["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].contains(&state) {
                return None;
            }
            Some(SubmittedReview {
                state: state.into(),
                submitted_at: review["submittedAt"].as_str()?.into(),
            })
        });
    Ok(())
}

pub fn payload(
    snapshot: &Snapshot,
    request: &PublishRequest,
    notes: &[Note],
    login: &str,
) -> Result<Value> {
    if snapshot.pull.state != "open" {
        bail!(
            "This PR is closed. Private notes and Codex discussion remain available; GitHub reviews require an open PR."
        );
    }
    if !["COMMENT", "APPROVE", "REQUEST_CHANGES"].contains(&request.event.as_str()) {
        bail!("Invalid review action");
    }
    if snapshot.pull.author == login && request.event != "COMMENT" {
        bail!("GitHub only permits Comment on your own pull request");
    }
    let mut comments = vec![];
    let mut body = request.body.clone();
    let mut seen = std::collections::HashSet::new();
    for id in &request.note_ids {
        if !seen.insert(id) {
            bail!("A draft was selected twice");
        }
        let note = notes
            .iter()
            .find(|n| &n.id == id && n.snapshot_id == snapshot.id)
            .context("A selected draft no longer belongs to this revision")?;
        if !note.github_draft || note.published_url.is_some() || note.body.trim().is_empty() {
            bail!("Only unpublished, explicitly prepared drafts can be sent");
        }
        if let Some(anchor) = &note.anchor {
            domain::validate_anchor(snapshot, anchor)?;
            let mut c =
                json!({"path":anchor.path,"side":anchor.side,"line":anchor.line,"body":note.body});
            if anchor.start_line != anchor.line {
                c["start_line"] = json!(anchor.start_line);
                c["start_side"] = json!(anchor.side);
            }
            comments.push(c);
        } else {
            if !body.is_empty() {
                body.push_str("\n\n");
            }
            body.push_str(&note.body);
        }
    }
    if body.trim().is_empty() && comments.is_empty() && request.event == "COMMENT" {
        bail!("Add a review summary or select at least one draft");
    }
    Ok(
        json!({"commit_id":snapshot.pull.head,"event":request.event,"body":body,"comments":comments}),
    )
}

#[cfg(test)]
mod inbox_tests {
    use super::*;
    #[test]
    fn review_metadata_excludes_pending_and_dismissed_submissions() {
        let mut pull = parse_pull("a/b", &json!({"number": 1}));
        for state in [
            "APPROVED",
            "CHANGES_REQUESTED",
            "COMMENTED",
            "DISMISSED",
            "PENDING",
        ] {
            apply_review_metadata(&mut pull, &json!({"reviewDecision":"REVIEW_REQUIRED","reviews":{"nodes":[{"state":state,"submittedAt":"2026-10-21T00:00:00Z"}]}})).unwrap();
            assert_eq!(
                pull.viewer_review.is_some(),
                !["DISMISSED", "PENDING"].contains(&state)
            );
            assert!(pull.review_metadata_available);
        }
        apply_review_metadata(&mut pull, &json!({"reviews":{"nodes":[]}})).unwrap();
        assert!(pull.viewer_review.is_none());
        assert!(apply_review_metadata(&mut pull, &Value::Null).is_err());
    }
    #[test]
    fn recent_pagination_continues_past_old_prs_with_new_comments() {
        let cutoff = chrono::DateTime::parse_from_rfc3339("2026-10-19T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let recent =
            json!({"closed_at":"2020-01-01T00:00:00Z", "updated_at":"2026-10-21T00:00:00Z"});
        assert!(!recent_page_complete(&vec![recent; 100], &cutoff));
        let old = json!({"updated_at":"2026-10-18T00:00:00Z"});
        assert!(recent_page_complete(&vec![old; 100], &cutoff));
        assert!(recent_page_complete(&[], &cutoff));
    }
    #[test]
    fn completion_dates_and_legacy_cache_fields_are_preserved() {
        let pull = parse_pull(
            "a/b",
            &json!({"number":1,"state":"closed","closed_at":"2026-10-20T12:00:00Z","merged_at":"2026-10-20T12:00:00Z"}),
        );
        assert_eq!(pull.state, "merged");
        assert_eq!(pull.closed_at, pull.merged_at);
        let mut old = serde_json::to_value(&pull).unwrap();
        for field in [
            "closedAt",
            "mergedAt",
            "viewerReview",
            "reviewDecision",
            "reviewMetadataAvailable",
        ] {
            old.as_object_mut().unwrap().remove(field);
        }
        let decoded: PullRequest = serde_json::from_value(old).unwrap();
        assert!(decoded.viewer_review.is_none());
        assert!(!decoded.review_metadata_available);
    }
}
