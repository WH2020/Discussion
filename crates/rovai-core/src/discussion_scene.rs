use std::{
    collections::HashSet,
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    db::Database,
    platform::private_storage::{atomic_write_private_json, open_private_read_write_file},
    team_tool::AuthenticatedTeamToolRun,
};

pub const DISCUSSION_SCENE_CREATE_TOOL_NAME: &str = "discussion.scene.create";
pub const MAX_PERSISTED_DISCUSSION_SCENES: usize = 40;

const STORE_SCHEMA_VERSION: u32 = 1;
const STORE_FILE_NAME: &str = "discussion-scenes-v1.json";
const STORE_MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 60;
const MAX_SUMMARY_CHARS: usize = 180;
const MAX_INSTRUCTIONS_CHARS: usize = 2_000;
const MAX_LIST_ITEMS: usize = 12;
const MAX_LIST_ITEM_CHARS: usize = 180;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscussionSceneCreateInput {
    pub creation_key: String,
    pub name: String,
    #[serde(default = "default_category")]
    pub category: String,
    pub summary: String,
    pub roles: Vec<String>,
    pub agenda: Vec<String>,
    pub deliverables: Vec<String>,
    #[serde(default)]
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiscussionSceneDefinition {
    pub id: String,
    pub name: String,
    pub category: String,
    pub summary: String,
    pub roles: Vec<String>,
    pub agenda: Vec<String>,
    pub deliverables: Vec<String>,
    pub instructions: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionSceneCreateOutcome {
    pub scene_id: String,
    pub name: String,
    pub category: String,
    #[serde(skip_serializing)]
    pub replayed: bool,
}

#[derive(Debug)]
pub struct DiscussionSceneCreateError {
    pub code: &'static str,
    pub message: &'static str,
    pub details: Option<Value>,
}

impl std::fmt::Display for DiscussionSceneCreateError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for DiscussionSceneCreateError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiscussionSceneDocument {
    schema_version: u32,
    scenes: Vec<DiscussionSceneDefinition>,
}

pub struct DiscussionSceneStore {
    path: PathBuf,
    scenes: Vec<DiscussionSceneDefinition>,
}

impl DiscussionSceneStore {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join(STORE_FILE_NAME);
        let scenes = if path.try_exists()? {
            let mut file = open_private_read_write_file(&path).with_context(|| {
                format!("failed to admit discussion scene store {}", path.display())
            })?;
            let read_limit = u64::try_from(STORE_MAX_BYTES)?.saturating_add(1);
            let mut bytes = Vec::new();
            Read::by_ref(&mut file)
                .take(read_limit)
                .read_to_end(&mut bytes)?;
            let loaded = if bytes.len() > STORE_MAX_BYTES {
                Err(anyhow::anyhow!(
                    "discussion scene store exceeds its byte limit"
                ))
            } else {
                serde_json::from_slice(&bytes)
                    .context("discussion scene store is invalid JSON")
                    .and_then(validate_document)
            };
            drop(file);
            match loaded {
                Ok(scenes) => scenes,
                Err(error) => recover_invalid_store(&path, error)?,
            }
        } else {
            Vec::new()
        };
        Ok(Self { path, scenes })
    }

    pub fn list(&self) -> Vec<DiscussionSceneDefinition> {
        self.scenes.clone()
    }

    fn create(
        &mut self,
        input: DiscussionSceneCreateInput,
    ) -> Result<DiscussionSceneCreateOutcome> {
        let creation_id = canonical_creation_id(&input.creation_key)?;
        let scene = normalize_definition(creation_id, input)?;

        if let Some(existing) = self.scenes.iter().find(|existing| existing.id == scene.id) {
            if existing == &scene {
                return Ok(DiscussionSceneCreateOutcome {
                    scene_id: existing.id.clone(),
                    name: existing.name.clone(),
                    category: existing.category.clone(),
                    replayed: true,
                });
            }
            return Err(scene_error(
                "discussion_scene.creation_key_conflict",
                "creationKey was already used with a different discussion scene",
            )
            .into());
        }

        if self.scenes.len() >= MAX_PERSISTED_DISCUSSION_SCENES {
            return Err(scene_error(
                "discussion_scene.limit_reached",
                "The maximum number of conversation-created discussion scenes has been reached",
            )
            .into());
        }
        let mut next = self.scenes.clone();
        next.push(scene.clone());
        atomic_write_private_json(
            &self.path,
            &DiscussionSceneDocument {
                schema_version: STORE_SCHEMA_VERSION,
                scenes: next.clone(),
            },
        )
        .context("failed to persist discussion scene store")?;
        self.scenes = next;
        Ok(DiscussionSceneCreateOutcome {
            scene_id: scene.id,
            name: scene.name,
            category: scene.category,
            replayed: false,
        })
    }
}

pub fn discussion_scene_create_input_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["creationKey", "name", "summary", "roles", "agenda", "deliverables"],
        "properties": {
            "creationKey": {
                "type": "string",
                "format": "uuid",
                "description": "A new canonical lowercase UUID. Reuse it only when retrying this exact confirmed scene creation."
            },
            "name": {"type": "string", "minLength": 1, "maxLength": MAX_NAME_CHARS},
            "category": {
                "type": "string",
                "enum": ["algorithm", "product", "architecture", "design", "general"],
                "default": "general"
            },
            "summary": {"type": "string", "minLength": 1, "maxLength": MAX_SUMMARY_CHARS},
            "roles": {
                "type": "array", "minItems": 1, "maxItems": MAX_LIST_ITEMS,
                "items": {"type": "string", "minLength": 1, "maxLength": MAX_LIST_ITEM_CHARS}
            },
            "agenda": {
                "type": "array", "minItems": 1, "maxItems": MAX_LIST_ITEMS,
                "items": {"type": "string", "minLength": 1, "maxLength": MAX_LIST_ITEM_CHARS}
            },
            "deliverables": {
                "type": "array", "minItems": 1, "maxItems": MAX_LIST_ITEMS,
                "items": {"type": "string", "minLength": 1, "maxLength": MAX_LIST_ITEM_CHARS}
            },
            "instructions": {"type": "string", "maxLength": MAX_INSTRUCTIONS_CHARS, "default": ""}
        }
    })
}

pub fn create_discussion_scene(
    database: &Database,
    authenticated_run: &AuthenticatedTeamToolRun,
    store: &mut DiscussionSceneStore,
    input: DiscussionSceneCreateInput,
) -> Result<DiscussionSceneCreateOutcome> {
    require_direct_user_trigger(database, authenticated_run)?;
    store.create(input)
}

fn validate_document(document: DiscussionSceneDocument) -> Result<Vec<DiscussionSceneDefinition>> {
    if document.schema_version != STORE_SCHEMA_VERSION {
        anyhow::bail!("unsupported discussion scene store schema version");
    }
    if document.scenes.len() > MAX_PERSISTED_DISCUSSION_SCENES {
        anyhow::bail!("discussion scene store contains too many scenes");
    }
    let mut ids = HashSet::new();
    for scene in &document.scenes {
        validate_persisted_definition(scene)?;
        if !ids.insert(scene.id.clone()) {
            anyhow::bail!("discussion scene store contains duplicate identifiers");
        }
    }
    Ok(document.scenes)
}

fn recover_invalid_store(
    path: &Path,
    error: anyhow::Error,
) -> Result<Vec<DiscussionSceneDefinition>> {
    let parent = path
        .parent()
        .context("discussion scene store has no parent")?;
    let recovery = parent.join(format!(
        "discussion-scenes-recovery-{}.json",
        Uuid::new_v4()
    ));
    std::fs::rename(path, &recovery).with_context(|| {
        format!(
            "failed to preserve invalid discussion scene store {}",
            path.display()
        )
    })?;
    eprintln!(
        "preserved invalid discussion scene store at {}: {error:#}",
        recovery.display()
    );
    Ok(Vec::new())
}

fn validate_persisted_definition(scene: &DiscussionSceneDefinition) -> Result<()> {
    let creation_key = scene
        .id
        .strip_prefix("dialogue:")
        .context("persisted discussion scene identifier is invalid")?;
    let creation_id = canonical_creation_id(creation_key)?;
    let normalized = normalize_definition(
        creation_id,
        DiscussionSceneCreateInput {
            creation_key: creation_key.to_string(),
            name: scene.name.clone(),
            category: scene.category.clone(),
            summary: scene.summary.clone(),
            roles: scene.roles.clone(),
            agenda: scene.agenda.clone(),
            deliverables: scene.deliverables.clone(),
            instructions: scene.instructions.clone(),
        },
    )?;
    if &normalized != scene {
        anyhow::bail!("persisted discussion scene is not canonical");
    }
    Ok(())
}

fn normalize_definition(
    creation_id: Uuid,
    input: DiscussionSceneCreateInput,
) -> Result<DiscussionSceneDefinition> {
    let name = normalize_required_text(input.name, MAX_NAME_CHARS)?;
    let summary = normalize_required_text(input.summary, MAX_SUMMARY_CHARS)?;
    let instructions = normalize_optional_text(input.instructions, MAX_INSTRUCTIONS_CHARS)?;
    let category = match input.category.as_str() {
        "algorithm" | "product" | "architecture" | "design" | "general" => input.category,
        _ => return Err(invalid_definition().into()),
    };
    Ok(DiscussionSceneDefinition {
        id: format!("dialogue:{creation_id}"),
        name,
        category,
        summary,
        roles: normalize_list(input.roles)?,
        agenda: normalize_list(input.agenda)?,
        deliverables: normalize_list(input.deliverables)?,
        instructions,
    })
}

fn normalize_required_text(value: String, maximum_chars: usize) -> Result<String> {
    let normalized = normalize_whitespace(&value);
    if normalized.is_empty() || normalized.chars().count() > maximum_chars {
        return Err(invalid_definition().into());
    }
    Ok(normalized)
}

fn normalize_optional_text(value: String, maximum_chars: usize) -> Result<String> {
    let normalized = normalize_whitespace(&value);
    if normalized.chars().count() > maximum_chars {
        return Err(invalid_definition().into());
    }
    Ok(normalized)
}

fn normalize_list(values: Vec<String>) -> Result<Vec<String>> {
    if values.is_empty() || values.len() > MAX_LIST_ITEMS {
        return Err(invalid_definition().into());
    }
    let mut normalized = Vec::with_capacity(values.len());
    let mut seen = HashSet::new();
    for value in values {
        let value = normalize_required_text(value, MAX_LIST_ITEM_CHARS)?;
        if seen.insert(value.clone()) {
            normalized.push(value);
        }
    }
    if normalized.is_empty() {
        return Err(invalid_definition().into());
    }
    Ok(normalized)
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn canonical_creation_id(value: &str) -> Result<Uuid> {
    Uuid::parse_str(value)
        .ok()
        .filter(|parsed| parsed.hyphenated().to_string() == value)
        .ok_or_else(|| {
            scene_error(
                "discussion_scene.invalid_creation_key",
                "creationKey must be a canonical lowercase UUID",
            )
            .into()
        })
}

fn invalid_definition() -> DiscussionSceneCreateError {
    scene_error(
        "discussion_scene.invalid_definition",
        "One or more discussion scene fields are invalid; fix the confirmed scene card and try again",
    )
}

fn scene_error(code: &'static str, message: &'static str) -> DiscussionSceneCreateError {
    DiscussionSceneCreateError {
        code,
        message,
        details: None,
    }
}

fn default_category() -> String {
    "general".to_string()
}

fn require_direct_user_trigger(
    database: &Database,
    authenticated_run: &AuthenticatedTeamToolRun,
) -> Result<()> {
    let trigger = database
        .connection()
        .query_row(
            r#"
            SELECT agent_run.invocation_kind, camp_message.author_type, camp_message.camp_id
            FROM agent_run
            LEFT JOIN camp_message
              ON camp_message.id = agent_run.trigger_camp_message_id
            WHERE agent_run.id = ?1
              AND agent_run.execution_epoch = ?2
            "#,
            params![
                authenticated_run.agent_run_id,
                authenticated_run.execution_epoch
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    if trigger
        .as_ref()
        .is_some_and(|(invocation_kind, author_type, camp_id)| {
            invocation_kind == "direct"
                && author_type.as_deref() == Some("user")
                && camp_id.as_deref() == Some(authenticated_run.camp_id.as_str())
        })
    {
        return Ok(());
    }
    Err(scene_error(
        "discussion_scene.user_confirmation_required",
        "Create a fixed discussion scene only from a direct user-triggered run after showing the final scene card and receiving confirmation",
    )
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("rovai-discussion-scenes-test-{}", Uuid::new_v4()));
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn input(creation_key: &str) -> DiscussionSceneCreateInput {
        DiscussionSceneCreateInput {
            creation_key: creation_key.to_string(),
            name: "  系统   故障复盘  ".to_string(),
            category: "architecture".to_string(),
            summary: "审查故障证据、影响范围与恢复措施。".to_string(),
            roles: vec!["主持人".to_string(), "可靠性工程师".to_string()],
            agenda: vec!["确认时间线".to_string(), "验证根因".to_string()],
            deliverables: vec!["根因结论".to_string(), "改进清单".to_string()],
            instructions: "区分事实、推断和未知信息。".to_string(),
        }
    }

    #[test]
    fn store_persists_and_exact_creation_key_retry_is_idempotent() {
        let directory = TestDirectory::new();
        let mut store = DiscussionSceneStore::open(directory.path()).unwrap();
        let creation_key = "2b945f3f-4b45-4ae5-92b2-739fce600338";
        let first = store.create(input(creation_key)).unwrap();
        let retry = store.create(input(creation_key)).unwrap();

        assert!(!first.replayed);
        assert!(retry.replayed);
        assert_eq!(first.scene_id, retry.scene_id);
        assert!(
            serde_json::to_value(&retry)
                .unwrap()
                .get("replayed")
                .is_none()
        );
        assert_eq!(store.list()[0].name, "系统 故障复盘");

        let reopened = DiscussionSceneStore::open(directory.path()).unwrap();
        assert_eq!(reopened.list(), store.list());
    }

    #[test]
    fn creation_key_conflict_is_rejected_and_duplicate_names_remain_addressable_by_id() {
        let directory = TestDirectory::new();
        let mut store = DiscussionSceneStore::open(directory.path()).unwrap();
        let first_key = "2b945f3f-4b45-4ae5-92b2-739fce600338";
        store.create(input(first_key)).unwrap();

        let mut changed = input(first_key);
        changed.summary = "不同定义".to_string();
        let conflict = store.create(changed).unwrap_err();
        assert_eq!(
            conflict
                .downcast_ref::<DiscussionSceneCreateError>()
                .unwrap()
                .code,
            "discussion_scene.creation_key_conflict"
        );

        let duplicate_name = store
            .create(input("f8ce4ee0-8284-46fd-8d0f-2b227f7d41e2"))
            .unwrap();
        assert!(!duplicate_name.replayed);
        assert_eq!(store.list().len(), 2);
    }

    #[test]
    fn invalid_store_is_preserved_for_recovery_without_blocking_startup() {
        let directory = TestDirectory::new();
        let path = directory.path().join(STORE_FILE_NAME);
        atomic_write_private_json(&path, &json!({"schemaVersion": 999, "scenes": []})).unwrap();

        let store = DiscussionSceneStore::open(directory.path()).unwrap();
        assert!(store.list().is_empty());
        assert!(!path.exists());
        assert!(std::fs::read_dir(directory.path()).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("discussion-scenes-recovery-")
        }));
    }

    #[test]
    fn forty_first_conversation_scene_is_rejected_without_changing_the_store() {
        let directory = TestDirectory::new();
        let mut store = DiscussionSceneStore::open(directory.path()).unwrap();
        for _ in 0..MAX_PERSISTED_DISCUSSION_SCENES {
            store
                .create(input(&Uuid::new_v4().hyphenated().to_string()))
                .unwrap();
        }

        let error = store
            .create(input(&Uuid::new_v4().hyphenated().to_string()))
            .unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<DiscussionSceneCreateError>()
                .unwrap()
                .code,
            "discussion_scene.limit_reached"
        );
        assert_eq!(store.list().len(), MAX_PERSISTED_DISCUSSION_SCENES);
    }

    #[test]
    fn schema_requires_a_complete_confirmed_scene_card() {
        let schema = discussion_scene_create_input_schema();
        assert_eq!(
            schema["required"],
            json!([
                "creationKey",
                "name",
                "summary",
                "roles",
                "agenda",
                "deliverables"
            ])
        );
        assert_eq!(schema["properties"]["roles"]["maxItems"], MAX_LIST_ITEMS);
        assert_eq!(schema["properties"]["category"]["default"], "general");
    }
}
