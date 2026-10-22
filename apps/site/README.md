# Diff City website

A static, one-page Astro + Tailwind CSS site for [diff.city](https://diff.city). The page uses local fonts, a keyboard-accessible gallery of real app screenshots, light/dark themes, and no analytics, cookies, or backend. Theme preference is saved in local storage. The screenshots are captured from the installed macOS app reviewing sample PRs in `crs48/diffcity`, with actual Claude Code guides and responses. Only the Diff City test corpus is shown; unrelated repositories and account navigation are cropped out.

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

The default page says **private alpha** and **public download coming soon**. It deliberately does not send visitors to a nonexistent release or expose a local/ad-hoc-signed development build.

Once a distributable macOS build is publicly available, set the repository Actions variable `PUBLIC_MACOS_DOWNLOAD_URL` to its public HTTPS download URL and rerun the website workflow. This enables the download button. A release asset in a private repository is not a public download; make sure an unauthenticated visitor can fetch the configured URL. Installation/signing instructions belong in the accompanying release notes.

The planned public source repository is `https://github.com/crs48/diffcity`. Update the private-alpha copy when the repository opens. Publishing this site does not change the repository's visibility.

## GitHub Pages

The `Publish Diff City website` workflow validates website changes and uploads only the static `dist` directory. Production deployment uses the branch in the `SITE_DEPLOY_BRANCH` repository variable, falling back to `main`. The initial deployment uses `feat/review-history-localization-migrations` while the app is developed privately. After merging into `main`, remove that variable (or set it to `main`) and remove the development branch from the `github-pages` environment's allowed branches.

In repository **Settings → Pages**, the build source must be **GitHub Actions**. Allow the chosen production branch in the `github-pages` environment's deployment branch policy. Pull requests and other branches build without deploying. No personal access token is stored in the workflow; GitHub's short-lived deployment token is used.

`astro.config.mjs`, canonical metadata, the sitemap, and `public/CNAME` use `https://diff.city`. Set the Pages custom domain to `diff.city` and point the domain's DNS at GitHub Pages following [GitHub's custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site). Enable **Enforce HTTPS** once GitHub has issued the certificate. GitHub Pages for a private source repository requires an eligible GitHub plan; the generated website is public.

## Editing

- `src/pages/index.astro`: page content, metadata, theme toggle.
- `src/components/ReviewPreview.astro`: keyboard-accessible screenshot tabs, captions, and source PR links.
- `src/styles/global.css`: Tailwind entry point, theme tokens, responsive styles.
- `src/config.ts`: repository and validated optional download URL.
- `public/`: domain, favicon, social image, robots file, and sitemap.

Run `pnpm --filter @diffcity/site format` to format this package. Verify the built page at desktop and phone widths, all three workflow tabs, keyboard navigation, and both themes before deploying visual changes.

## Refreshing screenshots

Generate a guide inside the installed Diff City app using a sample PR from this repository. Capture the real overview, guided diff, or inline conversation through the native app. Keep the PR and model attribution accurate, and inspect each capture before publishing. Screenshots must not include another repository, credentials, or unrelated account information.

The current gallery uses PR #1 (invitation review, Claude Fable 5.1) and PR #9 (schema backfill guide, Claude Fable 5.1; inline reply, Claude Fable 5). The sample PRs deliberately contain test-only code. The guides and private conversation remain saved in the local app.

Images in `public/screenshots/` are crops of native screenshots, resized and encoded as WebP without redrawing or changing the app content. Keep full-resolution versions for the “View full size” links and generate 1440px and 960px variants for responsive loading. Set the matching source dimensions in `ReviewPreview.astro` to avoid layout shifts.
