import { useState, type ReactNode } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import {
  BookOpen,
  Building2,
  ChevronDown,
  FlaskConical,
  Plus,
  Settings2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Bootstrap } from "../lib/api";

function RailButton({
  label,
  detail,
  selected,
  onPress,
  children,
}: {
  label: string;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <TooltipTrigger delay={300}>
      <Button
        className="account-button"
        aria-label={label}
        aria-pressed={selected}
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
  owner,
  samples,
  data,
  onOwner,
  onRepos,
  onSamples,
  onExample,
  onConnections,
}: {
  owners: string[];
  owner: string | null;
  samples: boolean;
  data: Bootstrap | null;
  onOwner: (owner: string | null) => void;
  onRepos: () => void;
  onSamples: () => void;
  onExample: () => void;
  onConnections: () => void;
}) {
  const { t } = useTranslation();
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
        detail={t("Pull requests across your tracked repos")}
        selected={!owner && !samples}
        onPress={() => onOwner(null)}
      >
        <Building2 size={21} aria-hidden="true" />
      </RailButton>
      <nav
        className="account-list"
        aria-label={t("Choose an organization or account")}
      >
        {owners.map((name) => (
          <RailButton
            key={name}
            label={name}
            detail={t("View tracked repos")}
            selected={owner === name && !samples}
            onPress={() => onOwner(name)}
          >
            <AccountAvatar owner={name} />
          </RailButton>
        ))}
      </nav>
      <RailButton label={t("Add repos")} onPress={onRepos}>
        <Plus size={19} aria-hidden="true" />
      </RailButton>
      <div className="rail-bottom">
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
  onChange,
}: {
  repositories: string[];
  owner: string | null;
  repository: string | null;
  onChange: (repository: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="repo-filter">
      <span>{t("Repo")}</span>
      <span className="repo-select">
        <select
          value={repository ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">{t("All tracked repos")}</option>
          {repositories.map((repo) => (
            <option key={repo} value={repo}>
              {owner ? repo.split("/")[1] : repo}
            </option>
          ))}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </label>
  );
}
