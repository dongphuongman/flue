import type { Env, Handler } from 'hono';
import type {
	JsonValue,
	LinearActorRef,
	LinearAgentActivityRef,
	LinearAgentSessionConversationRef,
	LinearAgentSessionEvent,
	LinearAgentSessionPayload,
	LinearAgentSessionRef,
	LinearChannelOptions,
	LinearCommentEvent,
	LinearCommentRef,
	LinearEntityAction,
	LinearIssueConversationRef,
	LinearIssueEvent,
	LinearProjectEvent,
	LinearWebhookEvent,
} from './index.ts';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const DEFAULT_HANDLER_TIMEOUT_MS = 4_500;
const TIMESTAMP_TOLERANCE_MS = 60_000;
const encoder = new TextEncoder();

export function createLinearWebhookHandler<E extends Env>(
	options: LinearChannelOptions<E>,
): Handler<E> {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('Linear webhook bodyLimit must be a positive integer.');
	}
	if (
		!Number.isSafeInteger(handlerTimeoutMs) ||
		handlerTimeoutMs <= 0 ||
		handlerTimeoutMs > DEFAULT_HANDLER_TIMEOUT_MS
	) {
		throw new TypeError('Linear webhook handlerTimeoutMs must be between 1 and 4500.');
	}
	const secret = encoder.encode(options.webhookSecret);

	return async (c) => {
		const request = c.req.raw;
		if (!isJsonRequest(request)) return response(415);
		const rawBody = await readBody(request, bodyLimit);
		if (rawBody.type === 'too-large') return response(413);
		if (rawBody.type === 'invalid') return response(400);

		const signature = parseSignature(request.headers.get('linear-signature'));
		if (!signature || !(await verifySignature(secret, rawBody.value, signature))) {
			return response(401);
		}

		const raw = parseJson(rawBody.value);
		if (!isRecord(raw)) return response(400);
		const event = normalizeEvent(raw, request.headers.get('linear-delivery') ?? undefined);
		if (!event) return response(400);
		if (Math.abs(Date.now() - event.webhookTimestamp) > TIMESTAMP_TOLERANCE_MS) {
			return response(401);
		}
		if (options.organizationId && event.organizationId !== options.organizationId) {
			return response(403);
		}
		if (options.webhookId && event.webhookId !== options.webhookId) {
			return response(403);
		}

		const outcome = await runHandler(
			() => options.webhook({ c, event }),
			handlerTimeoutMs,
		);
		if (outcome.type !== 'success') return response(500);
		return serializeHandlerResult(outcome.value);
	};
}

function normalizeEvent(
	raw: Record<string, unknown>,
	deliveryId: string | undefined,
): LinearWebhookEvent | undefined {
	const resourceType = readNonEmptyString(raw, 'type');
	const action = readNonEmptyString(raw, 'action');
	const organizationId = readNonEmptyString(raw, 'organizationId');
	const webhookId = readNonEmptyString(raw, 'webhookId');
	const webhookTimestamp = readFiniteNumber(raw, 'webhookTimestamp');
	const createdAt = readNonEmptyString(raw, 'createdAt');
	if (
		!resourceType ||
		!action ||
		!organizationId ||
		!webhookId ||
		webhookTimestamp === undefined ||
		!createdAt
	) {
		return undefined;
	}
	const common = {
		action,
		resourceType,
		organizationId,
		webhookId,
		webhookTimestamp,
		createdAt,
		...(deliveryId ? { deliveryId } : {}),
		...(readOptionalString(raw, 'url') === undefined
			? {}
			: { url: readOptionalString(raw, 'url') }),
		...(normalizeActor(readRecord(raw, 'actor')) === undefined
			? {}
			: { actor: normalizeActor(readRecord(raw, 'actor')) }),
		...(raw.updatedFrom === undefined ? {} : { updatedFrom: raw.updatedFrom }),
		raw,
	};

	if (resourceType === 'Comment' && isEntityAction(action)) {
		const data = readRecord(raw, 'data');
		const id = data && readNonEmptyString(data, 'id');
		const body = data && readString(data, 'body');
		if (!data || !id || body === undefined) return undefined;
		const issueId = readOptionalString(data, 'issueId');
		const parentId = readOptionalString(data, 'parentId');
		const conversation: LinearIssueConversationRef | undefined = issueId
			? {
					type: 'issue',
					organizationId,
					issueId,
					...(parentId === undefined ? {} : { threadCommentId: parentId }),
				}
			: undefined;
		return {
			...common,
			type: 'comment',
			action,
			payload: {
				id,
				body,
				...(issueId === undefined ? {} : { issueId }),
				...(parentId === undefined ? {} : { parentId }),
				...(readOptionalString(data, 'userId') === undefined
					? {}
					: { userId: readOptionalString(data, 'userId') }),
				...(readOptionalString(data, 'externalUserId') === undefined
					? {}
					: { externalUserId: readOptionalString(data, 'externalUserId') }),
				...(readOptionalString(data, 'createdAt') === undefined
					? {}
					: { createdAt: readOptionalString(data, 'createdAt') }),
				...(readOptionalString(data, 'updatedAt') === undefined
					? {}
					: { updatedAt: readOptionalString(data, 'updatedAt') }),
			},
			...(conversation === undefined ? {} : { conversation }),
		} satisfies LinearCommentEvent;
	}

	if (resourceType === 'Issue' && isEntityAction(action)) {
		const data = readRecord(raw, 'data');
		const id = data && readNonEmptyString(data, 'id');
		const identifier = data && readNonEmptyString(data, 'identifier');
		const title = data && readString(data, 'title');
		if (!data || !id || !identifier || title === undefined) return undefined;
		return {
			...common,
			type: 'issue',
			action,
			conversation: { type: 'issue', organizationId, issueId: id },
			payload: {
				id,
				identifier,
				title,
				...optionalStringFields(data, [
					'description',
					'teamId',
					'stateId',
					'assigneeId',
					'creatorId',
					'delegateId',
					'projectId',
				]),
				...(readFiniteNumber(data, 'priority') === undefined
					? {}
					: { priority: readFiniteNumber(data, 'priority') }),
				...(readOptionalString(raw, 'url') === undefined
					? {}
					: { url: readOptionalString(raw, 'url') }),
			},
		} satisfies LinearIssueEvent;
	}

	if (resourceType === 'Project' && isEntityAction(action)) {
		const data = readRecord(raw, 'data');
		const id = data && readNonEmptyString(data, 'id');
		const name = data && readString(data, 'name');
		if (!data || !id || name === undefined) return undefined;
		const teamIds = readStringArray(data, 'teamIds') ?? [];
		return {
			...common,
			type: 'project',
			action,
			payload: {
				id,
				name,
				...optionalStringFields(data, ['description', 'statusId', 'leadId']),
				teamIds,
				...(readOptionalString(raw, 'url') === undefined
					? {}
					: { url: readOptionalString(raw, 'url') }),
			},
		} satisfies LinearProjectEvent;
	}

	if (
		resourceType === 'AgentSessionEvent' &&
		(action === 'created' || action === 'prompted')
	) {
		const payload = normalizeAgentSessionPayload(raw);
		if (!payload) return undefined;
		return {
			...common,
			type: 'agent_session',
			action,
			conversation: {
				type: 'agent-session',
				organizationId,
				agentSessionId: payload.session.id,
			} satisfies LinearAgentSessionConversationRef,
			payload,
		} satisfies LinearAgentSessionEvent;
	}

	return {
		...common,
		type: 'unknown',
		action,
		resourceType,
	};
}

function normalizeAgentSessionPayload(
	raw: Record<string, unknown>,
): LinearAgentSessionPayload | undefined {
	const appUserId = readNonEmptyString(raw, 'appUserId');
	const oauthClientId = readNonEmptyString(raw, 'oauthClientId');
	const organizationId = readNonEmptyString(raw, 'organizationId');
	const sessionRaw = readRecord(raw, 'agentSession');
	if (!appUserId || !oauthClientId || !organizationId || !sessionRaw) return undefined;
	const session = normalizeAgentSession(sessionRaw);
	if (!session) return undefined;
	if (session.appUserId !== appUserId || session.organizationId !== organizationId) {
		return undefined;
	}
	const activity = normalizeAgentActivity(readRecord(raw, 'agentActivity'));
	if (readRecord(raw, 'agentActivity') && !activity) return undefined;
	if (activity && activity.agentSessionId !== session.id) return undefined;
	const previousComments = readRecordArray(raw, 'previousComments')
		?.map(normalizeCommentRef)
		.filter((value): value is NonNullable<typeof value> => value !== undefined);
	if (
		Array.isArray(raw.previousComments) &&
		(!previousComments || previousComments.length !== raw.previousComments.length)
	) {
		return undefined;
	}
	return {
		appUserId,
		oauthClientId,
		session,
		...(readOptionalString(raw, 'promptContext') === undefined
			? {}
			: { promptContext: readOptionalString(raw, 'promptContext') }),
		...(activity === undefined ? {} : { activity }),
		previousComments: previousComments ?? [],
		guidance: Array.isArray(raw.guidance) ? raw.guidance : [],
	};
}

function normalizeAgentSession(raw: Record<string, unknown>): LinearAgentSessionRef | undefined {
	const id = readNonEmptyString(raw, 'id');
	const appUserId = readNonEmptyString(raw, 'appUserId');
	const organizationId = readNonEmptyString(raw, 'organizationId');
	const status = readNonEmptyString(raw, 'status');
	if (!id || !appUserId || !organizationId || !status) return undefined;
	const issueRaw = readRecord(raw, 'issue');
	const issueId = readOptionalString(raw, 'issueId');
	const issue =
		issueRaw && readNonEmptyString(issueRaw, 'id')
			? {
					id: readNonEmptyString(issueRaw, 'id') as string,
					...optionalStringFields(issueRaw, ['identifier', 'title', 'description']),
				}
			: undefined;
	const commentRaw = readRecord(raw, 'comment');
	const comment = commentRaw ? normalizeCommentRef(commentRaw) : undefined;
	if (commentRaw && !comment) return undefined;
	return {
		id,
		appUserId,
		organizationId,
		status,
		...optionalStringFields(raw, [
			'commentId',
			'sourceCommentId',
			'creatorId',
			'url',
		]),
		...(issueId === undefined ? {} : { issueId }),
		...(issue === undefined ? {} : { issue }),
		...(comment === undefined ? {} : { comment }),
	};
}

function normalizeAgentActivity(
	raw: Record<string, unknown> | undefined,
): LinearAgentActivityRef | undefined {
	if (!raw) return undefined;
	const id = readNonEmptyString(raw, 'id');
	const agentSessionId = readNonEmptyString(raw, 'agentSessionId');
	const userId = readNonEmptyString(raw, 'userId');
	if (!id || !agentSessionId || !userId || !Object.hasOwn(raw, 'content')) return undefined;
	return {
		id,
		agentSessionId,
		userId,
		content: raw.content,
		...optionalStringFields(raw, ['signal', 'sourceCommentId']),
	};
}

function normalizeCommentRef(
	raw: Record<string, unknown>,
): LinearCommentRef | undefined {
	const id = readNonEmptyString(raw, 'id');
	const body = readString(raw, 'body');
	if (!id || body === undefined) return undefined;
	return { id, body, ...optionalStringFields(raw, ['issueId', 'userId']) };
}

function normalizeActor(raw: Record<string, unknown> | undefined): LinearActorRef | undefined {
	if (!raw) return undefined;
	const actor = optionalStringFields(raw, ['id', 'type', 'name', 'email', 'url']);
	return Object.keys(actor).length > 0 ? actor : undefined;
}

function optionalStringFields<T extends string>(
	raw: Record<string, unknown>,
	keys: readonly T[],
): Partial<Record<T, string>> {
	const fields: Partial<Record<T, string>> = {};
	for (const key of keys) {
		const value = readOptionalString(raw, key);
		if (value !== undefined) fields[key] = value;
	}
	return fields;
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(500);
	return Response.json(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (seen.has(value)) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
	seen.add(value);
	try {
		return Array.isArray(value)
			? value.every((item) => isJsonValue(item, seen))
			: Object.values(value).every((item) => isJsonValue(item, seen));
	} finally {
		seen.delete(value);
	}
}

function isJsonRequest(request: Request): boolean {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null && !/^\d+$/.test(contentLength)) return false;
	return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
		'application/json';
}

async function readBody(
	request: Request,
	bodyLimit: number,
): Promise<
	| { type: 'success'; value: Uint8Array }
	| { type: 'too-large' }
	| { type: 'invalid' }
> {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null && Number(contentLength) > bodyLimit) return { type: 'too-large' };
	if (!request.body) return { type: 'success', value: new Uint8Array() };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > bodyLimit) {
				void reader.cancel();
				return { type: 'too-large' };
			}
			chunks.push(value);
		}
	} catch {
		return { type: 'invalid' };
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { type: 'success', value: body };
}

function parseSignature(value: string | null): Uint8Array | undefined {
	if (!/^[0-9a-fA-F]{64}$/.test(value ?? '')) return undefined;
	const bytes = new Uint8Array(32);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt((value as string).slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

async function verifySignature(
	secret: Uint8Array,
	body: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	return crypto.subtle.verify('HMAC', key, toArrayBuffer(signature), toArrayBuffer(body));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

function parseJson(body: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
	} catch {
		return undefined;
	}
}

function isEntityAction(value: string): value is LinearEntityAction {
	return value === 'create' || value === 'update' || value === 'remove';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	return isRecord(value[key]) ? value[key] : undefined;
}

function readRecordArray(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown>[] | undefined {
	const field = value[key];
	return Array.isArray(field) && field.every(isRecord) ? field : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	return typeof value[key] === 'string' ? value[key] : undefined;
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string | undefined {
	const field = readString(value, key);
	return field && field.length > 0 ? field : undefined;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key];
	return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function readFiniteNumber(value: Record<string, unknown>, key: string): number | undefined {
	const field = value[key];
	return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function readStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
	const field = value[key];
	return Array.isArray(field) && field.every((item) => typeof item === 'string')
		? field
		: undefined;
}

type HandlerOutcome<T> = { type: 'success'; value: T } | { type: 'failure' } | { type: 'timeout' };

async function runHandler<T>(
	handler: () => T | Promise<T>,
	timeoutMs: number,
): Promise<HandlerOutcome<T>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const handlerPromise = Promise.resolve()
		.then(handler)
		.then(
			(value): HandlerOutcome<T> => ({ type: 'success', value }),
			(): HandlerOutcome<T> => ({ type: 'failure' }),
		);
	const timeoutPromise = new Promise<HandlerOutcome<T>>((resolve) => {
		timeout = setTimeout(() => resolve({ type: 'timeout' }), timeoutMs);
	});
	const outcome = await Promise.race([handlerPromise, timeoutPromise]);
	if (timeout !== undefined) clearTimeout(timeout);
	return outcome;
}

function response(status: number): Response {
	return new Response(null, { status });
}
