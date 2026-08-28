import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const toolsRoot = resolve('.tools', 'temurin21');
const javaHome = existsSync(toolsRoot)
  ? readdirSync(toolsRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && existsSync(join(toolsRoot, entry.name, 'bin', 'java.exe')))
  : null;

if (!javaHome) {
  console.error('Portable Java not found under .tools/temurin21. See README.md for local emulator setup.');
  process.exit(1);
}

const env = { ...process.env, JAVA_HOME: join(toolsRoot, javaHome.name) };
const credentialVariables = new Set([
  'FIREBASE_TOKEN',
  'FIREBASE_CONFIG',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
]);
for (const key of Object.keys(env)) {
  if (credentialVariables.has(key.toUpperCase())) delete env[key];
}
env.XDG_CONFIG_HOME = resolve('.tools', 'config');
env.FIREBASE_CLI_DISABLE_UPDATE_CHECK = 'true';
env.CI = 'true';
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'Path';
env[pathKey] = `${join(env.JAVA_HOME, 'bin')};${env[pathKey] || ''}`;
const testCommand = `"${process.execPath}" --test test/firestore-emulator.test.js`;

const result = spawnSync(
  process.execPath,
  ['node_modules/firebase-tools/lib/bin/firebase.js', 'emulators:exec', '--only', 'firestore', '--project', 'demo-family-helpers', testCommand],
  { cwd: process.cwd(), env, stdio: 'inherit', shell: false },
);

if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
