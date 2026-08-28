import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const PRIVATE_ROOT = resolve('migration-private');

async function rejectLink(path, allowMissing = false) {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('artifact_path_link_forbidden');
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return;
    throw error;
  }
}

export async function resolvePrivateArtifact(input, { createRoot = false, mustExist = false } = {}) {
  if (typeof input !== 'string' || !input) throw new Error('artifact_path_required');
  const target = resolve(input);
  const rel = relative(PRIVATE_ROOT, target);
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel)) throw new Error('artifact_path_outside_private_root');
  if (createRoot) await mkdir(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  await rejectLink(PRIVATE_ROOT, !createRoot);
  const parent = dirname(target);
  if (parent !== PRIVATE_ROOT) throw new Error('artifact_subdirectories_forbidden');
  await rejectLink(parent, false);
  await rejectLink(target, !mustExist);
  return target;
}

export async function createPrivateArtifact(input) {
  const target = await resolvePrivateArtifact(input, { createRoot: true });
  const handle = await open(target, 'wx', 0o600);
  const writeJson = async (value) => {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    await handle.truncate(0);
    await handle.write(content, 0, 'utf8');
    await handle.sync();
  };
  return { target, handle, writeJson };
}
