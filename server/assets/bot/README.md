# Bot banners

`welcome`, `profile`, `downloads`, `info`, `beta-pending`, `beta-approved`, `now`, and `error` are sent as PNG photos. Cabinet buttons edit the existing photo and caption.

The five cabinet/beta assets use the editable `src/cabinet-banner.html` template and the project's existing fonts and artwork. To regenerate them:

```sh
node scripts/renderBotBanners.mjs
```

Rendering requires Chrome/Chromium (`CHROME_PATH` can override its executable). Production uses the committed PNGs and needs no browser. Docker copies this directory into the runtime image. `OSKOLOK_BOT_ASSETS` can override the asset directory.

Approval notifications are created by the admin beta registry, delivered to a verified Telegram ID, and deduplicated in `BetaAccess`. Private bot contacts are remembered before access is granted. If no contact is known, approval stays pending until the user opens the bot. Existing active invitations do not trigger retrospective notifications.
