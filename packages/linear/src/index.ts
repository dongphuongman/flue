import type { Context, Env, Handler } from 'hono';
import { InvalidLinearConversationKeyError, InvalidLinearInputError } from './errors.ts';
import { createLinearWebhookHandler } from './webhook.ts';

export { InvalidLinearConversationKeyError, InvalidLinearInputError } from './errors.ts';

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface ChannelRoute<E extends Env = Env> {
	readonly method: string;
	readonly path: string;
	readonly handler: Handler<E>;
}

/** Ingress configuration for one Linear webhook signing secret. */
export interface LinearChannelOptions<E extends Env = Env> {
	/** Secret used to verify the exact Linear request bytes. */
	webhookSecret: string;
	/** Optional fixed organization id. Mismatched signed payloads receive `403`. */
	organizationId?: string;
	/** Optional fixed webhook id. Mismatched signed payloads receive `403`. */
	webhookId?: string;
	/** Maximum request-body size in bytes. Defaults to 1 MiB. */
	bodyLimit?: number;
	/**
	 * Application handler deadline. Defaults to and may not exceed 4500ms,
	 * leaving time before Linear's five-second delivery deadline.
	 */
	handlerTimeoutMs?: number;
	/** Receives every verified Linear delivery. */
	webhook(input: LinearWebhookHandlerInput<E>): LinearHandlerResult;
}

export interface LinearActorRef {
	id?: string;
	type?: string;
	name?: string;
	email?: string;
	url?: string;
}

/** Stable Linear destination suitable for a Flue agent-instance id. */
export type LinearConversationRef =
	| {
			type: 'issue';
			organizationId: string;
			issueId: string;
			/** Root comment id only when the conversation is a nested comment thread. */
			threadCommentId?: string;
	  }
	| {
			type: 'agent-session';
			organizationId: string;
			agentSessionId: string;
	  };

export type LinearIssueConversationRef = Extract<LinearConversationRef, { type: 'issue' }>;
export type LinearAgentSessionConversationRef = Extract<
	LinearConversationRef,
	{ type: 'agent-session' }
>;

export interface LinearCommentPayload {
	id: string;
	body: string;
	issueId?: string;
	parentId?: string;
	userId?: string;
	externalUserId?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface LinearCommentRef {
	id: string;
	body: string;
	issueId?: string;
	userId?: string;
}

export interface LinearIssuePayload {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	teamId?: string;
	stateId?: string;
	assigneeId?: string;
	creatorId?: string;
	delegateId?: string;
	projectId?: string;
	priority?: number;
	url?: string;
}

export interface LinearProjectPayload {
	id: string;
	name: string;
	description?: string;
	statusId?: string;
	leadId?: string;
	teamIds: readonly string[];
	url?: string;
}

export interface LinearAgentActivityRef {
	id: string;
	agentSessionId: string;
	userId: string;
	content: unknown;
	signal?: string;
	sourceCommentId?: string;
}

export interface LinearAgentSessionRef {
	id: string;
	appUserId: string;
	organizationId: string;
	status: string;
	issueId?: string;
	commentId?: string;
	sourceCommentId?: string;
	creatorId?: string;
	url?: string;
	issue?: {
		id: string;
		identifier?: string;
		title?: string;
		description?: string;
	};
	comment?: LinearCommentRef;
}

export interface LinearAgentSessionPayload {
	appUserId: string;
	oauthClientId: string;
	session: LinearAgentSessionRef;
	promptContext?: string;
	activity?: LinearAgentActivityRef;
	previousComments: readonly LinearCommentRef[];
	/** Provider-native guidance rules in nearest-team precedence order. */
	guidance: readonly unknown[];
}

export interface LinearEventEnvelope<TType extends string, TAction extends string, TPayload> {
	type: TType;
	action: TAction;
	resourceType: string;
	organizationId: string;
	webhookId: string;
	webhookTimestamp: number;
	createdAt: string;
	/**
	 * Header-derived delivery id for application-owned deduplication.
	 * Linear signs the body, not this transport header.
	 */
	deliveryId?: string;
	url?: string;
	actor?: LinearActorRef;
	updatedFrom?: unknown;
	payload: TPayload;
	/** Complete parsed payload after signature and timestamp verification. */
	raw: unknown;
}

export type LinearEntityAction = 'create' | 'update' | 'remove';

export interface LinearCommentEvent
	extends LinearEventEnvelope<'comment', LinearEntityAction, LinearCommentPayload> {
	conversation?: LinearIssueConversationRef;
}

export interface LinearIssueEvent
	extends LinearEventEnvelope<'issue', LinearEntityAction, LinearIssuePayload> {
	conversation: LinearIssueConversationRef;
}

export type LinearProjectEvent = LinearEventEnvelope<
	'project',
	LinearEntityAction,
	LinearProjectPayload
>;

export interface LinearAgentSessionEvent
	extends LinearEventEnvelope<
		'agent_session',
		'created' | 'prompted',
		LinearAgentSessionPayload
	> {
	conversation: LinearAgentSessionConversationRef;
}

export interface LinearUnknownEvent {
	type: 'unknown';
	action: string;
	resourceType: string;
	organizationId: string;
	webhookId: string;
	webhookTimestamp: number;
	createdAt: string;
	deliveryId?: string;
	url?: string;
	actor?: LinearActorRef;
	updatedFrom?: unknown;
	raw: unknown;
}

export type LinearWebhookEvent =
	| LinearCommentEvent
	| LinearIssueEvent
	| LinearProjectEvent
	| LinearAgentSessionEvent
	| LinearUnknownEvent;

type LinearHandlerValue = undefined | JsonValue | Response;

export type LinearHandlerResult = LinearHandlerValue | Promise<LinearHandlerValue>;

export interface LinearWebhookHandlerInput<E extends Env = Env> {
	c: Context<E>;
	event: LinearWebhookEvent;
}

/** Verified Linear ingress and canonical identity helpers. */
export interface LinearChannel<E extends Env = Env> {
	readonly routes: readonly ChannelRoute<E>[];
	/** Serializes a canonical namespaced identifier. It is not an authorization capability. */
	conversationKey(ref: LinearConversationRef): string;
	/** Parses only canonical keys produced by `conversationKey()`. */
	parseConversationKey(id: string): LinearConversationRef;
}

/**
 * Creates one verified Linear webhook route.
 *
 * The channel is stateless and does not deduplicate Linear delivery ids.
 */
export function createLinearChannel<E extends Env = Env>(
	options: LinearChannelOptions<E>,
): LinearChannel<E> {
	validateOptions(options);
	const channel: LinearChannel<E> = {
		routes: [
			{
				method: 'POST',
				path: '/webhook',
				handler: createLinearWebhookHandler(options),
			},
		],
		conversationKey(ref) {
			assertConversationRef(ref);
			if (ref.type === 'agent-session') {
				return [
					'linear',
					'v1',
					'organization',
					encodeURIComponent(ref.organizationId),
					'agent-session',
					encodeURIComponent(ref.agentSessionId),
				].join(':');
			}
			return [
				'linear',
				'v1',
				'organization',
				encodeURIComponent(ref.organizationId),
				'issue',
				encodeURIComponent(ref.issueId),
				'thread',
				encodeURIComponent(ref.threadCommentId ?? ''),
			].join(':');
		},
		parseConversationKey(id) {
			try {
				const agentMatch =
					/^linear:v1:organization:([^:]+):agent-session:([^:]+)$/.exec(id);
				if (agentMatch?.[1] && agentMatch[2]) {
					const ref: LinearConversationRef = {
						type: 'agent-session',
						organizationId: decodeURIComponent(agentMatch[1]),
						agentSessionId: decodeURIComponent(agentMatch[2]),
					};
					assertConversationRef(ref);
					if (channel.conversationKey(ref) !== id) {
						throw new InvalidLinearConversationKeyError();
					}
					return ref;
				}

				const issueMatch =
					/^linear:v1:organization:([^:]+):issue:([^:]+):thread:([^:]*)$/.exec(id);
				if (!issueMatch?.[1] || !issueMatch[2] || issueMatch[3] === undefined) {
					throw new InvalidLinearConversationKeyError();
				}
				const threadCommentId = decodeURIComponent(issueMatch[3]);
				const ref: LinearConversationRef = {
					type: 'issue',
					organizationId: decodeURIComponent(issueMatch[1]),
					issueId: decodeURIComponent(issueMatch[2]),
					...(threadCommentId ? { threadCommentId } : {}),
				};
				assertConversationRef(ref);
				if (channel.conversationKey(ref) !== id) {
					throw new InvalidLinearConversationKeyError();
				}
				return ref;
			} catch (error) {
				if (error instanceof InvalidLinearConversationKeyError) throw error;
				throw new InvalidLinearConversationKeyError();
			}
		},
	};
	return channel;
}

function validateOptions<E extends Env>(options: LinearChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createLinearChannel() requires an options object.');
	}
	if (typeof options.webhookSecret !== 'string' || options.webhookSecret.length === 0) {
		throw new TypeError('createLinearChannel() requires a non-empty webhookSecret.');
	}
	for (const field of ['organizationId', 'webhookId'] as const) {
		const value = options[field];
		if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
			throw new TypeError(`Linear ${field} must be a non-empty string when provided.`);
		}
	}
	if (typeof options.webhook !== 'function') {
		throw new TypeError('createLinearChannel() requires a webhook handler.');
	}
}

function assertConversationRef(ref: LinearConversationRef): void {
	if (!ref || typeof ref !== 'object') throw new InvalidLinearInputError('conversation');
	if (typeof ref.organizationId !== 'string' || ref.organizationId.length === 0) {
		throw new InvalidLinearInputError('conversation.organizationId');
	}
	if (ref.type === 'agent-session') {
		if (typeof ref.agentSessionId !== 'string' || ref.agentSessionId.length === 0) {
			throw new InvalidLinearInputError('conversation.agentSessionId');
		}
		return;
	}
	if (ref.type !== 'issue') throw new InvalidLinearInputError('conversation.type');
	if (typeof ref.issueId !== 'string' || ref.issueId.length === 0) {
		throw new InvalidLinearInputError('conversation.issueId');
	}
	if (
		ref.threadCommentId !== undefined &&
		(typeof ref.threadCommentId !== 'string' || ref.threadCommentId.length === 0)
	) {
		throw new InvalidLinearInputError('conversation.threadCommentId');
	}
}
