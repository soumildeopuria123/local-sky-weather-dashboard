# Themes and sign-in extras

## Dashboard themes

The dashboard starts in the device's preferred theme when no choice has been
saved. The sun/moon control switches between night and day palettes and stores
the choice in `localStorage` under `localSkyTheme`.

- `night` — the original dark sky palette and `world-map.svg`.
- `day` — the warm light palette and `world-map-light.svg`.

The light theme is scoped with `html[data-theme="light"]`; the default theme is
dark.

## Sign-in page

- Password visibility buttons work on sign-in, new-password and confirm-password
  fields.
- The create-account form shows a four-step strength meter.
- Password fields show a Caps Lock warning while Caps Lock is active.
- "Remember my email" stores the email address only, under
  `localSkyRememberedEmail`. Unchecking it removes the saved value.
