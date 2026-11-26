import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-kanboard.sh');
const SITE = read('scripts/kanboard-site.php');
/** The part of the site script that answers one verb. */
const verb = (name: string) => {
  const start = SITE.indexOf(`$verb === '${name}'`);
  assert.ok(start > 0, `the site script answers ${name}`);
  const next = SITE.indexOf('$verb === ', start + 10);
  return SITE.slice(start, next > 0 ? next : SITE.length);
};
const fn = (name: string) => FUN.slice(FUN.indexOf(`function ${name}()`), FUN.indexOf('\n}\n', FUN.indexOf(`function ${name}()`)) + 2);

test('the manifest names the platform, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  assert.deepStrictEqual(manifest.typeActions, { kanboard: ['sites', 'code'] }, 'the KANBOARD menu on the rows of sites and code folders');
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.deepStrictEqual(names, ['docker-compose.kanboard.yaml', 'kanboard-site.php', 'site.feature']);
  assert.deepStrictEqual(manifest.features, ['features/kanboard.feature']);
  assert.strictEqual(manifest.featuresSite, undefined, 'a site for the features needs a runtime CI has: Kanboard is proven on DDEV only so far');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-tracker': '^1.0.2' });
  assert.ok(manifest.summary.length <= 110, 'the catalogue line shows at most 110 characters');
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/kanboard\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-kanboard-project.sh'), /^# workspace-name: Kanboard \(Kanban project management\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-kanboard-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
});

test('every shell script parses', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args]) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
});

const PHP = spawnSync('php', ['--version'], { encoding: 'utf8' }).status === 0;

test('the site script is PHP that parses', { skip: PHP ? false : 'no php on this machine (the workspace runs PHP in containers only); the CI runner has one' }, () => {
  const r = spawnSync('php', ['-l', path.join(PKG, 'scripts/kanboard-site.php')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('the site script runs on Kanboard\'s own code in its container, and each verb does what it says', () => {
  assert.match(SITE, /^require '\/var\/www\/app\/app\/common\.php';$/m, 'Kanboard\'s own bootstrap: its models');
  for (const name of ['version', 'install', 'accounts', 'content', 'tidy', 'list', 'token', 'counts']) verb(name);
  const install = verb('install');
  assert.match(install, /\$first = user\('admin'\);/, 'the administrator of Kanboard\'s schema');
  assert.match(install, /c\('userModel'\)->update\(\['id' => \(int\) \$first\['id'\]\] \+ \$values\)/, 'becomes the workspace account: its name and its password change');
  assert.match(install, /if \(user\('admin'\) && \$in\['login'\] !== 'admin'\) \{\n\s+fail\(/, 'no account admin is left beside it');
  assert.match(install, /c\('configModel'\)->save\(\['application_url' => \$url \. '\/'\]\)/, 'the site\'s address in its settings');
  const accounts = verb('accounts');
  assert.match(accounts, /'password' => \(string\) \$row\['password'\]/, 'a password from the input, hashed by Kanboard\'s own model');
  assert.match(accounts, /c\('userModel'\)->disable\(\(int\) \$found\['id'\]\)/, 'a lock keeps an account from logging in');
  assert.match(accounts, /c\('projectModel'\)->create\(\['name' => SAMPLE_PROJECT, 'identifier' => SAMPLE_KEY/);
  assert.match(SITE, /^const PROJECT_ROLES = \['owner' => 'project-manager', 'member' => 'project-member', 'reader' => 'project-viewer'\];$/m, 'the roles of the sample project; stranger has none');
  const content = verb('content');
  assert.match(content, /act_as\(\$owner\);/, 'what owner makes, the activity says owner made');
  assert.match(content, /act_as\(\$member\);/, '#2 made as member, its author');
  assert.match(content, /c\('taskStatusModel'\)->close\(\$tid\);/, 'a closed task');
  assert.match(content, /c\('subtaskModel'\)->create\(/);
  const token = verb('token');
  assert.match(token, /Kanboard\\Core\\Security\\Token::getToken\(\)/, 'Kanboard\'s own token maker');
  assert.match(token, /'api_access_token' => \$token/);
  assert.match(verb('tidy'), /->like\('title', TEST_PREFIX \. '%'\)->in\('creator_id', \$ids\)/, 'only the default accounts\' "Webship test …" tasks');
  assert.match(verb('tidy'), /c\('taskModel'\)->remove\(\(int\) \$tid\);/, 'Kanboard\'s own removal, with what it keeps of a task');
  assert.match(SITE, /^const TEST_ACCOUNTS = \['owner', 'member', 'reader', 'stranger'\];$/m);
});

test('the runtimes: DDEV only for now; another is refused before anything is changed, and so is a machine with too little memory', () => {
  assert.match(read('scripts/args/arg-kanboard.sh'), /choices=\['ddev'\]/);
  const build = fn('kanboard_build');
  const guard = build.indexOf('if [ "${runtime}" != \'ddev\' ] ; then');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.ok(build.includes('Kanboard builds on DDEV for now (--runtime ddev), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(build.indexOf('kanboard_free_memory') < build.indexOf('drop_database'), 'the free memory is asked before anything is removed');
  assert.match(FUN, /^readonly KANBOARD_MEMORY_MB=1024;$/m);
  assert.match(FUN, /^readonly KANBOARD_DATABASE='mariadb:11\.4';$/m);
  assert.match(build, /ddev config --project-type=generic --project-name=\$\{PROJECT_NAME\} --database=\$\{KANBOARD_DATABASE\} \\\n\s+--nodejs-version=\$\(ddev_nodejs_version\)/);
  assert.match(read('README.md'), /Kanboard supports SQLite, MySQL, MariaDB and PostgreSQL; the Workspace uses MariaDB 11\.4,/);
});

test('Kanboard\'s service on DDEV: its own image at the project\'s address, its data in volumes named after the project', () => {
  const compose = read('scripts/docker-compose.kanboard.yaml');
  assert.match(compose, /image: "\$\{KANBOARD_IMAGE:-docker\.io\/kanboard\/kanboard:v1\.2\.58\}"/, 'pinned, by its whole name');
  assert.match(FUN, /^readonly KANBOARD_DEFAULT_RELEASE='1\.2\.58';$/m);
  assert.match(fn('kanboard_write_config'), /docker\.io\/kanboard\/kanboard:v\$\{release\}/, 'the image is tagged v<release>');
  assert.match(compose, /- data:\/var\/www\/app\/data/);
  assert.match(compose, /- plugins:\/var\/www\/app\/plugins/);
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-kanboard-data/);
  assert.match(compose, /- \$\{DDEV_APPROOT\}\/kanboard:\/opt\/webship:ro/, 'the plugin\'s scripts, read only');
  assert.match(compose, /VIRTUAL_HOST: \$\{DDEV_HOSTNAME\}/);
  assert.match(compose, /HTTP_EXPOSE: "80:80"/);
  assert.match(compose, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.match(compose, /depends_on:\n\s+db:\n\s+condition: service_healthy/);
  assert.doesNotMatch(compose, /PASSWORD|SECRET|TOKEN/, 'no secret in the compose file');
  const env = fn('kanboard_write_env');
  for (const line of ['KANBOARD_URL=${base_url}', 'DB_DRIVER=mysql', 'DB_HOSTNAME=db', 'DB_NAME=db', 'MAIL_TRANSPORT=smtp', 'MAIL_SMTP_HOSTNAME=web', 'MAIL_SMTP_PORT=1025']) {
    assert.ok(env.split('\n').includes(line), line);
  }
  assert.match(env, /\( umask 077 && cat > "\$\{project_path\}\/\$\{KANBOARD_FILES\}\/env"/, 'kanboard/env is its owner\'s only');
  assert.doesNotMatch(env, /PLUGIN_INSTALLER=true/, 'Kanboard\'s core only: no plugin of its directory');
});

test('the functions carry the names the core\'s tools look for; --connect keeps the token off screens and command lines', () => {
  for (const name of ['set_kanboard_users', 'add_kanboard_users', 'cancel_kanboard_users', 'testing_configure_kanboard', 'kanboard_build', 'kanboard_cli_tool', 'kanboard_connect']) {
    assert.match(FUN, new RegExp(`^function ${name}\\(\\) \\{`, 'm'), `${name} is defined`);
  }
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_stranger_role='' ;/);
  assert.match(FUN, /ddev exec -s kanboard "sh -c \$\(printf '%q' "cd \/var\/www\/app && \$\{1\}"\)"/, 'in Kanboard\'s container, in its folder');
  assert.match(fn('kanboard_cli_tool'), /su -s \/bin\/sh nginx -c/, 'Kanboard\'s console as the web server\'s user, who owns its files');
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  const connect = fn('kanboard_connect');
  assert.match(connect, /KANBOARD_NEW_TOKEN="\$\{token\}" python3/, 'the token reaches the settings writer in its environment only');
  assert.match(connect, /0o600/);
  assert.match(connect, /text = put\(text, 'username', login\)/, 'the account\'s username beside its token');
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the token is never printed');
  assert.match(connect, /\[\[ "\$\{token\}" =~ \^\[a-f0-9\]\{40,\}\$ \]\]/);
  const testing = FUN.slice(FUN.indexOf('function testing_configure_kanboard()'));
  assert.match(testing, /registry="\$\{registry\}\$\{user\}\|\$\{!user_name\}\|\$\{!user_password\}\|\$\{!user_fullname\}"/, 'the pack logs in with the username and shows the name');
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && kanboard_site content < \/dev\/null > \/dev\/null 2>&1 \) ; then/, 'the sample content, in the project');
});

test('the assistant is told how to build, test and connect a site, and what Kanboard has', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /1 GB of free memory/);
  assert.match(told, /--connect <login>/);
  assert.match(told, /admin, password admin/);
  assert.match(told, /Kanboard has no sprint/);
  assert.match(told, /Kanboard's core only: no plugin of its directory/);
});

test('the docs say container-based, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-kanboard.sh', 'config/plugin.kanboard.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org)$/, `${f}: ${m} is not an example address`);
  }
  for (const c of COMMANDS) assert.ok(read('README.md').includes(c), `the README lists ${c}`);
  const keys = [...read('config/plugin.kanboard.settings.yml').matchAll(/^([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 13);
  for (const k of keys) assert.ok(read('README.md').includes(`\`${k}\``), `the README describes the setting ${k}`);
  assert.match(read('README.md'), /none of the third-party plugins of its directory/);
});
