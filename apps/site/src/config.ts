export const repository = "https://github.com/crs48/diffcity";
// Only set this once the linked Apple silicon artifact is publicly downloadable.
// No token or private release URL is embedded in the site.
const configuredDownload = import.meta.env.PUBLIC_MACOS_DOWNLOAD_URL?.trim();
if (configuredDownload && !/^https:\/\/[^\s]+$/.test(configuredDownload)) {
  throw new Error("PUBLIC_MACOS_DOWNLOAD_URL must be an HTTPS download URL.");
}
export const downloadUrl: string | undefined = configuredDownload;
export const releasesUrl = `${repository}/releases`;
export const notarized =
  import.meta.env.PUBLIC_MACOS_SIGNING_MODE === "developer-id";
