# HealthDrop Design Spec

Scoring complete. I read `lib/ThemeContext.tsx` and `components/dashboards/DashboardShared.tsx` to ground the verdict — the spec below maps 1:1 onto the existing `Theme` interface keys (values changed, tokens added, nothing renamed) and onto `ROLE_ACCENT` (kept) / `ROLE_GRADIENTS` (deleted).

## Scoring & Verdict

| Criterion | Prakash | Vital | VIGIL |
|---|---|---|---|
| Rural low-end Android fit | 10 | 7 | 8 |
| Admin dashboard density | 6 | 8 | 10 |
| RN StyleSheet implementability | 9 | 8 | 9 |
| Dark-mode quality | 8 | 9 | 9 |
| Distinctiveness | 8 | 7 | 9 |
| **Total** | **41** | **39** | **45** |

**Winner: Prakash**, despite VIGIL's higher raw total. The axes are not equally weighted: the primary persona is an ASHA worker on a low-end phone in sunlight, and Prakash is the only direction that never compromises that user (VIGIL's 10–11px micro type and 48px dense rows do). Prakash's one real weakness — admin density — is exactly what VIGIL is best at, and VIGIL's discipline grafts cleanly onto Prakash because both share the same chassis (flat opaque surfaces, border-first depth, system fonts, color-as-meaning). **Grafted from VIGIL:** tabular-nums discipline everywhere, eyebrow-and-count section headers, flat data-table rows for admin screens, the quiet zero, as-of timestamps, monochrome chart rules, severity/water tokens. **Grafted from Vital:** indigo-means-AI accent, the four-state data-region contract, reduce-motion via ThemeContext, `maxFontSizeMultiplier`, scroll-to-first-error, sync-ribbon "All synced" flash.

---

# HealthDrop Unified Design Spec — "Prakash" (v1, final)

## Design Language

Prakash ("light") treats HealthDrop as public infrastructure, not a startup dashboard. The primary user is an ASHA worker holding a low-end Android phone in direct sunlight, so every decision optimizes for instant legibility, one-thumb operation, and honest system state. Light mode is the field mode: ink-dark text on paper-white cards with visible 1px borders, styled like a well-printed government immunization card. Hierarchy comes from size and weight, never from faint grays. Color is reserved for meaning — status, severity, water quality, role, AI — never decoration: all gradients, glass blur, and decorative blobs are deleted, both for calm and for GPU cost. The screen is monochrome at rest; when red or amber appears, it is real. One deep institutional blue is the brand, a warm saffron is the accent, and indigo appears exclusively on AI-generated content.

The system never lies about state. Every data region has exactly four states: skeleton (loading), content, empty ("quiet zero" in words), and error-with-retry — blank zeros and silent `catch {}` are design bugs. Offline is a visible, reassuring first-class mode, not an error. Every number that represents data uses tabular numerals in ink, so the app reads like an instrument. Everything below is plain React Native `StyleSheet` and flows through the existing `ThemeContext` tokens (keys kept, values changed, new tokens added), so screens migrate one at a time and a half-migrated app still looks coherent.

## Color Tokens

All surfaces are opaque solids (no rgba stacking except `overlay`). Components must read every color from `useTheme()` — zero hex literals in component files.

| Token | Light | Dark |
|---|---|---|
| background | `#EEF2F6` | `#0B1219` |
| surface | `#F8FAFC` | `#111A24` |
| surfaceVariant | `#E3EAF1` | `#1B2733` |
| card | `#FFFFFF` | `#16212E` |
| cardHover | `#F1F5F9` | `#1D2938` |
| text | `#0C1D2E` | `#F2F7FB` |
| textSecondary | `#3D5568` | `#A7B8C7` |
| textTertiary | `#64788A` | `#7C8FA0` |
| textInverse | `#FFFFFF` | `#0C1D2E` |
| primary | `#0B5FA5` | `#53A6E3` |
| primaryLight | `#D8E9F7` | `#123A5C` |
| primaryDark | `#083D6E` | `#3584C8` |
| onPrimary | `#FFFFFF` | `#06263F` |
| accent (saffron) | `#C2410C` | `#FB923C` |
| success | `#15803D` | `#4ADE80` |
| successBg | `#DCF2E3` | `#123324` |
| warning | `#B45309` | `#FBBF24` |
| warningBg | `#FDEED6` | `#3A2C0D` |
| danger / error | `#B91C1C` | `#F87171` |
| dangerBg | `#FBE2E2` | `#3D1717` |
| info | `#0369A1` | `#4FC3F7` |
| infoBg | `#DDF0FA` | `#0E2E40` |
| ai (new) | `#4F46E5` | `#818CF8` |
| aiBg (new) | `#E7E8FB` | `#232A4E` |
| border | `#C3CFDA` | `#2B3B4B` |
| borderLight | `#D8E1E9` | `#22303D` |
| borderDark | `#8CA0B0` | `#3E5163` |
| headerBg (new) | `#083D6E` | `#111A24` |
| inputBackground | `#FFFFFF` | `#111A24` |
| inputBorder | `#64788A` | `#4E6478` |
| inputFocusBorder | `#0B5FA5` | `#53A6E3` |
| inputErrorBorder | `#B91C1C` | `#F87171` |
| skeleton (new) | `#E3EAF1` | `#1B2733` |
| skeletonHighlight (new) | `#F2F6FA` | `#263442` |
| offline (new) | `#C2410C` | `#FB923C` |
| offlineBg (new) | `#FDE8D8` | `#3B2312` |
| severityCritical | `#B91C1C` | `#F87171` |
| severityHigh | `#C2410C` | `#FB923C` |
| severityMedium | `#B45309` | `#FBBF24` |
| severityLow | `#15803D` | `#4ADE80` |
| waterSafe | `#15803D` | `#4ADE80` |
| waterModerate | `#B45309` | `#FBBF24` |
| waterUnsafe | `#B91C1C` | `#F87171` |
| waterCritical | `#7F1D1D` | `#FCA5A5` |
| chartLine | `#0B5FA5` | `#53A6E3` |
| chartGrid | `#E3EAF1` | `#1E2732` |
| overlay | `rgba(12,29,46,0.50)` | `rgba(0,0,0,0.60)` |
| disabled | `#8CA0B0` | `#4E6478` |

Role identity: keep the existing `ROLE_ACCENT` map values as-is; delete `ROLE_GRADIENTS` entirely. The role accent may appear in exactly two places per screen: the 4px Role Ribbon under the header and the avatar/badge ring.

## Typography Scale

System fonts only (Roboto/SF/system-ui). No font libraries. Hierarchy from size + weight, never from faint color.

| Style | Size/LineHeight | Weight | Notes |
|---|---|---|---|
| Display | 32/38 | 800 | Hero stat numerals only; `fontVariant: ['tabular-nums']`, `maxFontSizeMultiplier: 1.3`, Android `includeFontPadding: false` |
| Stat | 24/28 | 800 | Compact admin stat grids; tabular-nums, letterSpacing −0.5 |
| Title | 22/28 | 800 | Screen titles; letterSpacing −0.4 |
| Section | 16/22 | 700 | Card titles, section headings |
| Body | 15/22 | 500 | Descriptions, list content — body copy never below 15 |
| Label | 13/18 | 700 | Form labels, list subtitles, metadata |
| Eyebrow | 12/16 | 700 | UPPERCASE, letterSpacing 0.6 — section wayfinding, form-section labels, pill text |
| Caption | 12/16 | 600 | Timestamps, meta |

Hard rules: no text below 12px anywhere. Uppercase + letterspacing is only for Eyebrow/pills, never sentences. Every data numeral (counts, cases, deltas, timestamps in tables) gets `fontVariant: ['tabular-nums']`. Data values render in `colors.text` — never in category colors; only deltas, severity words, and status words take semantic color. Secondary info drops to `textSecondary` at 13–15px; it never shrinks to 10–11px. Never set `allowFontScaling={false}`; layouts must tolerate 1.3x OS font scale (use `minHeight` not `height`, `flexWrap`, generous `numberOfLines`).

## Spacing & Shape

- **Grid:** strict 4pt. Add to theme: `spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }`.
- **Layout:** screen gutter 16 (always — retire 13/14/20 drift); gap between cards in a list 12; gap between sections 24; card padding 16 (dense admin tiles 12); pill padding 10×6.
- **Radii:** add `radii = { sm: 8, md: 12, lg: 16, pill: 999 }`. Inputs, buttons, and cards 12; bottom sheets/modals 16 (top corners); pills/chips 999; skeleton blocks 8. One radius per component class — no 8/10/11/13/14 drift.
- **Touch:** every tappable surface ≥48×48dp (`hitSlop` where visually smaller); primary action buttons 56dp tall, full-width in the gutter; field list rows `minHeight: 64`; admin data-table rows may compress to `minHeight: 56` with hitSlop; selection chips `minHeight: 44`.
- **Depth:** border-first. 1px `colors.border` on every card in BOTH modes. Light mode may add one shadow recipe only: opacity 0.06, radius 8, offset (0,2), elevation 2. Dark mode: zero shadows — elevation is the surface ladder background → surface → card → cardHover.
- **Density:** max two stat cards per row on phones — never three. On web/tablet ≥768dp width, stat grids may go up to four across. One input per row in forms, always.

## Component Rules

1. **Token discipline.** Components contain no hex literals — every color from `useTheme()`. Severity and water-quality colors resolve only through `getSeverityColor()` / `getWaterQualityColor()` reading the tokens above. Migrate hardcoded `'#fff'` / `'#DC2626'` / `urgencyColor()` maps to tokens in any file you touch.
2. **Cards.** `backgroundColor: colors.card`, radius 12, padding 16, 1px `colors.border` in both modes; light-mode shadow per the single recipe; dark mode no shadow. Delete all `LinearGradient` card fills, `useGlassStyle`/`backdropFilter`, and hardcoded rgba card backgrounds in `DashboardShared.tsx`.
3. **Headers.** Replace 3-stop role gradients and decorative blobs with a flat `colors.headerBg` band (dark mode adds a 1px bottom `colors.border`), white/`colors.text` header text ≥15px, plus the Role Ribbon: a 4px strip in `ROLE_ACCENT[role]` along the header's bottom edge. Keep the role pill (Eyebrow type). Header entrance: one 200ms fade max.
4. **Stat cards.** Two variants, same anatomy: value in tabular-nums **ink** (`colors.text`) — 32/800 Display on field dashboards, 24/800 Stat in admin grids — over a 13/700 label in `textSecondary`, with a 3px top rule in the metric's semantic color (the only color on the card). Optional delta caption: arrow + numeral (`▲ 3 this wk`) where only the delta takes success/danger. No icon squircle required; if an icon is used, 24dp tinted `color + '14'` in a 44dp radius-12 container. No colored values, no spring scale-in.
5. **Section headers.** Eyebrow-and-count: `ACTIVE ALERTS · 4` — 12px Eyebrow in `textSecondary` with right-aligned tabular count; optional action link in `primary` (light: `primaryDark`), hitSlop to 48dp.
6. **Buttons.** Primary: 56dp tall, radius 12, `colors.primary` fill, `colors.onPrimary` 16/700 label, full-width in gutter; pressed = `colors.primaryDark` fill via a `Pressable` style function (background change, never opacity fade or scale bounce). Secondary: transparent, 1.5px `colors.inputBorder`, `colors.text` label. Destructive: danger fill, reserved for irreversible actions. Disabled: 40% opacity on the whole button. Every button has a text label — never icon-only for primary actions.
7. **Forms.** One field per row. Inputs 52dp, radius 12, `inputBackground` fill, 1.5px `inputBorder`; label ABOVE the field, 13/700 uppercase `textSecondary`; 16px between fields, 24px between sections with an Eyebrow section label. Focus = 2px `inputFocusBorder`, no glow. Error = 2px `inputErrorBorder` + inline 13px danger message with alert icon under the field; submit scrolls to the first error. `Alert.alert()` for field validation is banned. Primary submit is the One-Hand Action Bar: 56dp full-width button docked at the bottom above the safe area, Cancel as a plain text link beside/above it.
8. **Selection chips** (disease, severity, gender): `minHeight: 44`, radius 999, 16px horizontal padding. Unselected = `card` fill + 1.5px `border` + `text` label. Selected = SOLID semantic/primary fill + `onPrimary`/white label + checkmark icon — selection is never conveyed by tint alone (tints vanish in sunlight).
9. **Status/severity pills.** Dot + UPPERCASE 12/800 label on the matching `*Bg` token, text in the matching status color, radius 999, padding 10×6. Never color alone, never a bare dot. Solid-filled pill (danger fill, white text) is reserved exclusively for CRITICAL. Never flood-fill a whole card or modal header with a status color — the AlertCard modal header becomes card-colored with a severity pill and a 3px top rule.
10. **Alert cards.** Open with the bold plain-language directive first ("Boil water before drinking"), Body 15/700 in `text`; metadata below at 13 in `textSecondary`; 3px left edge in the severity token is the only structural color; timestamp always visible, absolute-short (`14 Jul 09:32`), tabular.
11. **Lists and tables.** Field lists (rows a thumb taps): `minHeight: 64`, chevron 20dp `textTertiary`, 1px `border` divider inset 16. Admin data screens (Reports, Approval Queue, User Management) with >6 items: flat rows on `colors.surface` with `StyleSheet.hairlineWidth` dividers instead of card-per-row stacks; numeric columns right-aligned tabular-nums; sticky Eyebrow column-header row on `surfaceVariant`.
12. **Loading.** Every data region renders a skeleton twin: `colors.skeleton` blocks, radius 8, shaped like the real content (two stat rectangles, three list rows), one shared `Animated.loop` opacity pulse 0.5→1.0, ~1000ms, `useNativeDriver: true`, stopped on unmount and when data arrives. Skeletons are `accessibilityElementsHidden`. Blank zeros while loading are forbidden.
13. **Errors.** A failed fetch renders an inline ErrorCard in place of the data: `dangerBg` fill, 1px danger border, icon + one plain-language sentence ("Couldn't load — check connection") + a 48dp Retry button. Silent catch-and-show-zero is forbidden. Error ≠ empty.
14. **Empty states — the quiet zero.** Words plus a small check glyph in success ink on plain surface: "District clear — no active alerts since 14 Jul." Icon + one sentence + optional one action button; total height under 240px.
15. **Offline/sync — the Sync Pebble.** A persistent chip in the header right: green dot "Synced", amber "Saving…", `offline`/`offlineBg` "Offline · 3 queued"; flips to `successBg` "All synced" for 1.5s after a sync completes, then returns to quiet state. Offline form submissions confirm with "Saved on phone — will sync", never an error. Data sections carry an as-of Caption timestamp when stale. The Pebble uses `accessibilityLiveRegion="polite"`.
16. **Icons.** Ionicons only — remove MaterialCommunityIcons/FontAwesome5 mixing. Outline variants at rest, filled only for active tab/selected state. Functional icons 24dp (in a 44dp container where tappable), metadata icons 16dp, default tint `textSecondary`; semantic color only when the icon itself conveys status. Decorative icon use is banned — every icon maps to a noun or action. Icon-only touchables get `accessibilityLabel` + `accessibilityRole="button"`.
17. **Motion.** Maximum one entrance animation per screen: a single 200ms opacity fade (optionally +6px translateY) on the scroll content. No per-card springs, staggers, or scale-ins. Press feedback = background-color change. All animation `useNativeDriver: true`. Read `AccessibilityInfo.isReduceMotionEnabled` once at app start, expose `reduceMotion` on ThemeContext, and collapse all animation (including skeleton pulse) to static when true.
18. **Indigo = intelligence.** The `ai`/`aiBg` tokens are reserved exclusively for AI features: the AIChatbot launcher, AIInsightsPanel cards (3px `ai` left tick + an "AI" Eyebrow micro-badge on `aiBg`), and AI-generated summaries. Nothing else may use indigo, so users learn in one session that indigo means "the system inferred this."
19. **Charts and map.** One ink series (`chartLine`), hairline `chartGrid`, no area-gradient fills; label min/max/latest as 12px tabular text directly on the chart. Map severity markers use severity tokens with a text count badge, never color alone. Empty chart = quiet-zero message, not an empty axis.
20. **Accessibility contract.** Body text ≥7:1 on its surface, secondary ≥4.5:1, status text on its `*Bg` ≥4.5:1, interactive outlines ≥3:1. Dark-mode primary fills use dark ink `onPrimary` (`#06263F`), never white-on-light-blue. Warning amber always pairs with an icon (weakest hue in sunlight). Stat cards expose combined `accessibilityLabel` ("Disease reports: 42, up 3 this week"); pills read "Urgency: critical", not "CRITICAL".
21. **Migration rule.** First change: update ThemeContext values and add new tokens (`ai`, `aiBg`, `headerBg`, `skeleton`, `skeletonHighlight`, `offline`, `offlineBg`, `spacing`, `radii`) — keys never renamed. Then migrate one screen per edit. A migrated screen must not import legacy style constants or contain hex literals. Migrated and legacy screens must remain coherent side by side.

## Signature Moves

- **The Role Ribbon:** a single 4px accent strip under every flat navy header — the one surviving trace of the role gradients. Tells a district officer's phone from an ASHA worker's at a glance, at zero GPU cost.
- **Big Number Protocol:** stat values in 32px (field) / 24px (admin) w800 tabular ink over a 13px label with a 3px semantic top rule — readable at arm's length through sun glare. Two per row on phones.
- **The Sync Pebble:** the always-present header chip (Synced / Saving… / Offline · n queued) with as-of timestamps on stale sections. Honest system state is the brand's trust signal.
- **One-Hand Action Bar:** every form and detail screen docks its 56dp primary action at the bottom for thumbs on 5-inch phones held one-handed.
- **Status Is a Sentence:** alert cards lead with the plain-language directive a health worker relays out loud; taxonomy comes second.
- **The Quiet Zero:** empty and healthy states are written in words with a success check — absence of data becomes information.
- **Indigo = Intelligence:** one accent, one meaning — the system inferred this.
- **Ink on Paper:** light mode styled like a well-printed government form — pure white cards, near-black ink, visible rules; the highest-contrast surface possible under direct sunlight.

## Do Not

- No gradients anywhere (headers, cards, buttons, chart fills). No `backdropFilter`/glass. No decorative blobs. Delete `ROLE_GRADIENTS` and `useGlassStyle`.
- No hex literals in components; no rgba surface stacking (opaque tokens only; `overlay` is the sole exception).
- No blank zeros while loading or on failure; no silent `catch {}`; no spinner where a skeleton fits; no conflating empty with error.
- No `Alert.alert()` for form validation; no transient toasts for errors or offline state.
- No text below 12px; no body copy below 15px; no 10–11px metadata; no `allowFontScaling={false}`; no lowercase letterspaced text.
- No meaning carried by color alone — every severity, water state, selection, and sync state carries a label and/or icon; no bare colored dots.
- No colored stat values, no rainbow stat grids, no per-role wallpaper beyond the Ribbon and avatar ring.
- No shadows in dark mode; no pure `#000` background or pure-white large surfaces in dark mode; no white text on light-blue fills in dark mode.
- No spring scale-ins, staggered card entrances, infinite decorative animation, or opacity-fade press states; no animation without `useNativeDriver`; nothing animates when reduce-motion is on.
- No three-up stat rows or two-up form fields on phones; no touch targets under 48dp; no icon-only primary actions.
- No mixed icon families per screen; no decorative icons.
- No flood-filling cards, headers, or modal strips with saturated status color; solid fill is CRITICAL's privilege alone.
- No new fonts, no new UI libraries, no radius/spacing values outside `radii`/`spacing`.
