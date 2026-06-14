---
title: Channels
description: Choose a first-party provider channel for a Flue application.
---

First-party channel packages receive and verify provider HTTP events before
calling your application with typed provider-native data. Read the
[Channels guide](/docs/guide/channels/) first for the shared routing, handler,
ownership, response, identity, retry, and runtime model.

Choose a provider below for its package installation, provider configuration,
event surfaces, and established SDK usage.

| Provider                   | Package                            | Discovered routes                                                                       | Guide                                                                              |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Discord                    | `@flue/discord`                    | `/channels/<file>/interactions`                                                         | [Discord](/docs/ecosystem/channels/discord/)                                       |
| Facebook Messenger         | `@flue/messenger`                  | `/channels/<file>/webhook`                                                              | [Messenger](/docs/ecosystem/channels/messenger/)                                   |
| GitHub                     | `@flue/github`                     | `/channels/<file>/webhook`                                                              | [GitHub](/docs/ecosystem/channels/github/)                                         |
| Google Chat                | `@flue/google-chat`                | `/channels/<file>/interactions`, `/channels/<file>/events`                              | [Google Chat](/docs/ecosystem/channels/google-chat/)                               |
| Intercom                   | `@flue/intercom`                   | `/channels/<file>/webhook` (`HEAD`, `POST`)                                             | [Intercom](/docs/ecosystem/channels/intercom/)                                     |
| Linear                     | `@flue/linear`                     | `/channels/<file>/webhook`                                                              | [Linear](/docs/ecosystem/channels/linear/)                                         |
| Microsoft Teams            | `@flue/teams`                      | `/channels/<file>/activities`                                                           | [Microsoft Teams](/docs/ecosystem/channels/teams/)                                 |
| Notion                     | `@flue/notion`                     | `/channels/<file>/webhook`                                                              | [Notion](/docs/ecosystem/channels/notion/)                                         |
| Resend                     | `@flue/resend`                     | `/channels/<file>/webhook`                                                              | [Resend](/docs/ecosystem/channels/resend/)                                         |
| Salesforce Marketing Cloud | `@flue/salesforce-marketing-cloud` | `/channels/<file>/events`                                                               | [Salesforce Marketing Cloud](/docs/ecosystem/channels/salesforce-marketing-cloud/) |
| Shopify                    | `@flue/shopify`                    | `/channels/<file>/webhook`                                                              | [Shopify](/docs/ecosystem/channels/shopify/)                                       |
| Slack                      | `@flue/slack`                      | `/channels/<file>/events`, `/channels/<file>/interactions`, `/channels/<file>/commands` | [Slack](/docs/ecosystem/channels/slack/)                                           |
| Stripe                     | `@flue/stripe`                     | `/channels/<file>/webhook`                                                              | [Stripe](/docs/ecosystem/channels/stripe/)                                         |
| Telegram                   | `@flue/telegram`                   | `/channels/<file>/webhook`                                                              | [Telegram](/docs/ecosystem/channels/telegram/)                                     |
| Twilio                     | `@flue/twilio`                     | `/channels/<file>/webhook`, `/channels/<file>/status`                                   | [Twilio](/docs/ecosystem/channels/twilio/)                                         |
| WhatsApp                   | `@flue/whatsapp`                   | `/channels/<file>/webhook`                                                              | [WhatsApp](/docs/ecosystem/channels/whatsapp/)                                     |
| Zendesk                    | `@flue/zendesk`                    | `/channels/<file>/webhook`                                                              | [Zendesk](/docs/ecosystem/channels/zendesk/)                                       |

## Add a provider

Pass the provider name to `flue add`:

```sh
flue add slack --print | codex
```

The recipe installs the channel package and an established provider SDK or
narrow Fetch client, then creates an editable `channels/<provider>.ts` module.
The module exports the Flue `channel`, the application-owned `client`, and any
narrow provider tools justified by the application.

For a provider without a first-party package, start from its documentation:

```sh
flue add https://provider.example/webhooks --category channel --print | codex
```

See [Build a custom channel](/docs/guide/build-your-own-channel/) for the
verification, routing, normalization, response, and testing requirements.
