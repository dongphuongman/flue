# `@flue/linear`

Verified Linear webhook ingress for Flue applications.

```ts
import { createLinearChannel } from '@flue/linear';

export const channel = createLinearChannel({
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,

  // Path: /channels/linear/webhook
  async webhook({ event }) {
    await handleLinearEvent(event);
  },
});
```

Place this export in `channels/linear.ts`. Flue discovers it and serves
`POST /channels/linear/webhook` relative to the `flue()` mount.

The package verifies the exact request bytes with HMAC-SHA256, rejects webhook
timestamps outside Linear's recommended one-minute window, optionally checks
fixed organization and webhook ids, and normalizes comments, issues, projects,
and agent-session events. Other verified deliveries remain available as
explicit unknown events.

This package does not include an outbound Linear client, OAuth installation
storage, or model tools. Run `flue add linear` to generate editable project
code using the official `@linear/sdk` client.

Conversation keys identify issues, nested issue-comment threads, and agent
sessions. They are not authorization capabilities. The package is stateless
and does not deduplicate `Linear-Delivery` ids.
