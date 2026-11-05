# Taste and direction

## Direction

One block per target, written by the grill.

### Kit builder (`/`, all four steps)

- **Goal:** Building a kit should stop feeling messy. Someone can move from choosing appliances to a downloadable kit without losing their place, hunting for a control or wading through detail they did not ask for. The owner did not list the weak points and asked reviewers to find them by walking the flow in a real browser.
- **Direction:** Same look, calmer and cleaner, with fewer competing elements per screen (picked).
- **Keep:** The blue accent, Bricolage Grotesque and Figtree, the step-by-step flow, the side rail, and the engine's figures and safety wording (picked).
- **Avoid:** A redesign; a dark mode (the app has none); side-scrolling chip rows; a combobox where a short grouped select does the job; additions above the parts list on the printed spec sheet.
- **Users:** Homeowners sizing one backup kit, often on a phone, and repeat users comparing projects (picked).
- **Reference:** None.

## Taste rules

| id | Rule |
|---|---|
| T1 | **Stay in the visual world.** Tokens, fonts, radii and shared components stay unless Direction names them. Refinement, not redesign. |
| T2 | **The primary task leads.** The first thing the eye lands on is what the visitor came for: the key figure, the main action, the content. |
| T3 | **One color per meaning, from tokens.** Two shades for one meaning is a bug, and so is a raw value next to a token. Color marks meaning, not decoration. |
| T4 | **One spacing scale, one type scale.** Every gap and size comes from the repo's scale. Related things sit closer than unrelated things. |
| T5 | **Aligned edges.** Content reads along a left edge. Labels, figures and actions line up across rows and sections. |
| T6 | **Both themes are real.** Dark mode gets the same hierarchy and contrast as light. Nothing disappears, glows or turns muddy. |
| T7 | **Both widths are real.** At 390 nothing clips, scrolls sideways or shrinks below a 24px tap target. Tables scroll or collapse inside themselves. |
| T8 | **Cut before you add.** Remove duplicate actions, redundant copy and decorative chrome before adding a section, a color or an animation. |
| T9 | **Honest copy.** Labels say what things do. Errors say what failed and how to fix it. Claims match the product. |
| T10 | **Reuse, then extend.** Use the repo's shared components and extend them by prop. A one-off copy is a problem even when it looks good. |

## Slop tells

Check every screenshot for these. Each hit is a problem citing the tell and the rule it breaks.

- **S1** A grid of equal tiles, each with an icon on top, a bold title and two lines of filler. (T2, T8)
- **S2** Gradient text, glow, shimmer or pulse rings used as decoration. (T3)
- **S3** Icon-in-a-tile section headers, or emoji as icons. (T8)
- **S4** Pastel washes, tinted banners and badges on everything. (T3, T8)
- **S5** Everything centered, with no edge to read along. (T5)
- **S6** Decorative backgrounds (blobs, mesh gradients) competing with the task. (T2)
- **S7** Fake-precise stats or unverifiable claims. (T9)
- **S8** Oversized padding and type on a working app page. (T4)
- **S9** Repeated chrome: two headers, a card inside a card, two CTAs saying the same thing. (T8)
- **S10** Dark mode as inverted light mode: pure-black surfaces, unreadable gray text, colors that lose meaning. (T6)

## When the brief is open-ended

For "make it better", "less AI slop" or "cleaner":

1. **Name the page type** (marketing, app or dashboard, settings, content) and write the visitor's job in one sentence.
2. **Check the slop tells** against every shot, in both themes and at both widths.
3. **Rank by what blocks the job.** Anything that pushes the task below the fold, or breaks a theme or a width, is P1. Off-taste chrome is P2. Polish is P3.
4. **Prefer cutting over adding** (T8). A problem that adds something must say which job it serves.
