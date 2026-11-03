export const repository = "https://github.com/crs48/diffcity";
// Only set this once the linked Apple silicon artifact is publicly downloadable.
// No token or private release URL is embedded in the site.
const configuredDownload = import.meta.env.PUBLIC_MACOS_DOWNLOAD_URL?.trim();
if (configuredDownload && !/^https:\/\/[^\s]+$/.test(configuredDownload)) {
  throw new Error("PUBLIC_MACOS_DOWNLOAD_URL must be an HTTPS download URL.");
}
export const downloadUrl: string | undefined = configuredDownload;
const configuredChrome = import.meta.env.PUBLIC_CHROME_DOWNLOAD_URL?.trim();
if (configuredChrome) {
  const releaseFolder = (value: string | undefined) => {
    if (!value?.startsWith(`${repository}/releases/download/`))
      return undefined;
    return value.slice(0, value.lastIndexOf("/"));
  };
  if (
    !releaseFolder(configuredChrome) ||
    releaseFolder(configuredChrome) !== releaseFolder(downloadUrl)
  )
    throw new Error(
      "Chrome and macOS downloads must belong to the same public GitHub release.",
    );
}
export const chromeDownloadUrl: string | undefined = configuredChrome;
export const releasesUrl = `${repository}/releases`;
export const notarized =
  import.meta.env.PUBLIC_MACOS_SIGNING_MODE === "developer-id";
