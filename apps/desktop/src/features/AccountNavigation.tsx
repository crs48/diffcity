import { useState, type ReactNode } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import {
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  RefreshCw,
  Pin,
  Settings2,
  Cpu,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { PinToggle } from "../ui/PinToggle";
import { groupAccountOwners, sameLogin } from "../lib/inbox";
import type { Bootstrap } from "../lib/api";
import { defaultModelPreference, effortLabel } from "../lib/models";

function RailButton({
  label,
  detail,
  selected,
  expanded,
  controls,
  id,
  hidden,
  disabled,
  onPress,
  children,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  expanded?: boolean;
  controls?: string;
  id?: string;
  hidden?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger delay={300}>
      <Button
        className="account-button"
        aria-label={label}
        aria-pressed={selected}
        aria-expanded={expanded}
        aria-controls={controls}
        id={id}
        hidden={hidden}
        isDisabled={disabled}
        onPress={onPress}
      >
        {children}
      </Button>
      <Tooltip placement="right" offset={10} className="rail-tooltip">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </Tooltip>
    </TooltipTrigger>
  );
}

function AccountAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="account-avatar" aria-hidden="true">
      <span>{owner.slice(0, 2).toUpperCase()}</span>
      {!failed && (
        <img
          src={`https://github.com/${encodeURIComponent(owner)}.png?size=80`}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function AccountNavigation({
  owners,
  activity,
  owner,
  samples,
  data,
  onOwner,
  onRefresh,
  onSamples,
  onExample,
  onConnections,
  onModel,
  modelOpen,
}: {
  owners: string[];
  activity: ReadonlyMap<string, number>;
  owner: string | null;
  samples: boolean;
  data: Bootstrap | null;
  onOwner: (owner: string | null) => void;
  onRefresh: () => void;
  onSamples: () => void;
  onExample: () => void;
  onConnections: () => void;
  onModel: () => void;
  modelOpen: boolean;
}) {
  const { t } = useTranslation();
  const preference = data?.modelPreference ?? defaultModelPreference;
  const modelName =
    data?.models.find((model) => model.id === preference.model)?.name ??
    preference.model;
  const modelDetail = `${preference.provider === "claude" ? "Claude" : "Codex"} · ${modelName} · ${t(preference.reasoningEffort ? effortLabel(preference.reasoningEffort) : "Model default")}`;
  const [showInactive, setShowInactive] = useState(false);
  const { visible, inactive } = groupAccountOwners(
    owners,
    activity,
    data?.github.identity ?? "",
    owner,
  );
  const accountId = (name: string) => `account-${name.toLowerCase()}`;
  const accountButton = (name: string, hidden = false) => (
    <RailButton
      key={accountId(name)}
      id={accountId(name)}
      label={name}
      detail={t("View all repos")}
      selected={owner === name && !samples}
      hidden={hidden}
      onPress={() => onOwner(name)}
    >
      <AccountAvatar owner={name} />
    </RailButton>
  );
  const connectionDetail = [
    data?.github.connected
      ? t("GitHub connected as {{login}}", { login: data.github.identity })
      : t("GitHub disconnected"),
    data?.codex.connected ? t("Codex connected") : t("Codex disconnected"),
  ].join(" · ");
  return (
    <aside
      className="account-rail"
      aria-label={t("Organizations and accounts")}
    >
      <div className="traffic-spacer" data-tauri-drag-region />
      <div
        className="rail-brand"
        aria-label="diffcity"
        role="img"
        data-tauri-drag-region
      >
        <div className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
      <RailButton
        label={t("All accounts")}
        detail={t("Pull requests across all accessible repos")}
        selected={!owner && !samples}
        onPress={() => onOwner(null)}
      >
        <Building2 size={21} aria-hidden="true" />
      </RailButton>
      <nav
        className="account-list"
        aria-label={t("Choose an organization or account")}
      >
        {[
          ...visible.map((name) => accountButton(name)),
          inactive.length > 0 && (
            <RailButton
              key="inactive-accounts"
              label={t(
                showInactive
                  ? "Hide inactive accounts ({{count}})"
                  : "Show inactive accounts ({{count}})",
                { count: inactive.length },
              )}
              detail={t("No known updates in the last 30 days")}
              expanded={showInactive}
              controls={inactive.map(accountId).join(" ")}
              onPress={() => setShowInactive((expanded) => !expanded)}
            >
              <span className="inactive-accounts-count" aria-hidden="true">
                {showInactive ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
                <span>{inactive.length}</span>
              </span>
            </RailButton>
          ),
          ...inactive.map((name) => accountButton(name, !showInactive)),
        ]}
      </nav>
      <RailButton label={t("Refresh repos and accounts")} onPress={onRefresh}>
        <RefreshCw size={19} aria-hidden="true" />
      </RailButton>
      <div className="rail-bottom">
        <RailButton
          label={t("Model")}
          detail={modelDetail}
          selected={modelOpen}
          disabled={!data}
          onPress={onModel}
        >
          <span className="rail-model">
            <Cpu size={18} aria-hidden="true" />
            <span>{t("Model")}</span>
          </span>
        </RailButton>
        <RailButton
          label={t("Sample inbox")}
          selected={samples}
          onPress={onSamples}
        >
          <FlaskConical size={19} aria-hidden="true" />
        </RailButton>
        <RailButton label={t("Explore a sample")} onPress={onExample}>
          <BookOpen size={19} aria-hidden="true" />
        </RailButton>
        <RailButton
          label={t("Connections")}
          detail={connectionDetail}
          onPress={onConnections}
        >
          <Settings2 size={19} aria-hidden="true" />
          {data && (!data.github.connected || !data.codex.connected) && (
            <span className="connection-attention" aria-hidden="true">
              !
            </span>
          )}
        </RailButton>
      </div>
    </aside>
  );
}

export function RepoFilter({
  repositories,
  owner,
  repository,
  pinned,
  saving,
  onChange,
  onPin,
}: {
  repositories: string[];
  owner: string | null;
  repository: string | null;
  pinned: string[];
  saving: boolean;
  onChange: (repository: string | null) => void;
  onPin: (repository: string) => void;
}) {
  const { t } = useTranslation();
  const isPinned = (repo: string) => pinned.some((pin) => sameLogin(pin, repo));
  const favorites = repositories.filter(isPinned);
  const others = repositories.filter((repo) => !isPinned(repo));
  const options = (repos: string[]) =>
    repos.map((repo) => (
      <option key={repo} value={repo}>
        {owner ? repo.split("/")[1] : repo}
      </option>
    ));
  return (
    <>
      <div className="repo-filter">
        <label htmlFor="repo-selector">{t("Repo")}</label>
        <span className="repo-select">
          <select
            id="repo-selector"
            value={repository ?? ""}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">{t("All repos")}</option>
            {favorites.length ? (
              <>
                <optgroup label={t("Pinned repos")}>
                  {options(favorites)}
                </optgroup>
                {!!others.length && (
                  <optgroup label={t("Other repos")}>
                    {options(others)}
                  </optgroup>
                )}
              </>
            ) : (
              options(repositories)
            )}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </span>
        {repository && (
          <PinToggle
            id="pin-repository"
            label={t(
              isPinned(repository)
                ? "Unpin repo {{repo}}"
                : "Pin repo {{repo}}",
              { repo: repository },
            )}
            pinned={isPinned(repository)}
            disabled={saving}
            onPress={() => onPin(repository)}
          />
        )}
      </div>
      {!!favorites.length && (
        <nav className="pinned-repos" aria-label={t("Pinned repos")}>
          {favorites.map((repo) => (
            <Button
              key={repo}
              aria-label={t("Show pinned repo {{repo}}", { repo })}
              aria-pressed={sameLogin(repo, repository || "")}
              onPress={() => onChange(repo)}
            >
              <Pin size={12} aria-hidden="true" />
              {owner ? repo.split("/")[1] : repo}
            </Button>
          ))}
        </nav>
      )}
    </>
  );
}
