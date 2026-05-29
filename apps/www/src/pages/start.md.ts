import type { APIRoute } from 'astro';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const docsDir = join(process.cwd(), '../../docs');
const rawDocsUrl = 'https://raw.githubusercontent.com/withastro/flue/refs/heads/main/docs';

async function getDeployGuideList() {
	const files = (await readdir(docsDir))
		.filter((file) => file.startsWith('deploy-') && file.endsWith('.md'))
		.sort();

	const guides = await Promise.all(
		files.map(async (file) => {
			const contents = await readFile(join(docsDir, file), 'utf-8');
			const title = contents.match(/^#\s+(.+)$/m)?.[1] ?? file;

			return `   - ${title}: ${rawDocsUrl}/${file}`;
		}),
	);

	return guides.join('\n');
}

const START_INSTRUCTIONS = `# Skill: Create a New Flue Agent

You are helping the user create their first Flue agent. Start with one agent module, and add a workflow only when the user's goal needs a finite, result-oriented operation around that agent.

## Step 1: Gather Context

First, fetch and read the Flue README and homepage:

https://raw.githubusercontent.com/withastro/flue/refs/heads/main/README.md
https://flueframework.com/

## Step 2: Discover Requirements

Determine the following. Ask the user only for information you do not already know from the conversation. If the user has already made a choice, treat that choice as binding.

1. What would they like to build?
   - Let their answer determine the smallest useful starter shape.
   - If they do not answer, or are not sure yet, create a minimal \`hello-world\` agent module only. Do not create a workflow by default.
   - Choose **agent only** for a continuing assistant or event-driven agent with an identity and sessions that can accept interactions over time. Examples: a chat assistant, support agent, coding agent, or message-driven triage agent.
   - Choose **agent + workflow** when they also need a bounded job that runs once and returns a result. Examples: summarize a ticket, generate a report, handle a CI task, or execute scheduled/batch orchestration.
   - Do not create a workflow merely to test or talk to an agent. An agent can be used locally with \`flue connect\`.
2. Where should the project live on disk?
   - Use filesystem tools to inspect the current working directory first, then confirm the target directory with the user.
   - Flue supports two authored source layouts:
     - Root layout: \`./agents/\` and \`./workflows/\`.
     - \`.flue\` layout: \`./.flue/agents/\` and \`./.flue/workflows/\`.
   - If \`<project-root>/.flue/\` already exists, use the \`.flue\` layout. Flue ignores root-level \`agents/\`, \`workflows/\`, and \`app.*\` for discovery in that case.
   - If \`.flue/\` does not exist, prefer the root layout for a new or focused Flue project. When adding Flue to a larger existing application, recommend the \`.flue\` layout and confirm that choice with the user.
   - Never mix the two layouts.
3. Where should it deploy? For example: Cloudflare Workers, Node.js, GitHub Actions, GitLab CI/CD, Vercel, Fly.io.
   - Available deploy guides:
${await getDeployGuideList()}
   - If they choose a host without a deploy guide, use the Node.js guide as the baseline unless they ask for something else.
4. Do they have an LLM provider/model in mind?
   - Optional, but recommended. Setup is easier if you know which provider they plan to use, because you can scaffold the right model identifier and environment variable names.
   - We suggest these exact model IDs:
     - \`anthropic/claude-sonnet-4-6\` - latest Sonnet
     - \`anthropic/claude-opus-4-7\` - latest Opus
     - \`openai/gpt-5.5\` - GPT-5.5
     - \`openrouter/moonshotai/kimi-k2.6\` - latest Kimi
   - If the user wants a different provider or model, use this list to get the best model ID: \`https://flueframework.com/models.json\`
   - If their requested model is unavailable, ask before substituting another model. Don't continue until you have a model ID.

Before implementing, restate the chosen requirements to yourself as an implementation contract:

- Agent purpose: \`<purpose>\`
- Starter shape: \`agent only\` or \`agent + workflow\`
- Project directory: \`<absolute or relative path>\`
- Source layout: \`root\` or \`.flue\`
- Agent module path: \`./agents/<name>.ts\` or \`./.flue/agents/<name>.ts\`
- Workflow module path, if needed: \`none\`, \`./workflows/<name>.ts\`, or \`./.flue/workflows/<name>.ts\`
- Deploy target: \`<target>\`
- Provider/model: \`<exact model id>\`

## Step 3: Build the Smallest Useful Starter Project

1. Pick the deploy guide that best matches the user's target, fetch it, and follow its package, target, configuration, secrets, and deployment guidance.
   - Some deploy-guide starter examples may use a workflow. Treat those as deployment examples, not as a requirement to create a workflow. Preserve the selected starter shape.
2. Create or update the project in the requested directory using the selected source layout.
3. Always create one minimal **agent module** matching the user's idea, keeping it closer to "hello world" than a production app.
   - Put it in the selected layout's immediate \`agents/\` directory, using a lower-kebab-case filename such as \`agents/hello-world.ts\`.
   - It must default-export \`createAgent(() => ({ model: '<exact model id>', instructions: '<short purpose-specific instruction>' }))\`.
   - Do not export \`route\` or \`websocket\` unless the user needs direct HTTP or WebSocket access. For a basic local starter, use \`flue connect <agent-name> local\` instead.
4. If the selected shape is **agent + workflow**, create one minimal **workflow module** for the finite job.
   - Put it in the selected layout's immediate \`workflows/\` directory, using a lower-kebab-case filename.
   - Import the created agent from the new agent module, export \`run(...)\`, initialize it with \`const harness = await init(agent)\`, open a session, perform one purpose-specific operation, and return its result.
   - Export workflow \`route\` or \`websocket\` only if the user needs that invocation surface.
5. Add \`tsconfig.json\` for TypeScript editor/typechecking support.
   - If no \`tsconfig.json\` exists, create this minimal one:
     \`\`\`json
     {
       "compilerOptions": {
         "target": "ES2024",
         "module": "ESNext",
         "moduleResolution": "Bundler",
         "strict": true,
         "skipLibCheck": true
       },
       "include": ["agents/**/*.ts", "workflows/**/*.ts", ".flue/**/*.ts"],
       "exclude": ["dist"]
     }
     \`\`\`
   - If \`tsconfig.json\` already exists, do not replace it. Make the smallest safe change needed to include the generated authored-source files.
   - TypeScript may ignore hidden directories by default, so projects using the \`.flue\` layout usually need \`.flue/**/*.ts\` included explicitly.
6. Add only the dependencies and config required by the selected deploy guide and chosen starter shape.
7. Run the most relevant validation command you can, such as build, typecheck, \`flue connect\` for an agent, or a local workflow invocation when a workflow was created. If you cannot run it, explain why.
8. Finish with the exact next commands the user should run, including how to set any required secrets and how to interact with the created agent or invoke the workflow.

## Step 4: Verify Implementation

Before finishing, verify that the implementation matches the user's explicit choices:

- **Project location**: Files were created in the requested directory.
- **Source layout**: Files use only the selected root or \`.flue\` layout; if \`.flue/\` exists, no new discovered entrypoints were placed at the root.
- **Agent module**: One agent module exists in \`agents/<name>.ts\` or \`.flue/agents/<name>.ts\` and default-exports \`createAgent(...)\`.
- **Workflow choice**: No workflow was added for an agent-only starter; for an agent + workflow starter, one workflow module initializes the created agent with \`init(agent)\`.
- **Deploy target**: Config and commands match the user's selected deploy target.
- **LLM provider/model**: Model identifier is one of the suggested exact IDs, or an exact value from \`https://flueframework.com/models.json\` if the user requested another model.
- **Secrets**: No fake API keys, tokens, or secrets were invented.
- **Dependencies**: Only dependencies required by the selected deploy guide and starter shape were added.

If any item does not match the user's choices, fix it before you finish.

In your final response, include a short checklist with the project directory, source layout, agent module path, workflow module path or \`none\`, deploy target, model ID, and validation result.

## Important Instructions and Constraints to be Successful

- Important: Never invent API keys or secrets.
  - Instead: You can scaffold out obvious placeholders, but always ask the user to provide the API secrets/keys/tokens themselves. You can still help the user by showing them the command to run to set the secret, based on their local dev setup and chosen host.
- Important: A direct prompt to an agent or a dispatched agent input is not a workflow run. Use workflow terminology only for an invocation of a workflow module.
- Important: For local development, prefer \`flue dev --target node\` or \`flue dev --target cloudflare\`. The dev server defaults to port 3583, watches for file changes, and rebuilds + reloads on edits.
  - Instead of: combining \`flue build\` with \`wrangler dev\` (the previous workflow). \`flue dev --target cloudflare\` covers that case directly and stays in sync with what \`wrangler deploy\` will bundle.
- Important: \`flue run --target cloudflare\` is not supported.
  - Instead: \`flue run\` only supports \`--target node\`. To exercise a Cloudflare HTTP or WebSocket endpoint locally, use \`flue dev --target cloudflare\` and call the exposed endpoint. For deployed Cloudflare invocations, build with \`flue build --target cloudflare\` and call the deployed endpoint after \`wrangler deploy\`.
`;

export const GET: APIRoute = () => {
	return new Response(START_INSTRUCTIONS, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
		},
	});
};
