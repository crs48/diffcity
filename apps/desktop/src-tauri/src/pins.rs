//! Pins are local preferences, separate from connection/display settings and sync caches.
use crate::{contracts::*, domain, service::Service, storage::Store};
use anyhow::{Result, bail};

pub(crate) fn pull_key(pull: &PullRequest) -> String {
    format!("{}#{}", pull.repository.to_lowercase(), pull.number)
}

impl Store {
    pub fn pins(&self) -> Result<Pins> {
        Ok(Pins {
            repositories: self.list("pinned-repo")?,
            pulls: self
                .list::<PullRequest>("pinned-pull")?
                .into_iter()
                .map(|pin| {
                    Ok(self
                        .get::<PullRequest>("pinned-pull-cache", &pull_key(&pin))?
                        .filter(|fresh| fresh.updated_at >= pin.updated_at)
                        .unwrap_or(pin))
                })
                .collect::<Result<_>>()?,
        })
    }
}

impl Service {
    pub fn pin_repository(&self, repository: &str, pinned: bool) -> Result<Pins> {
        if !domain::valid_repo(repository) {
            bail!("Use owner/repository");
        }
        let key = repository.to_lowercase();
        if pinned {
            self.store.put("pinned-repo", &key, &repository)?;
        } else {
            self.store.delete("pinned-repo", &key)?;
        }
        self.store.pins()
    }

    pub fn pin_pull(&self, mut pull: PullRequest, pinned: bool) -> Result<Pins> {
        if !domain::valid_repo(&pull.repository)
            || pull.number == 0
            || !["open", "closed", "merged"].contains(&pull.state.as_str())
        {
            bail!("Invalid pull request pin");
        }
        let key = pull_key(&pull);
        if pinned {
            // Only metadata is needed to keep a pinned historical PR discoverable.
            pull.body.clear();
            self.store.put("pinned-pull", &key, &pull)?;
        } else {
            self.store.delete("pinned-pull", &key)?;
        }
        self.store.pins()
    }

    pub(crate) async fn sync_pinned_pulls(
        &self,
        pulls: &mut Vec<PullRequest>,
        errors: &mut Vec<String>,
    ) -> Result<()> {
        for pin in self.store.pins()?.pulls {
            if crate::fixtures::is_sample_repo(&pin.repository) {
                continue;
            }
            let key = pull_key(&pin);
            let fresh = match pulls.iter().find(|p| pull_key(p) == key) {
                Some(pull) => pull.clone(),
                None => match self.github.pull(&pin.repository, pin.number).await {
                    Ok(mut pull) => {
                        pull.body.clear();
                        pulls.push(pull.clone());
                        pull
                    }
                    Err(error) => {
                        errors.push(format!("Pinned {key}: {error:#}"));
                        pulls.push(pin);
                        continue;
                    }
                },
            };
            // Metadata refresh never recreates a pin removed while a request was in flight.
            self.store.put("pinned-pull-cache", &key, &fresh)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pull() -> PullRequest {
        serde_json::from_str::<ReviewWorkspace>(include_str!(
            "../../../../tests/fixtures/review-workspace.json"
        ))
        .unwrap()
        .snapshot
        .pull
    }

    #[test]
    fn pins_survive_restart_and_do_not_replace_settings_or_duplicate_case_variants() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let settings = service.store.settings().unwrap();
        service.pin_repository("Org/Repo", true).unwrap();
        service.pin_repository("org/repo", true).unwrap();
        let p = pull();
        service.pin_pull(p.clone(), true).unwrap();
        drop(service);
        let restarted = Service::new(root.path()).unwrap();
        let pins = restarted.store.pins().unwrap();
        assert_eq!(pins.repositories, vec!["org/repo"]);
        assert_eq!(pins.pulls.len(), 1);
        assert!(pins.pulls[0].body.is_empty());
        assert_eq!(
            serde_json::to_value(restarted.store.settings().unwrap()).unwrap(),
            serde_json::to_value(settings).unwrap()
        );
        restarted.pin_repository("ORG/REPO", false).unwrap();
        restarted.pin_pull(p, false).unwrap();
        assert!(restarted.store.pins().unwrap().repositories.is_empty());
        assert!(restarted.store.pins().unwrap().pulls.is_empty());
    }

    #[test]
    fn refreshed_closed_metadata_survives_restart_without_resurrecting_unpinned_prs() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let mut p = pull();
        service.pin_pull(p.clone(), true).unwrap();
        p.state = "merged".into();
        p.updated_at = "2099-01-01T00:00:00Z".into();
        service
            .store
            .put("pinned-pull-cache", &pull_key(&p), &p)
            .unwrap();
        assert_eq!(service.store.pins().unwrap().pulls[0].state, "merged");
        service.pin_pull(p.clone(), false).unwrap();
        service
            .store
            .put("pinned-pull-cache", &pull_key(&p), &p)
            .unwrap();
        assert!(service.store.pins().unwrap().pulls.is_empty());
    }

    #[tokio::test]
    async fn pinned_history_survives_offline_sync_and_fresh_inbox_metadata_wins() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let mut p = pull();
        p.repository = "org/repo".into();
        p.state = "closed".into();
        service.pin_pull(p.clone(), true).unwrap();
        let mut pulls = vec![];
        let mut errors = vec![];
        service
            .sync_pinned_pulls(&mut pulls, &mut errors)
            .await
            .unwrap();
        assert_eq!(pulls.len(), 1);
        assert_eq!(pulls[0].state, "closed");
        assert_eq!(errors.len(), 1);
        // A reopened PR is already in the ordinary inbox and needs no extra request.
        p.state = "open".into();
        pulls = vec![p];
        errors.clear();
        service
            .sync_pinned_pulls(&mut pulls, &mut errors)
            .await
            .unwrap();
        assert_eq!(pulls.len(), 1);
        assert!(errors.is_empty());
        assert_eq!(service.store.pins().unwrap().pulls[0].state, "open");
    }

    #[test]
    fn invalid_pins_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        assert!(service.pin_repository("../wrong", true).is_err());
        let mut p = pull();
        p.number = 0;
        assert!(service.pin_pull(p, true).is_err());
    }
}
