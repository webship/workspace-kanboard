<?php
/*
 * The Kanboard site of a Webship Workspace project, from Kanboard's own code in its container: the plugin's
 * kanboard-site.php, read from the project's kanboard/ folder (at /opt/webship on DDEV).
 *
 *     php /opt/webship/kanboard-site.php <verb>…
 *
 * Verbs, run in the order given:
 *   version   the release the site runs (VERSION <release>)
 *   install   the workspace account on the input in the place of the administrator Kanboard's schema starts with
 *             (admin, password admin), so no default password is left; the site's address in its settings
 *   accounts  the default accounts on the input: made or given back their names, roles and passwords, and their roles
 *             in the sample project, which is made for them when it is missing; or kept from logging in ("lock")
 *   content   the sample content, made as its authors: a category, a tag, three tasks in the board's columns, one of
 *             them closed, a comment and a subtask
 *   tidy      what a stopped test run left: tasks titled "Webship test …" made by the default accounts in the sample
 *             project, removed by Kanboard's own removal with what it keeps of them
 *   list      the accounts, and what the sample project holds
 *   token     a new API access token of the account on the input (TOKEN <token>), in the place of its earlier one
 *   counts    what the sample project holds, one count a line
 *
 * What a verb reads (accounts, passwords, a login) comes on the input as JSON, never on a command line.
 */

chdir('/var/www/app');
require '/var/www/app/app/common.php';

const SAMPLE_PROJECT = 'Webship site';
const SAMPLE_KEY = 'WEB';
const TEST_PREFIX = 'Webship test ';
const TEST_ACCOUNTS = ['owner', 'member', 'reader', 'stranger'];
// The roles the builder gives, by its names: the site's (Kanboard's application roles) and the sample project's.
const APP_ROLES = ['owner' => 'app-manager', 'member' => 'app-user', 'reader' => 'app-user', 'stranger' => 'app-user'];
const PROJECT_ROLES = ['owner' => 'project-manager', 'member' => 'project-member', 'reader' => 'project-viewer'];

$verbs = array_slice($argv, 1);
$input = null;

function input(): array
{
    global $input;
    if ($input === null) {
        $raw = trim(stream_get_contents(STDIN));
        $input = $raw === '' ? [] : (json_decode(base64_decode($raw, true) ?: $raw, true) ?? []);
    }
    return $input;
}

function say(string $line): void
{
    fwrite(STDOUT, $line . "\n");
}

function fail(string $line): never
{
    fwrite(STDERR, $line . "\n");
    exit(1);
}

function c(string $name)
{
    global $container;
    return $container[$name];
}

function db()
{
    return c('db');
}

/** What the person did, Kanboard's events and its activity say they did: the session is theirs. */
function act_as(array $user): void
{
    c('userSession')->initialize($user);
}

function user(string $login): ?array
{
    $row = c('userModel')->getByUsername($login);
    return $row ?: null;
}

function sample_project(): ?array
{
    $row = c('projectModel')->getByName(SAMPLE_PROJECT);
    return $row ?: null;
}

function test_account_ids(): array
{
    return array_map('intval', db()->table('users')->in('username', TEST_ACCOUNTS)->findAllByColumn('id'));
}

function column_id(int $pid, string $title): int
{
    foreach (c('columnModel')->getAll($pid) as $column) {
        if ($column['title'] === $title) {
            return (int) $column['id'];
        }
    }
    fail("The sample project has no column {$title}.");
}

foreach ($verbs as $verb) {
    if ($verb === 'version') {
        say('VERSION ' . ltrim((string) APP_VERSION, 'v'));
    } elseif ($verb === 'install') {
        $in = input();
        foreach (['login', 'mail', 'password', 'name'] as $key) {
            if (empty($in[$key])) {
                fail("install: no {$key} on the input.");
            }
        }
        $values = ['username' => $in['login'], 'name' => $in['name'], 'email' => $in['mail'], 'password' => $in['password'], 'role' => 'app-admin', 'is_active' => 1];
        $mine = user($in['login']);
        $first = user('admin');
        if ($mine) {
            $ok = c('userModel')->update(['id' => (int) $mine['id']] + $values);
        } elseif ($first && $in['login'] !== 'admin') {
            // The administrator of Kanboard's schema becomes the workspace account: its name and its password change.
            $ok = c('userModel')->update(['id' => (int) $first['id']] + $values);
        } else {
            $ok = c('userModel')->create($values);
        }
        if (! $ok) {
            fail('install: the workspace account could not be made.');
        }
        if (user('admin') && $in['login'] !== 'admin') {
            fail('install: an account "admin" is left beside the workspace account; remove it in Kanboard.');
        }
        $url = rtrim((string) getenv('KANBOARD_URL'), '/');
        if ($url !== '') {
            c('configModel')->save(['application_url' => $url . '/']);
        }
        say("install: {$in['login']} is the administrator of the site; sign-ups are Kanboard's: none, an administrator makes the accounts");
    } elseif ($verb === 'accounts') {
        $rows = input()['rows'] ?? input();
        if (! is_array($rows) || ! $rows) {
            fail('accounts: no account on the input.');
        }
        $ids = [];
        foreach ($rows as $row) {
            $login = (string) ($row['login'] ?? '');
            if ($login === '') {
                continue;
            }
            $found = user($login);
            if (($row['action'] ?? '') === 'lock') {
                if ($found) {
                    c('userModel')->disable((int) $found['id']);
                    say("{$login}: kept from logging in");
                }
                continue;
            }
            $values = ['username' => $login, 'name' => (string) $row['name'], 'email' => (string) $row['mail'], 'password' => (string) $row['password'], 'role' => APP_ROLES[$row['role'] ?? ''] ?? 'app-user', 'is_active' => 1];
            if ($found) {
                c('userModel')->update(['id' => (int) $found['id']] + $values);
                c('userModel')->enable((int) $found['id']);
                c('userLockingModel')->resetFailedLogin($login);
                $ids[$login] = (int) $found['id'];
            } else {
                $ids[$login] = (int) c('userModel')->create($values);
            }
            if (! $ids[$login]) {
                fail("accounts: {$login} could not be made.");
            }
        }
        // The sample project, owned by the owner, and each account in its role there; stranger in none.
        $project = sample_project();
        if (! $project && isset($ids['owner'])) {
            $pid = (int) c('projectModel')->create(['name' => SAMPLE_PROJECT, 'identifier' => SAMPLE_KEY, 'description' => 'The sample project of the Webship Workspace.', 'owner_id' => $ids['owner']], $ids['owner'], true);
            $project = $pid ? c('projectModel')->getById($pid) : null;
        }
        if ($project) {
            $pid = (int) $project['id'];
            foreach ($rows as $row) {
                $login = (string) ($row['login'] ?? '');
                if (! isset($ids[$login])) {
                    continue;
                }
                $role = PROJECT_ROLES[$row['role'] ?? ''] ?? '';
                $now = c('projectUserRoleModel')->getUserRole($pid, $ids[$login]);
                if ($role === '') {
                    if ($now) {
                        c('projectUserRoleModel')->removeUser($pid, $ids[$login]);
                    }
                } elseif ($now !== $role) {
                    $now ? c('projectUserRoleModel')->changeUserRole($pid, $ids[$login], $role) : c('projectUserRoleModel')->addUser($pid, $ids[$login], $role);
                }
            }
        }
        foreach ($ids as $login => $id) {
            $role = $project ? (c('projectUserRoleModel')->getUserRole((int) $project['id'], $id) ?: 'not in ' . SAMPLE_PROJECT) : 'no sample project';
            say(sprintf('  %-10s %s', $login, $role));
        }
    } elseif ($verb === 'content') {
        $owner = user('owner');
        $member = user('member');
        if (! $owner || ! $member) {
            fail('content: add the default accounts first (--add-users).');
        }
        $project = sample_project();
        if (! $project) {
            fail('content: no sample project; add the default accounts first (--add-users).');
        }
        $pid = (int) $project['id'];
        act_as($owner);
        $category = c('categoryModel')->getIdByName($pid, 'Bug') ?: c('categoryModel')->create(['project_id' => $pid, 'name' => 'Bug']);
        $tag = c('tagModel')->getIdByName($pid, 'greeting') ?: c('tagModel')->create($pid, 'greeting');
        $swimlane = (int) c('swimlaneModel')->getFirstActiveSwimlaneId($pid);
        $find = fn (string $title) => (int) db()->table('tasks')->eq('project_id', $pid)->eq('title', $title)->findOneColumn('id');
        $greeting = 'The greeting script says Helo instead of Hello';
        if (! $find($greeting)) {
            $tid = (int) c('taskCreationModel')->create([
                'project_id' => $pid, 'title' => $greeting, 'description' => '`greeting.sh` prints *Helo* where it should print *Hello*.',
                'creator_id' => (int) $owner['id'], 'owner_id' => (int) $member['id'], 'category_id' => (int) $category,
                'column_id' => column_id($pid, 'Work in progress'), 'swimlane_id' => $swimlane, 'priority' => 3, 'color_id' => 'red',
            ]);
            c('taskTagModel')->save($pid, $tid, ['greeting']);
            c('commentModel')->create(['task_id' => $tid, 'user_id' => (int) $owner['id'], 'comment' => 'Seen on the test site: the greeting prints Helo.']);
            c('subtaskModel')->create(['task_id' => $tid, 'title' => 'Fix the spelling in greeting.sh', 'user_id' => (int) $member['id']]);
        }
        $usage = 'The usage line spells greeting as greting';
        if (! $find($usage)) {
            act_as($member);
            c('taskCreationModel')->create([
                'project_id' => $pid, 'title' => $usage, 'description' => 'The usage line of `greeting.sh` says *greting*.',
                'creator_id' => (int) $member['id'], 'column_id' => column_id($pid, 'Backlog'), 'swimlane_id' => $swimlane,
            ]);
            act_as($owner);
        }
        $newline = 'The greeting script ends without a newline';
        if (! $find($newline)) {
            // Done, and closed: Kanboard keeps a closed task out of the board, in the project's closed tasks.
            $tid = (int) c('taskCreationModel')->create([
                'project_id' => $pid, 'title' => $newline, 'description' => '`greeting.sh` prints its last line without a newline.',
                'creator_id' => (int) $owner['id'], 'column_id' => column_id($pid, 'Done'), 'swimlane_id' => $swimlane,
            ]);
            c('taskStatusModel')->close($tid);
        }
        say('content: ' . SAMPLE_PROJECT . ' holds ' . db()->table('tasks')->eq('project_id', $pid)->count() . ' tasks');
    } elseif ($verb === 'tidy') {
        $project = sample_project();
        if (! $project) {
            say('tidy: no sample project');
            continue;
        }
        $ids = test_account_ids();
        if (! $ids) {
            say('tidy: no default account');
            continue;
        }
        $left = db()->table('tasks')->eq('project_id', (int) $project['id'])->like('title', TEST_PREFIX . '%')->in('creator_id', $ids)->findAllByColumn('id');
        foreach ($left as $tid) {
            c('taskModel')->remove((int) $tid);
        }
        say('tidy: ' . count($left) . ' task(s) of a stopped test run removed');
    } elseif ($verb === 'list') {
        $project = sample_project();
        foreach (db()->table('users')->asc('id')->findAll() as $u) {
            $role = $project ? c('projectUserRoleModel')->getUserRole((int) $project['id'], (int) $u['id']) : '';
            say(sprintf('  %-12s %-28s %-8s %-12s %s', $u['username'], $u['email'] ?: '-', $u['is_active'] ? 'active' : 'locked', $u['role'], $role ? "{$role} of " . SAMPLE_PROJECT : 'not in ' . SAMPLE_PROJECT));
        }
        if ($project) {
            $pid = (int) $project['id'];
            say(SAMPLE_PROJECT . ': ' . db()->table('tasks')->eq('project_id', $pid)->count() . ' tasks (' . db()->table('tasks')->eq('project_id', $pid)->eq('is_active', 1)->count() . ' open)');
        } else {
            say('No sample project yet (--add-users makes it).');
        }
    } elseif ($verb === 'token') {
        $login = (string) (input()['login'] ?? '');
        $found = $login !== '' ? user($login) : null;
        if (! $found) {
            fail('token: no account ' . ($login ?: '(none on the input)') . '.');
        }
        $token = Kanboard\Core\Security\Token::getToken();
        if (! c('userModel')->update(['id' => (int) $found['id'], 'api_access_token' => $token])) {
            fail("token: no token for {$login}.");
        }
        say('TOKEN ' . $token);
    } elseif ($verb === 'counts') {
        $project = sample_project();
        if (! $project) {
            fail('counts: no sample project.');
        }
        $pid = (int) $project['id'];
        $tasks = db()->table('tasks')->eq('project_id', $pid)->findAllByColumn('id') ?: [0];
        say('tasks: ' . count(array_filter($tasks)));
        say('open tasks: ' . db()->table('tasks')->eq('project_id', $pid)->eq('is_active', 1)->count());
        say('comments: ' . db()->table('comments')->in('task_id', $tasks)->count());
        say('subtasks: ' . db()->table('subtasks')->in('task_id', $tasks)->count());
        say('assigned tasks: ' . db()->table('tasks')->eq('project_id', $pid)->neq('owner_id', 0)->count());
        say('tags on tasks: ' . db()->table('task_has_tags')->in('task_id', $tasks)->count());
        say('task links: ' . db()->table('task_has_links')->in('task_id', $tasks)->count());
        say('files: ' . db()->table('task_has_files')->in('task_id', $tasks)->count());
        say('tags: ' . db()->table('tags')->eq('project_id', $pid)->count());
        say('categories: ' . db()->table('project_has_categories')->eq('project_id', $pid)->count());
        say('project users: ' . db()->table('project_has_users')->eq('project_id', $pid)->count());
        say('users: ' . db()->table('users')->count());
    } else {
        fail("Unknown verb {$verb}.");
    }
}
