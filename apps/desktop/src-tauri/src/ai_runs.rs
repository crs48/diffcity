//! Independent jobs share only a bounded execution budget, never a response stream.
use anyhow::{Result, ensure};
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::{Semaphore, SemaphorePermit, watch};

pub struct Runs {
    entries: Mutex<HashMap<String, (String, watch::Sender<bool>)>>,
    slots: Semaphore,
}
impl Default for Runs {
    fn default() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            slots: Semaphore::new(4),
        }
    }
}
impl Runs {
    pub fn begin(&self, id: &str, scope: String) -> Result<Run<'_>> {
        ensure!(!id.is_empty(), "An AI job needs a run ID");
        let mut entries = self.entries.lock().unwrap();
        ensure!(!entries.contains_key(id), "This AI job is already running");
        ensure!(
            !entries.values().any(|(existing, _)| existing == &scope),
            "This conversation already has a response in progress"
        );
        ensure!(
            entries.len() < 32,
            "The AI queue is full; wait for a job to finish"
        );
        let (tx, cancel) = watch::channel(false);
        entries.insert(id.to_owned(), (scope, tx));
        Ok(Run {
            id: id.to_owned(),
            owner: self,
            cancel,
        })
    }
    pub fn cancel(&self, id: &str) {
        if let Some((_, tx)) = self.entries.lock().unwrap().get(id) {
            let _ = tx.send(true);
        }
    }
}
pub struct Run<'a> {
    id: String,
    owner: &'a Runs,
    pub cancel: watch::Receiver<bool>,
}
impl Run<'_> {
    pub async fn wait(&self) -> Result<SemaphorePermit<'_>> {
        let mut cancel = self.cancel.clone();
        ensure!(!*cancel.borrow(), "AI job cancelled");
        tokio::select! {
            biased;
            _ = cancel.changed() => anyhow::bail!("AI job cancelled"),
            permit = self.owner.slots.acquire() => Ok(permit?),
        }
    }
}
impl Drop for Run<'_> {
    fn drop(&mut self) {
        self.owner.entries.lock().unwrap().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn queues_after_four_jobs_and_cancels_only_the_target() {
        let runs = Runs::default();
        let jobs: Vec<_> = (0..6)
            .map(|n| runs.begin(&n.to_string(), format!("thread-{n}")).unwrap())
            .collect();
        let mut permits = Vec::new();
        for job in &jobs[..4] {
            permits.push(job.wait().await.unwrap());
        }
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), jobs[4].wait())
                .await
                .is_err()
        );
        runs.cancel("4");
        assert!(jobs[4].wait().await.is_err());
        assert!(!*jobs[0].cancel.borrow());
        runs.cancel("0");
        assert!(*jobs[0].cancel.borrow());
        assert!(!*jobs[1].cancel.borrow());
        permits.pop();
        assert!(jobs[5].wait().await.is_ok());
    }
    #[test]
    fn duplicate_threads_are_rejected_and_dropped_jobs_release_the_scope() {
        let runs = Runs::default();
        let job = runs.begin("one", "review/code-range".into()).unwrap();
        assert!(runs.begin("two", "review/code-range".into()).is_err());
        assert!(runs.begin("one", "different".into()).is_err());
        drop(job);
        let next = runs.begin("two", "review/code-range".into()).unwrap();
        runs.cancel("one");
        assert!(!*next.cancel.borrow());
    }
}
