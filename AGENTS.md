# Rules for coding agents

Read this before changing UI code. CI enforces it. If CI blocks you, the
message names the canonical replacement. Use it; don't work around the rule.

1. **Compose, don't recreate.** Feature code (`apps/**`) builds UI from
   `@pi/design-system`. No native `<button>/<input>/<select>/<textarea>/<dialog>`,
   no ARIA widget roles, no `as="button"`, no `styled(...)` or `createElement` of
   those elements, no styling or headless-UI libraries.
2. **Need a primitive that doesn't exist?** Stop and say so in the PR or task.
   Don't build a local substitute. New exports from the design system need the
   design-system owner's approval, and the API report (`pnpm api:update`) must be
   committed with them.
3. **No raw design values.** Use `tokens` from `@pi/design-system`.
4. **Don't add suppressions.** Every `eslint-disable`, inline config comment,
   bulk suppression and a11y `todo`/`off` is counted. A PR that raises the count
   fails. Budgets in `governance/budget.json` can only be raised in a separate PR
   that changes nothing else, and that PR needs an owner's approval.
5. **If you remove debt, lower the budget in the same PR.**
6. **Don't edit enforcement files** (`.github/`, `governance/`, `eslint.config.js`,
   `CODEOWNERS`, `package.json`, lockfile, `api-extractor.json`, `.storybook/`)
   unless the task is explicitly about them. Your edits there don't take effect
   on your own PR anyway: the judge uses the base branch's copies.
7. **Accessibility:** every story is tested with axe and must pass. Use
   `aria-labelledby`, `aria-describedby` and `htmlFor` freely. They're correct
   composition.

8. **Match the Figma frame.** Screens listed in `governance/visual/scenes.json`
   are rendered and diffed against their Figma reference (`governance/visual`).
   If it fails, fix the screen, using the `visual-diff` artifact. Never replace a
   reference with a render of your own code; references come only from Figma
   (`pnpm visual:fetch`) in a separate PR. See `governance/VISUAL.md`.

Before pushing: `pnpm lint && pnpm typecheck && pnpm api:check && pnpm test:governance && pnpm visual`.
