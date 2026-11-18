// Creates a user, or resets a user's password, directly in the knowledge database. For recovery when nobody can sign in.
// The password is typed here, in your own terminal (hidden, asked twice); it is not taken from the command line or a file.
//   npm run kb:user -- --list
//   npm run kb:user -- --username Nishant724776 --name "Nishant" --role admin
// An existing user name gets a new password (and is re-enabled); a new user name is created. Existing sessions of that user end.
import { all, run } from '../src/db.ts';
import { createUser, listUsers, passwordProblem, ROLES, setPassword } from '../src/auth.ts';
import type { Role } from '../src/auth.ts';

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--list')) {
  const users = listUsers();
  if (!users.length) console.log('There are no users yet: start the server and create the admin with the setup token.');
  for (const u of users) console.log(`${u.username.padEnd(24)} ${u.role.padEnd(9)} ${u.disabled ? 'DISABLED' : 'active  '} last sign-in: ${u.lastLoginAt ?? 'never'}  (${u.displayName})`);
  process.exit(0);
}

const username = flag('username');
if (!username) { console.log('Usage: npm run kb:user -- --username <name> [--name "Display name"] [--role admin|approver|editor|viewer]\n       npm run kb:user -- --list'); process.exit(1); }
const role = (flag('role') ?? 'admin') as Role;
if (!ROLES.includes(role)) { console.log(`Unknown role. Use one of: ${ROLES.join(', ')}.`); process.exit(1); }

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { console.log('Run this in a normal terminal window (the password is typed hidden).'); process.exit(1); }
    process.stdout.write(prompt);
    let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const on = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); resolve(buf); return; }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', on);
  });
}

const pw = await ask(`New password for ${username} (hidden): `);
const problem = passwordProblem(pw);
if (problem) { console.log(problem); process.exit(1); }
if (pw !== (await ask('Type it again: '))) { console.log('The two passwords differ; nothing was changed.'); process.exit(1); }

const existing = all<{ id: number }>('SELECT id FROM users WHERE username = ? COLLATE NOCASE', username)[0];
if (existing) {
  setPassword(existing.id, pw);
  run('UPDATE users SET disabled = 0 WHERE id = ?', existing.id);
  console.log(`Password of ${username} changed and the account is active. Sign in at the login page.`);
} else {
  const u = createUser(username, flag('name') ?? username, role, pw);
  console.log(`User ${u.username} created with the role ${u.role}. Sign in at the login page.`);
}
