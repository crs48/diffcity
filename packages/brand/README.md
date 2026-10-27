# Diff City color palette

The desktop app and [diff.city](https://diff.city) share the semantic accents in `palette.css`. Both keep neutral black, white, and gray surfaces so the code remains the focus.

Colors come from [GitHub Primer Primitives 11.10.0](https://github.com/primer/primitives), using the light and dark theme `fgColor`, `bgColor`, and primary-button tokens. The upstream MIT license is included in `PRIMER-LICENSE`.

| Color  | Use                                                     |
| ------ | ------------------------------------------------------- |
| Green  | Open PRs, additions, approvals, primary actions         |
| Red    | Deletions, closed PRs, errors, changes requested        |
| Purple | Merged PRs, guide accents, collapsed code context       |
| Blue   | Links, keyboard focus, selections, informational states |
| Amber  | Attention, warnings, pending checks                     |
| Gray   | Drafts and inactive states                              |

The skyline uses red, green, and purple bars. Color supplements icons and labels; it never supplies the only indication of state. Primary buttons use white text on a solid green, distinct from green text on a muted green surface. Dark-mode buttons retain Primer's darker light-theme hover/active colors to keep small white labels above a 4.5:1 contrast ratio.

The website's static favicon and social-card SVG use these same colors explicitly, because they render outside the page's CSS. `social.png` is rendered from `apps/site/public/social.svg` at 1200 × 630. App screenshots are real captures and should not be recolored or cropped to simulate this palette.
