# Diff City website

A static, one-page Astro + Tailwind CSS site for [diff.city](https://diff.city). The page uses local fonts, a keyboard-accessible gallery of real app screenshots and a full-window recording, light/dark themes, and no analytics, cookies, or backend. Theme preference is saved in local storage. The screenshots are captured from the installed macOS app reviewing sample PRs in `crs48/diffcity`, with actual Claude Code guides and responses. The screenshots show the entire app window at its normal zoom, including the navigation rail and window controls, while reviewing the Diff City test corpus.

## Local development

Use Node.js 24 and the repository's pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm site:dev
pnpm site:build
pnpm site:preview
```

Astro prints the available local URL (normally port 4321). `site:build` runs Astro's type checks before producing `apps/site/dist/`. No desktop or Rust build is needed.

## Downloads

The page links to the public MIT repository. Without a configured download it offers source builds; with a verified public release it displays the macOS download, release notes, checksums, and installation instructions.

Set the repository Actions variable `PUBLIC_MACOS_DOWNLOAD_URL` to a verified public HTTPS release asset URL and rerun the website workflow on `main`. Prefer the versioned `releases/download/TAG/diffcity-macos-arm64.dmg` URL; GitHub's latest-release shortcut excludes alphas. Confirm an unauthenticated visitor can fetch it before enabling the link.

The workflow also passes `MACOS_SIGNING_MODE` as `PUBLIC_MACOS_SIGNING_MODE`. Only `developer-id` displays “signed and notarized”; otherwise the page explicitly explains that the alpha is unsigned/not notarized and links to macOS approval instructions. Keep this setting consistent with the linked artifact's `release.json`. Publishing this site does not change repository visibility. See [release operations](../../docs/releasing.md).

## GitHub Pages

The `Publish Diff City website` workflow validates website changes and uploads only the static `dist` directory. Production uses `main`. Leave `SITE_DEPLOY_BRANCH` unset (or set it to `main`) and allow `main` in the `github-pages` environment's deployment branch policy. The variable remains available for an intentional temporary preview deployment.

In repository **Settings → Pages**, the build source must be **GitHub Actions**. Allow the chosen production branch in the `github-pages` environment's deployment branch policy. Pull requests and other branches build without deploying. No personal access token is stored in the workflow; GitHub's short-lived deployment token is used.

`astro.config.mjs`, canonical metadata, the sitemap, and `public/CNAME` use `https://diff.city`. Set the Pages custom domain to `diff.city` and point the domain's DNS at GitHub Pages following [GitHub's custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site). Enable **Enforce HTTPS** once GitHub has issued the certificate. GitHub Pages for a private source repository requires an eligible GitHub plan; the generated website is public.

## Editing

- `src/pages/index.astro`: page content, metadata, theme toggle.
- `src/components/ReviewPreview.astro`: keyboard-accessible media tabs, captions, playback controls, and source PR links.
- `src/styles/global.css`: Tailwind entry point, neutral surfaces, responsive styles.
- `../../packages/brand/palette.css`: shared GitHub PR colors for both themes; see the [palette reference](../../packages/brand/README.md).
- `src/config.ts`: repository and validated optional download URL.
- `public/`: domain, favicon, social image, robots file, and sitemap.

Run `pnpm --filter @diffcity/site format` to format this package. Verify the built page at desktop and phone widths, all four workflow tabs, keyboard navigation, and both themes before deploying visual changes.

## Refreshing screenshots

Generate a guide inside the installed Diff City app using a sample PR from this repository. Capture the real overview, guided diff, or inline conversation through the native app. Keep the PR and model attribution accurate, and inspect each capture before publishing. Use the full app window without cropping or zooming in. Select a Diff City sample PR and check that no credentials or unrelated repository content are visible.

The current gallery was captured on October 26, 2026 from sample PR #3: 20 files and 16,868 changed lines, including migrations, access policies, localization, API contracts, and edited renames. The actual **Claude Code · Fable 5 · High** run produced nine sections. The priority pass and the optional further pass supplied code notes; the first two chapters are marked reviewed. The inline conversation, PR-wide conversation, and an unpublished GitHub draft remain saved in the local app. Nothing was posted to GitHub for these captures.

The guide explicitly reports its coverage limits: ten oversized or omitted hunks remain unassessed, and three files have only binary/metadata changes. Screenshots show the generated output as-is; they do not represent an exhaustive review or an endorsement of the intentionally flawed fixture code.

| Asset              | Native app scene                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `guide-code-notes` | Edited rename with two red/green changes, a connected code note, and reviewed sections in the rail           |
| `guide-overview`   | Generated Mermaid overview, reading path, and personal-account inbox                                         |
| `inline-review`    | Line-anchored question, Claude response, and file minimap                                                    |
| `pr-chat`          | The same conversation in the sidebar, local GitHub draft, copy controls, and code context above the composer |

Before capture, select the personal account and the `diffcity` repository, then enable **Display settings → Hide other account avatars**. This removes unrelated avatars from the actual UI while keeping the selected account visible. The preference alone does not hide inbox content, so keep the repository filter applied. Inspect every full-size image before publishing.

Images in `public/screenshots/` are complete 2880 × 1880 native window screenshots, encoded as WebP without cropping, zooming, redrawing, or changing the app content. Responsive variants scale the whole image proportionally. Keep full-resolution versions for the “View full size” links and generate 1440px and 960px variants for responsive loading. Set the matching source dimensions in `ReviewPreview.astro` to avoid layout shifts.

## Workflow recording

The **Ask in place** tab and the root README include an 18-second, full-window recording from October 27, 2026. It uses public [demo PR #18](https://github.com/crs48/diffcity/pull/18), comparing the same mixed-edit fixture branches as the still gallery. A fresh **Claude Code · Fable 5 · High** guide was generated for this PR and its priority pass completed. The recording shows a real, separate inline conversation with Claude Fable 5; no responses were authored or inserted for the recording.

The sequence selects `api/openapi.yaml` lines 6–8, opens the **+** composer, asks “What should we check before shipping this delete endpoint? Keep it to three review points,” scrolls through Claude’s answer, and opens **Continue in PR chat**. Claude discusses ownership checks, error responses, and deletion semantics, and identifies the code as an intentionally flawed fixture. This is an example of the workflow, not a verified security assessment. No review comments were published to GitHub.

Capture privacy: only the `crs48` account is visible; the repo filter is `diffcity`, the PR list is collapsed, and **Hide other account avatars** is enabled. Every recorded frame was inspected before publishing. The source frames are native 2880 × 1880 window captures at normal zoom. Encoding scales the entire window to 1440 × 940 without cropping, obscuring, or redrawing UI. Pauses and AI waiting time are shortened; scrolling and typing are condensed.

- `public/demos/inline-conversation.gif`: looping README demonstration, approximately 3.2 MB.
- `public/demos/inline-conversation.mp4`: the same sequence with H.264 playback, approximately 380 KB.
- `public/demos/inline-conversation.webp`: a full-window poster showing the answer.

The website uses native video controls, `playsinline`, and `preload="none"`, with no autoplay. Switching gallery tabs pauses the hidden video. The caption describes the silent sequence, and GIF/video download links provide alternatives. Keep the existing still gallery for visitors who prefer a static view. Verify playback, pause-on-tab-change, keyboard navigation, mobile layout, and both themes after changing the media component.
