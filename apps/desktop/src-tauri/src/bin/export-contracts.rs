use diffcity_lib::contracts::*;
use ts_rs::TS;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut output =
        String::from("// Generated from Rust contracts. Run pnpm contracts; do not edit.\n");
    macro_rules! export { ($($t:ty),*) => { $(output.push_str("export "); output.push_str(&<$t>::decl(&ts_rs::Config::default())); output.push('\n');)* }; }
    export!(
        Settings,
        Connection,
        Model,
        ReasoningOption,
        ModelPreference,
        ModelCatalog,
        Bootstrap,
        Pins,
        Repository,
        RepositoryDirectory,
        InboxResult,
        InboxSync,
        PullRequest,
        PullStatus,
        SubmittedReview,
        PullPage,
        LineKind,
        DiffLine,
        Hunk,
        HunkContext,
        ChangedFile,
        Snapshot,
        Attention,
        Side,
        Anchor,
        Finding,
        GuideSection,
        Guide,
        Note,
        ReviewProgress,
        RemoteComment,
        ReviewWorkspace,
        RunEvent,
        PublishRequest,
        PublishResult
    );
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/contracts/src");
    std::fs::create_dir_all(&path)?;
    std::fs::write(path.join("index.ts"), output)?;
    Ok(())
}
