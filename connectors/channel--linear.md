---
{
  "category": "channel",
  "website": "https://linear.app/developers"
}
---

# Add a Linear Channel to Flue

You are an AI coding agent adding verified Linear resource and agent-session
webhooks with project-owned outbound Linear API access to a Flue project.

## Inspect the project

Read local instructions, detect the package manager and target, and select the
first existing source root: `<root>/.flue/`, then `<root>/src/`, then
`<root>/`. Inspect existing agents, environment types, secret conventions, and
whether the application needs ordinary issue comments, Linear agent sessions,
or both.

Install `@flue/linear` and `@linear/sdk@^86.0.0`. Flue owns verified ingress.
The project owns the official SDK client and every outbound tool.

The current official SDK is used by Linear's own Cloudflare Workers agent
example with `nodejs_compat`. Flue's Cloudflare target supplies that
compatibility flag. Keep a workerd fake-transport test for every SDK operation
the project relies on.

## Create the channel

Create `<source-dir>/channels/linear.ts`. Adapt the imported agent, dispatched
input, event policy, and tool:

```ts
import { createLinearChannel, type LinearConversationRef } from '@flue/linear';
import { defineTool, dispatch } from '@flue/runtime';
import { LinearClient } from '@linear/sdk';
import assistant from '../agents/assistant.ts';

const organizationId = process.env.LINEAR_ORGANIZATION_ID;
const webhookId = process.env.LINEAR_WEBHOOK_ID;

export const client = new LinearClient({
  apiKey: process.env.LINEAR_API_KEY!,
});

export const channel = createLinearChannel({
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  ...(organizationId ? { organizationId } : {}),
  ...(webhookId ? { webhookId } : {}),

  // Path: /channels/linear/webhook
  async webhook({ event }) {
    switch (event.type) {
      case 'comment': {
        if (event.action !== 'create' || !event.conversation) return;
        await dispatch(assistant, {
          id: channel.conversationKey(event.conversation),
          input: {
            type: 'linear.comment.created',
            deliveryId: event.deliveryId,
            actor: event.actor,
            comment: event.payload,
          },
        });
        return;
      }
      case 'agent_session': {
        await dispatch(assistant, {
          id: channel.conversationKey(event.conversation),
          input: {
            type: `linear.agent_session.${event.action}`,
            deliveryId: event.deliveryId,
            promptContext: event.payload.promptContext,
            activity: event.payload.activity,
            session: event.payload.session,
          },
        });
        return;
      }
      default:
        return;
    }
  },
});

export function postMessage(ref: LinearConversationRef) {
  return defineTool({
    name: 'post_linear_message',
    description: 'Post a message to the Linear conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1 } },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      if (ref.type === 'agent-session') {
        const result = await client.createAgentActivity({
          agentSessionId: ref.agentSessionId,
          content: { type: 'response', body: text },
        });
        return JSON.stringify({ success: result.success });
      }

      const result = await client.createComment({
        issueId: ref.issueId,
        ...(ref.threadCommentId ? { parentId: ref.threadCommentId } : {}),
        body: text,
      });
      return JSON.stringify({ success: result.success, commentId: result.commentId });
    },
  });
}
```

Use `accessToken` instead of `apiKey` when an installed OAuth application owns
the client. Do not implement token storage, refresh, or organization-to-token
resolution unless the project already owns that installation system.

The optional organization and webhook ids pin one endpoint to a fixed
integration. Omit them only when the application intentionally accepts every
organization or webhook authorized by the signing secret.

## Wire the agent

```ts
import { createAgent } from '@flue/runtime';
import { channel, postMessage } from '../channels/linear.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [postMessage(channel.parseConversationKey(id))],
}));
```

The channel-agent import cycle is supported because imported bindings are read
inside deferred callbacks and initializers.

## Configure ordinary webhooks

Create a Linear webhook with:

```txt
https://example.com/channels/linear/webhook
```

Copy its signing secret into `LINEAR_WEBHOOK_SECRET`. Select only the resource
families the application handles, typically Comments, Issues, and Projects.

Linear signs the exact raw body with HMAC-SHA256 in `Linear-Signature`.
`@flue/linear` also enforces the signed `webhookTimestamp` within one minute.
Do not put a body parser or JSON reserialization step in front of the route.

Linear retries deliveries that do not return `200` within five seconds. The
channel's application deadline defaults to 4.5 seconds. Returning nothing
produces an empty `200`; a JSON-compatible value becomes the response body;
return a normal Hono or Fetch `Response` for explicit status control.

The `Linear-Delivery` header is exposed for application-owned deduplication but
is not part of the signed body. Claim it in durable storage before dispatch
when duplicate admission is unacceptable.

## Configure agent sessions

Agent-session events require a Linear OAuth application configured as an app
actor. Enable the Agent session events webhook category and install the
application with the permissions required by its intended operations,
including `app:mentionable` when users should mention it.

`created` events include the session and may include Linear's formatted
`promptContext`, previous comments, and guidance. `prompted` events include the
new user activity. Linear requires the webhook response within five seconds
and expects a newly created session to receive an activity or external URL
update within ten seconds.

The route waits for the application handler by design. Keep dispatch admission
short. Perform the continuing agent work after durable dispatch and post
progress through `client.createAgentActivity(...)`.

## Test without Linear

Create original synthetic JSON values from Linear's current webhook schema.
Sign the exact bytes locally and cover:

- valid and invalid HMAC signatures;
- stale and future `webhookTimestamp` values;
- fixed organization and webhook id mismatches;
- comment, issue, project, `created`, and `prompted` normalization;
- unsupported verified resource types;
- issue-thread and agent-session conversation keys;
- handler responses, failures, and the 4.5-second maximum;
- SDK comment and agent-activity GraphQL requests against an injected fake
  Fetch transport in workerd with `nodejs_compat`;
- Node and Cloudflare project builds.

Do not contact Linear or copy third-party fixtures.
