//! Model choices are independent preferences so connection/display saves cannot overwrite them.
use crate::{codex, contracts::*, service::Service, storage::Store};
use anyhow::{Context, Result, bail};

impl Store {
    pub fn model_preference(&self) -> Result<ModelPreference> {
        if let Some(preference) = self.get("model-preference", "main")? {
            return Ok(preference);
        }
        // Preserve an explicit selection made in the old Connections picker.
        // Its reasoning was always medium. Unselected installs use the new default.
        Ok(match self.settings()?.model.filter(|m| !m.is_empty()) {
            Some(model) => ModelPreference {
                provider: "codex".into(),
                model,
                reasoning_effort: Some("medium".into()),
            },
            None => ModelPreference::default(),
        })
    }
}

pub fn validate_preference<'a>(
    preference: &ModelPreference,
    models: &'a [Model],
) -> Result<&'a Model> {
    if preference.provider != "codex" {
        bail!("This version supports Codex. Choose Codex in Model settings.");
    }
    let model = models.iter().find(|m| m.id == preference.model)
        .with_context(|| format!("{} is not available through your local Codex. Refresh the models or choose another model in Model settings.", preference.model))?;
    if let Some(effort) = &preference.reasoning_effort
        && !model
            .reasoning_efforts
            .iter()
            .any(|option| &option.effort == effort)
    {
        bail!(
            "{} does not support {effort} reasoning. Choose an available reasoning level in Model settings.",
            model.name
        );
    }
    Ok(model)
}

impl Service {
    pub async fn model_catalog(&self) -> Result<ModelCatalog> {
        let (connection, models) = codex::connection(
            &self.store.settings()?,
            &self.store.directory.join("review-context"),
        )
        .await?;
        Ok(ModelCatalog { connection, models })
    }

    pub async fn save_model_preference(
        &self,
        preference: ModelPreference,
    ) -> Result<ModelPreference> {
        let catalog = self.model_catalog().await?;
        validate_preference(&preference, &catalog.models)?;
        self.store.put("model-preference", "main", &preference)?;
        Ok(preference)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_legacy_choices_survive_independent_settings_saves() {
        let root = tempfile::tempdir().unwrap();
        let store = Store::open(root.path()).unwrap();
        assert_eq!(
            store.model_preference().unwrap(),
            ModelPreference::default()
        );
        let mut settings = store.settings().unwrap();
        settings.model = Some("previous-choice".into());
        store.put("settings", "main", &settings).unwrap();
        assert_eq!(
            store.model_preference().unwrap(),
            ModelPreference {
                provider: "codex".into(),
                model: "previous-choice".into(),
                reasoning_effort: Some("medium".into()),
            }
        );
        let selected = ModelPreference {
            model: "another-model".into(),
            reasoning_effort: None,
            ..ModelPreference::default()
        };
        store.put("model-preference", "main", &selected).unwrap();
        settings.theme = "dark".into();
        store.put("settings", "main", &settings).unwrap();
        drop(store);
        let restored = Store::open(root.path()).unwrap();
        assert_eq!(restored.model_preference().unwrap(), selected);
        assert_eq!(restored.settings().unwrap().theme, "dark");
    }

    #[test]
    fn unknown_models_providers_and_unsupported_efforts_are_not_silently_substituted() {
        let models = vec![Model {
            id: "gpt-6-astra".into(),
            name: "GPT-6 Astra".into(),
            is_default: false,
            description: String::new(),
            default_reasoning_effort: Some("medium".into()),
            reasoning_efforts: vec![ReasoningOption {
                effort: "xhigh".into(),
                description: String::new(),
            }],
        }];
        let preference = ModelPreference::default();
        assert!(validate_preference(&preference, &models).is_ok());
        assert!(
            validate_preference(
                &ModelPreference {
                    reasoning_effort: None,
                    ..preference.clone()
                },
                &models
            )
            .is_ok()
        );
        for invalid in [
            ModelPreference {
                model: "unavailable".into(),
                ..preference.clone()
            },
            ModelPreference {
                provider: "unknown".into(),
                ..preference.clone()
            },
            ModelPreference {
                reasoning_effort: Some("unsupported".into()),
                ..preference
            },
        ] {
            assert!(validate_preference(&invalid, &models).is_err());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_save_preserves_previous_default() {
        let root = tempfile::tempdir().unwrap();
        let service = Service::new(root.path()).unwrap();
        let mut settings = service.store.settings().unwrap();
        settings.codex_path = Some(codex::fake_binary(root.path()));
        service.settings(settings).unwrap();
        let selected = ModelPreference {
            model: "gpt-6-luna".into(),
            reasoning_effort: Some("low".into()),
            ..ModelPreference::default()
        };
        service
            .save_model_preference(selected.clone())
            .await
            .unwrap();
        let invalid = ModelPreference {
            reasoning_effort: Some("xhigh".into()),
            ..selected.clone()
        };
        assert!(service.save_model_preference(invalid).await.is_err());
        assert_eq!(
            Service::new(root.path())
                .unwrap()
                .store
                .model_preference()
                .unwrap(),
            selected
        );
    }
}
