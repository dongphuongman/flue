import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
	createLinearChannel,
	InvalidLinearConversationKeyError,
	InvalidLinearInputError,
	type LinearChannel,
} from '../src/index.ts';

const encoder = new TextEncoder();

describe('createLinearChannel()', () => {
	it('normalizes a signed top-level comment as an issue conversation', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({
			webhookSecret: 'linear-secret',
			organizationId: 'org-sunrise',
			webhookId: 'hook-copper',
			webhook,
		});
		const raw = {
			action: 'create',
			actor: {
				id: 'user-fern',
				type: 'user',
				name: 'Mira Chen',
				email: 'mira@example.test',
				url: 'https://linear.app/acme/profiles/mira',
			},
			data: {
				id: 'comment-violet',
				body: '@flue-agent investigate the worker timeout',
				issueId: 'issue-amber',
				userId: 'user-fern',
				createdAt: '2026-06-13T17:20:00.000Z',
				updatedAt: '2026-06-13T17:20:00.000Z',
			},
			type: 'Comment',
			url: 'https://linear.app/acme/issue/EDGE-412#comment-violet',
			createdAt: '2026-06-13T17:20:00.000Z',
			organizationId: 'org-sunrise',
			webhookTimestamp: Date.now(),
			webhookId: 'hook-copper',
		};
		const body = ` {\n  "action": "create",\n  "actor": ${JSON.stringify(raw.actor)},\n  "data": ${JSON.stringify(raw.data)},\n  "type": "Comment",\n  "url": "${raw.url}",\n  "createdAt": "${raw.createdAt}",\n  "organizationId": "org-sunrise",\n  "webhookTimestamp": ${raw.webhookTimestamp},\n  "webhookId": "hook-copper"\n} `;

		const response = await channelApp(linear).request(
			await signedRequest('linear-secret', body, {
				'linear-delivery': 'delivery-moss',
				'linear-event': 'Comment',
			}),
		);

		expect(response.status).toBe(200);
		expect(webhook).toHaveBeenCalledOnce();
		expect(webhook.mock.calls[0]?.[0]).toMatchObject({
			c: expect.any(Object),
			event: {
				type: 'comment',
				action: 'create',
				resourceType: 'Comment',
				organizationId: 'org-sunrise',
				webhookId: 'hook-copper',
				deliveryId: 'delivery-moss',
				actor: {
					id: 'user-fern',
					type: 'user',
					name: 'Mira Chen',
					email: 'mira@example.test',
				},
				conversation: {
					type: 'issue',
					organizationId: 'org-sunrise',
					issueId: 'issue-amber',
				},
				payload: {
					id: 'comment-violet',
					body: '@flue-agent investigate the worker timeout',
					issueId: 'issue-amber',
					userId: 'user-fern',
				},
				raw,
			},
		});
	});

	it('keeps replies in their root issue-comment thread', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const payload = entityPayload({
			type: 'Comment',
			action: 'create',
			data: {
				id: 'comment-reply-slate',
				body: 'The trace points to token refresh.',
				issueId: 'issue-amber',
				parentId: 'comment-root-lime',
			},
		});

		const response = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);

		expect(response.status).toBe(200);
		expect(webhook.mock.calls[0]?.[0].event).toMatchObject({
			type: 'comment',
			conversation: {
				type: 'issue',
				issueId: 'issue-amber',
				threadCommentId: 'comment-root-lime',
			},
		});
	});

	it('normalizes issue and project events for grouped application handling', async () => {
		const seen: string[] = [];
		const linear = createLinearChannel({
			webhookSecret: 'secret',
			webhook({ event }) {
				switch (event.type) {
					case 'issue':
					case 'project':
						seen.push(`${event.type}.${event.action}`);
						return;
					default:
						return;
				}
			},
		});
		const app = channelApp(linear);

		const issueResponse = await app.request(
			await signedRequest(
				'secret',
				JSON.stringify(
					entityPayload({
						type: 'Issue',
						action: 'update',
						url: 'https://linear.app/field/issue/RUN-902',
						data: {
							id: 'issue-orchid',
							identifier: 'RUN-902',
							title: 'Reduce cold-start variance',
							description: 'Audit route initialization.',
							teamId: 'team-field',
							stateId: 'state-active',
							priority: 2,
						},
					}),
				),
			),
		);
		const projectResponse = await app.request(
			await signedRequest(
				'secret',
				JSON.stringify(
					entityPayload({
						type: 'Project',
						action: 'create',
						url: 'https://linear.app/field/project/project-maple',
						data: {
							id: 'project-maple',
							name: 'Worker Reliability',
							description: 'Edge delivery hardening',
							statusId: 'status-planned',
							teamIds: ['team-field', 'team-platform'],
						},
					}),
				),
			),
		);

		expect(issueResponse.status).toBe(200);
		expect(projectResponse.status).toBe(200);
		expect(seen).toEqual(['issue.update', 'project.create']);
	});

	it('normalizes a created agent session with prompt context and issue identity', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const raw = agentSessionPayload({
			action: 'created',
			promptContext: '<issue id="RUN-902">Investigate edge retries</issue>',
			previousComments: [
				{
					id: 'comment-history-1',
					body: 'The problem started after the deploy.',
					issueId: 'issue-orchid',
					userId: 'user-sage',
				},
			],
			guidance: [{ origin: 'team', body: 'Prefer reversible changes.' }],
		});

		const response = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(raw)),
		);

		expect(response.status).toBe(200);
		expect(webhook.mock.calls[0]?.[0].event).toMatchObject({
			type: 'agent_session',
			action: 'created',
			conversation: {
				type: 'agent-session',
				organizationId: 'org-glacier',
				agentSessionId: 'session-cobalt',
			},
			payload: {
				appUserId: 'app-user-river',
				oauthClientId: 'oauth-client-birch',
				promptContext: '<issue id="RUN-902">Investigate edge retries</issue>',
				session: {
					id: 'session-cobalt',
					status: 'pending',
					issueId: 'issue-orchid',
					issue: {
						id: 'issue-orchid',
						identifier: 'RUN-902',
						title: 'Reduce cold-start variance',
					},
				},
				previousComments: [
					{
						id: 'comment-history-1',
						body: 'The problem started after the deploy.',
					},
				],
				guidance: [{ origin: 'team', body: 'Prefer reversible changes.' }],
			},
		});
	});

	it('normalizes a prompted agent session with the user activity', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const raw = agentSessionPayload({
			action: 'prompted',
			agentActivity: {
				id: 'activity-teal',
				agentSessionId: 'session-cobalt',
				userId: 'user-sage',
				content: { type: 'prompt', body: 'Also check the cache headers.' },
				signal: 'stop',
				sourceCommentId: 'comment-root-lime',
			},
		});

		const response = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(raw)),
		);

		expect(response.status).toBe(200);
		expect(webhook.mock.calls[0]?.[0].event).toMatchObject({
			type: 'agent_session',
			action: 'prompted',
			payload: {
				activity: {
					id: 'activity-teal',
					agentSessionId: 'session-cobalt',
					userId: 'user-sage',
					content: { type: 'prompt', body: 'Also check the cache headers.' },
					signal: 'stop',
					sourceCommentId: 'comment-root-lime',
				},
			},
		});
	});

	it('rejects inconsistent nested agent-session identities', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const wrongOrganization = agentSessionPayload({ action: 'created' });
		(wrongOrganization.agentSession as Record<string, unknown>).organizationId = 'org-other';
		const wrongActivity = agentSessionPayload({
			action: 'prompted',
			agentActivity: {
				id: 'activity-mismatch',
				agentSessionId: 'session-other',
				userId: 'user-sage',
				content: { type: 'prompt', body: 'Continue.' },
			},
		});

		const organizationResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(wrongOrganization)),
		);
		const activityResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(wrongActivity)),
		);

		expect(organizationResponse.status).toBe(400);
		expect(activityResponse.status).toBe(400);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('forwards unsupported signed resource types and actions as unknown events', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const raw = entityPayload({
			type: 'Document',
			action: 'archive',
			data: { id: 'document-indigo', title: 'Runbook' },
		});

		const response = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(raw)),
		);

		expect(response.status).toBe(200);
		expect(webhook.mock.calls[0]?.[0].event).toMatchObject({
			type: 'unknown',
			resourceType: 'Document',
			action: 'archive',
			organizationId: 'org-glacier',
			webhookId: 'hook-saffron',
			raw,
		});
	});

	it('rejects altered bytes and stale or future delivery timestamps', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook });
		const current = entityPayload({
			type: 'Comment',
			action: 'create',
			data: { id: 'comment-current', body: 'Current' },
		});
		const body = JSON.stringify(current);
		const signed = await signedRequest('secret', body);
		const altered = new Request(signed.url, {
			method: 'POST',
			headers: signed.headers,
			body: body.replace('Current', 'Changed'),
		});
		const stale = entityPayload({
			type: 'Comment',
			action: 'create',
			data: { id: 'comment-stale', body: 'Stale' },
			webhookTimestamp: Date.now() - 60_001,
		});
		const future = entityPayload({
			type: 'Comment',
			action: 'create',
			data: { id: 'comment-future', body: 'Future' },
			webhookTimestamp: Date.now() + 61_000,
		});

		const alteredResponse = await channelApp(linear).request(altered);
		const staleResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(stale)),
		);
		const futureResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(future)),
		);

		expect(alteredResponse.status).toBe(401);
		expect(staleResponse.status).toBe(401);
		expect(futureResponse.status).toBe(401);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('rejects signed deliveries outside configured organization and webhook identities', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({
			webhookSecret: 'secret',
			organizationId: 'org-expected',
			webhookId: 'hook-expected',
			webhook,
		});
		const wrongOrganization = entityPayload({
			type: 'Issue',
			action: 'create',
			organizationId: 'org-other',
			webhookId: 'hook-expected',
			data: { id: 'issue-a', identifier: 'OPS-1', title: 'One' },
		});
		const wrongWebhook = entityPayload({
			type: 'Issue',
			action: 'create',
			organizationId: 'org-expected',
			webhookId: 'hook-other',
			data: { id: 'issue-b', identifier: 'OPS-2', title: 'Two' },
		});

		const organizationResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(wrongOrganization)),
		);
		const webhookResponse = await channelApp(linear).request(
			await signedRequest('secret', JSON.stringify(wrongWebhook)),
		);

		expect(organizationResponse.status).toBe(403);
		expect(webhookResponse.status).toBe(403);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('uses empty 200, JSON, and Hono responses without a custom response API', async () => {
		const payload = entityPayload({
			type: 'Issue',
			action: 'create',
			data: { id: 'issue-response', identifier: 'API-8', title: 'Response semantics' },
		});
		const empty = createLinearChannel({ webhookSecret: 'secret', webhook: () => undefined });
		const json = createLinearChannel({
			webhookSecret: 'secret',
			webhook: () => ({ accepted: true }),
		});
		const hono = createLinearChannel({
			webhookSecret: 'secret',
			webhook: ({ c }) => c.json({ retry: true }, 503),
		});

		const emptyResponse = await channelApp(empty).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);
		const jsonResponse = await channelApp(json).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);
		const honoResponse = await channelApp(hono).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);

		expect(emptyResponse.status).toBe(200);
		expect(await emptyResponse.text()).toBe('');
		expect(jsonResponse.status).toBe(200);
		expect(await jsonResponse.json()).toEqual({ accepted: true });
		expect(honoResponse.status).toBe(503);
		expect(await honoResponse.json()).toEqual({ retry: true });
	});

	it('returns 500 when the handler throws, times out, or returns non-JSON data', async () => {
		const payload = entityPayload({
			type: 'Issue',
			action: 'create',
			data: { id: 'issue-failure', identifier: 'API-9', title: 'Failure semantics' },
		});
		const throwing = createLinearChannel({
			webhookSecret: 'secret',
			webhook() {
				throw new Error('failure');
			},
		});
		const timedOut = createLinearChannel({
			webhookSecret: 'secret',
			handlerTimeoutMs: 5,
			webhook: () => new Promise(() => undefined),
		});
		const invalid = createLinearChannel({
			webhookSecret: 'secret',
			webhook: () => new Map() as never,
		});

		const throwingResponse = await channelApp(throwing).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);
		const timeoutResponse = await channelApp(timedOut).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);
		const invalidResponse = await channelApp(invalid).request(
			await signedRequest('secret', JSON.stringify(payload)),
		);

		expect(throwingResponse.status).toBe(500);
		expect(timeoutResponse.status).toBe(500);
		expect(invalidResponse.status).toBe(500);
	});

	it('rejects unsupported media, oversized bodies, malformed signatures, and malformed payloads', async () => {
		const webhook = vi.fn();
		const linear = createLinearChannel({
			webhookSecret: 'secret',
			bodyLimit: 128,
			webhook,
		});
		const app = channelApp(linear);

		const mediaResponse = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: { 'content-type': 'text/plain' },
				body: '{}',
			}),
		);
		const oversizedBody = JSON.stringify({
			...entityPayload({
				type: 'Comment',
				action: 'create',
				data: { id: 'comment-large', body: 'x'.repeat(200) },
			}),
		});
		const sizeResponse = await app.request(await signedRequest('secret', oversizedBody));
		const signatureResponse = await app.request(
			new Request('https://example.test/webhook', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'linear-signature': 'not-hex',
				},
				body: '{}',
			}),
		);
		const malformed = entityPayload({
			type: 'Issue',
			action: 'create',
			data: { id: 'issue-no-title', identifier: 'BAD-1' },
		});
		const schemaChannel = createLinearChannel({ webhookSecret: 'secret', webhook });
		const malformedResponse = await channelApp(schemaChannel).request(
			await signedRequest('secret', JSON.stringify(malformed)),
		);

		expect(mediaResponse.status).toBe(415);
		expect(sizeResponse.status).toBe(413);
		expect(signatureResponse.status).toBe(401);
		expect(malformedResponse.status).toBe(400);
		expect(webhook).not.toHaveBeenCalled();
	});

	it('round-trips canonical issue-thread and agent-session keys', () => {
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook: () => undefined });
		const issueRef = {
			type: 'issue' as const,
			organizationId: 'org:glacier',
			issueId: 'issue/amber',
			threadCommentId: 'comment:root',
		};
		const sessionRef = {
			type: 'agent-session' as const,
			organizationId: 'org:glacier',
			agentSessionId: 'session/cobalt',
		};

		const issueKey = linear.conversationKey(issueRef);
		const sessionKey = linear.conversationKey(sessionRef);

		expect(issueKey).toBe(
			'linear:v1:organization:org%3Aglacier:issue:issue%2Famber:thread:comment%3Aroot',
		);
		expect(sessionKey).toBe(
			'linear:v1:organization:org%3Aglacier:agent-session:session%2Fcobalt',
		);
		expect(linear.parseConversationKey(issueKey)).toEqual(issueRef);
		expect(linear.parseConversationKey(sessionKey)).toEqual(sessionRef);
	});

	it('rejects non-canonical keys and invalid conversation references', () => {
		const linear = createLinearChannel({ webhookSecret: 'secret', webhook: () => undefined });

		expect(() => linear.parseConversationKey('linear:v1:issue:missing')).toThrow(
			InvalidLinearConversationKeyError,
		);
		expect(() =>
			linear.conversationKey({
				type: 'issue',
				organizationId: 'org',
				issueId: '',
			}),
		).toThrow(InvalidLinearInputError);
	});

	it('validates constructor limits and publishes only the provider webhook route', () => {
		expect(() =>
			createLinearChannel({
				webhookSecret: '',
				webhook: () => undefined,
			}),
		).toThrow(TypeError);
		expect(() =>
			createLinearChannel({
				webhookSecret: 'secret',
				handlerTimeoutMs: 4_501,
				webhook: () => undefined,
			}),
		).toThrow(TypeError);

		const linear = createLinearChannel({ webhookSecret: 'secret', webhook: () => undefined });
		expect(linear.routes).toHaveLength(1);
		expect(linear.routes[0]).toMatchObject({ method: 'POST', path: '/webhook' });
	});
});

function channelApp(channel: LinearChannel): Hono {
	const app = new Hono();
	for (const route of channel.routes) app.on(route.method, route.path, route.handler);
	return app;
}

async function signedRequest(
	secret: string,
	body: string,
	headers: Record<string, string> = {},
): Promise<Request> {
	return new Request('https://example.test/webhook', {
		method: 'POST',
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'linear-signature': await hmac(secret, body),
			...headers,
		},
		body,
	});
}

async function hmac(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)));
	return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function entityPayload(input: {
	type: string;
	action: string;
	data: Record<string, unknown>;
	organizationId?: string;
	webhookId?: string;
	webhookTimestamp?: number;
	url?: string;
}): Record<string, unknown> {
	return {
		action: input.action,
		data: input.data,
		type: input.type,
		...(input.url ? { url: input.url } : {}),
		createdAt: '2026-06-13T17:30:00.000Z',
		organizationId: input.organizationId ?? 'org-glacier',
		webhookTimestamp: input.webhookTimestamp ?? Date.now(),
		webhookId: input.webhookId ?? 'hook-saffron',
	};
}

function agentSessionPayload(input: {
	action: 'created' | 'prompted';
	promptContext?: string;
	agentActivity?: Record<string, unknown>;
	previousComments?: Record<string, unknown>[];
	guidance?: unknown[];
}): Record<string, unknown> {
	return {
		action: input.action,
		type: 'AgentSessionEvent',
		organizationId: 'org-glacier',
		webhookId: 'hook-saffron',
		webhookTimestamp: Date.now(),
		createdAt: '2026-06-13T17:40:00.000Z',
		appUserId: 'app-user-river',
		oauthClientId: 'oauth-client-birch',
		agentSession: {
			id: 'session-cobalt',
			appUserId: 'app-user-river',
			organizationId: 'org-glacier',
			status: 'pending',
			issueId: 'issue-orchid',
			issue: {
				id: 'issue-orchid',
				identifier: 'RUN-902',
				title: 'Reduce cold-start variance',
				description: 'Audit route initialization.',
			},
			commentId: 'comment-root-lime',
			comment: {
				id: 'comment-root-lime',
				body: '@agent investigate this issue',
				issueId: 'issue-orchid',
				userId: 'user-sage',
			},
			createdAt: '2026-06-13T17:40:00.000Z',
			updatedAt: '2026-06-13T17:40:00.000Z',
			type: 'issue',
		},
		...(input.promptContext === undefined ? {} : { promptContext: input.promptContext }),
		...(input.agentActivity === undefined ? {} : { agentActivity: input.agentActivity }),
		previousComments: input.previousComments ?? [],
		guidance: input.guidance ?? [],
	};
}
