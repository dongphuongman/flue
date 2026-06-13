import { createLinearChannel, type LinearConversationRef } from '@flue/linear';
import { defineTool, dispatch } from '@flue/runtime';
import { LinearClient } from '@linear/sdk';
import assistant from '../agents/assistant.ts';

const organizationId = optionalEnv('LINEAR_ORGANIZATION_ID');
const webhookId = optionalEnv('LINEAR_WEBHOOK_ID');

export const client = new LinearClient(linearCredentials());

export const channel = createLinearChannel({
	webhookSecret: requiredEnv('LINEAR_WEBHOOK_SECRET'),
	...(organizationId === undefined ? {} : { organizationId }),
	...(webhookId === undefined ? {} : { webhookId }),

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
			properties: {
				text: { type: 'string', minLength: 1 },
			},
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
				...(ref.threadCommentId === undefined ? {} : { parentId: ref.threadCommentId }),
				body: text,
			});
			return JSON.stringify({ success: result.success, commentId: result.commentId });
		},
	});
}

function linearCredentials(): { apiKey: string } | { accessToken: string } {
	const apiKey = optionalEnv('LINEAR_API_KEY');
	const accessToken = optionalEnv('LINEAR_ACCESS_TOKEN');
	if (apiKey && accessToken) {
		throw new Error('Set LINEAR_API_KEY or LINEAR_ACCESS_TOKEN, not both.');
	}
	if (accessToken) return { accessToken };
	if (apiKey) return { apiKey };
	throw new Error('LINEAR_API_KEY or LINEAR_ACCESS_TOKEN is required.');
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}

function optionalEnv(name: string): string | undefined {
	return process.env[name] || undefined;
}
