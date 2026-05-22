// Prompt copied to the user's clipboard by the "Copy Prompt" CTA in the hero.
export const COPY_PROMPT = `fetch https://flueframework.com/start.md to create a new agent`;

export const HERO = `import { createAgent, http, type FlueContext } from '@flue/runtime';
import triage from '../skills/triage/SKILL.md' with { type: 'skill' };
import { lookupIssue } from '../tools/github';
import * as v from 'valibot';

export const channels = [http()];

const agent = createAgent(() => ({
  model: 'anthropic/claude-sonnet-4-6',
  instructions: 'Investigate issues, make safe fixes, and clearly report your work.',
  skills: [triage],
  tools: [lookupIssue],
}));

export async function run({ init, payload, env }: FlueContext) {
  // Initialize a created agent using Flue's built-in virtual sandbox.
  const harness = await init(agent);
  const session = await harness.session();

  // Let the agent use its skills and tools, then return structured output:
  const { data } = await session.prompt(\`Triage this issue: #\${payload.issueNumber}\`, {
    result: v.object({
      fixApplied: v.boolean(),
      summary: v.string(),
      comment: v.string(),
    }),
  });

  // Keep absolute control over the agent's most critical decisions:
  if (data.fixApplied) {
    await session.shell(\`git add -A && git commit -m \${JSON.stringify(\`fix: \${data.summary}\`)}\`);
  }

  // Protect sensitive tokens and API keys with fine-grained control:
  await session.fs.writeFile('/tmp/comment.md', data.comment);
  await session.shell(\`gh issue comment \${Number(payload.issueNumber)} --body-file /tmp/comment.md\`, {
    env: { GITHUB_TOKEN: env.GITHUB_TOKEN },
  });
}`;

