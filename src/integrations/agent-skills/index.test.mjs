import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex, frontmatter } from './index.mjs';

test('frontmatter reads name and description', () => {
  assert.deepEqual(frontmatter('---\nname: shop-info\ndescription: "Facts"\n---\n# Hi'), { name: 'shop-info', description: 'Facts' });
  assert.deepEqual(frontmatter('# no frontmatter'), {});
});

test('index lists every skill with the digest of its exact bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const base = join(root, '.well-known', 'agent-skills');
    const md = '---\nname: book-appointment\ndescription: Book a visit.\n---\n\nSteps.\n';
    await mkdir(join(base, 'book-appointment'), { recursive: true });
    await writeFile(join(base, 'book-appointment', 'SKILL.md'), md);
    const index = await buildIndex(root);
    assert.deepEqual(index.skills, [{
      name: 'book-appointment',
      type: 'skill-md',
      description: 'Book a visit.',
      url: '/.well-known/agent-skills/book-appointment/SKILL.md',
      digest: 'sha256:' + createHash('sha256').update(md).digest('hex'),
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a skill whose name does not match its folder fails the build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const base = join(root, '.well-known', 'agent-skills', 'shop-info');
    await mkdir(base, { recursive: true });
    await writeFile(join(base, 'SKILL.md'), '---\nname: other\ndescription: x\n---\n');
    await assert.rejects(buildIndex(root), /needs name: shop-info/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
