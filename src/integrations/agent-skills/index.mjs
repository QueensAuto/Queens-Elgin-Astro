import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Agent Skills discovery index. Each skill lives in
// public/.well-known/agent-skills/<name>/SKILL.md; after the build this writes
// /.well-known/agent-skills/index.json listing them with a sha256 digest of
// the exact bytes served, so the index can never drift from the files.
const BASE = '/.well-known/agent-skills';

export function frontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_-]+):\s*(.*)$/i.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

export async function buildIndex(root) {
  const dir = join(root, ...BASE.split('/').filter(Boolean));
  const skills = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const bytes = await readFile(join(dir, entry.name, 'SKILL.md'));
    const meta = frontmatter(bytes.toString('utf8'));
    if (meta.name !== entry.name || !meta.description) {
      throw new Error(`agent-skills: ${entry.name}/SKILL.md needs name: ${entry.name} and a description`);
    }
    skills.push({
      name: meta.name,
      type: 'skill-md',
      description: meta.description,
      url: `${BASE}/${entry.name}/SKILL.md`,
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    });
  }
  return { skills };
}

export default function agentSkills() {
  return {
    name: 'agent-skills-index',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const index = await buildIndex(root);
        await writeFile(join(root, '.well-known', 'agent-skills', 'index.json'), JSON.stringify(index, null, 2) + '\n');
        logger.info(`indexed ${index.skills.length} agent skills`);
      },
    },
  };
}
