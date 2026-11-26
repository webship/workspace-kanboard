import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { isoOf, itemOf, ITEM_RE, kanboardTracker, lastEditOf, roleAssociation, saidOf, stateClassOf, TOKEN_RE } from '../src/lib/tracker';

// Recorded from a Kanboard 1.2.58 site the plugin's builder made (--install --add-users --sample-content), read through
// its API as the account member (tools/kb-record-fixtures.py in the trackers round), the site's address made
// https://kanboard.test and every token taken out. Webship site (project 1): owner (user 2) is its manager, member (3)
// a member, reader (4) a viewer; stranger (5) and the administrator (1) are not in it. Its columns are Backlog, Ready,
// Work in progress and Done. #1 and #2 are open, #3 is closed.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, `${f}.json`), 'utf8'));
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = 'a1b2c3d4e5'.repeat(6);
const SETTINGS = { url: 'https://kanboard.test', username: 'member', token: TOKEN, default_scope: 'Webship site' };
const SCOPE = { id: 'Webship site', name: 'Webship site', web: 'https://kanboard.test/projects' };
const TASKS: Record<string, string> = { 1: 'task-1', 2: 'task-2', 3: 'task-3' };

/** What a curl call asked: its JSON-RPC method and parameters, and its headers file. */
function readCurl(args: string[]) {
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const body = bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : {};
  return { args, url: args[args.length - 1], method: String(body.method || ''), params: body.params || {}, headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '' };
}

/** The answer the recorded site gives to a call: [status, body]. */
function recorded(c: ReturnType<typeof readCurl>): [number, unknown] {
  const ok = (result: unknown): [number, unknown] => [200, { jsonrpc: '2.0', id: 1, result }];
  const p = c.params;
  switch (c.method) {
    case 'getMe': return ok(fixture('me'));
    case 'getMyProjectsList': return ok(fixture('projects'));
    case 'getColumns': return ok(fixture('columns'));
    case 'getProjectUsers': return ok(fixture('project-users'));
    case 'getAssignableUsers': return ok(fixture('assignable'));
    case 'getProjectUserRole': return ok(fixture('roles')[String(p.user_id)] ?? '');
    case 'getAllTasks': return ok(Number(p.status_id) === 1 ? fixture('tasks-open') : []);
    case 'getTask': return TASKS[String(p.task_id)] ? ok(fixture(TASKS[String(p.task_id)])) : [403, { jsonrpc: '2.0', id: null, error: { code: 403, message: 'Forbidden' } }];
    case 'getTaskTags': return ok(fixture(`tags-${p.task_id}`));
    case 'getAllComments': return ok(fixture(`comments-${p.task_id}`));
    case 'getProjectActivity': return ok(fixture('activity'));
    case 'createTask': return ok(9);
    case 'createComment': case 'createSubtask': return ok(7);
    case 'moveTaskPosition': case 'closeTask': case 'openTask': case 'setTaskTags': case 'updateTask': return ok(true);
    default: return [200, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }];
  }
}

/** A provider over the recordings, with what each call asked. */
function provider(settings: Record<string, unknown> = SETTINGS, answer = recorded) {
  const calls: ReturnType<typeof readCurl>[] = [];
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kanboard-tracker-'));
  made.push(home);
  const api: any = {
    name: 'kanboard',
    settings: { read: () => settings, file: 'core/config/plugin.kanboard.settings.yml' },
    lib: {
      run: async (cmd: string, args: string[]) => {
        assert.strictEqual(cmd, 'curl');
        const c = readCurl(args);
        calls.push(c);
        const [status, body] = answer(c);
        return { ok: true, code: 0, stdout: `${JSON.stringify(body)}\n${status}`, stderr: '' };
      },
      cliError: (s: string) => s,
    },
  };
  return { p: kanboardTracker(api), calls };
}

test('roles, states, times and numbers, as Kanboard gives them', () => {
  assert.deepStrictEqual(['project-manager', 'project-member', 'project-viewer', '', null, 'Developer'].map(roleAssociation), ['owner', 'member', 'outside', 'outside', 'outside', 'member'], 'a custom role of the project is a member\'s');
  const columns = (fixture('columns') as any[]).map((c) => ({ id: String(c.id), title: c.title, position: c.position }));
  assert.deepStrictEqual([1, 2, 3, 4].map((col) => stateClassOf({ is_active: 1, column_id: col }, columns)), ['open', 'doing', 'doing', 'done']);
  assert.strictEqual(stateClassOf({ is_active: 0, column_id: 1 }, columns), 'done', 'closed is done, wherever it is');
  assert.strictEqual(isoOf(1795671717), '2026-11-26T05:41:57Z');
  assert.strictEqual(isoOf(0), undefined);
  for (const id of ['#12', '12']) assert.strictEqual(ITEM_RE.exec(id)?.[1], '12', id);
  for (const id of ['0', 'WEB-12', '#', '12a', '-1']) assert.strictEqual(ITEM_RE.test(id), false, id);
  assert.ok(TOKEN_RE.test(TOKEN), 'a Kanboard API access token');
  assert.strictEqual(TOKEN_RE.test('0123456789abcdef0123456789abcdef01234567'), false, 'a commit is no token');
  assert.strictEqual(TOKEN_RE.test('f'.repeat(64)), false, 'a SHA-256 is no token');
  assert.strictEqual(saidOf({ error: { code: 403, message: 'Forbidden' } }), 'Forbidden');
  assert.strictEqual(saidOf(null), '');
});

test('the last editor is the newest edit of the task in the project\'s activity', () => {
  assert.strictEqual(lastEditOf(fixture('activity'), '1'), null, 'the sample tasks were made and commented on, never edited');
  const edited = [{ event_name: 'task.update', creator_id: 2, author_name: 'Owner Test', task_id: 2 }, { event_name: 'task.update', creator_id: 3, author_name: 'Member Test', task_id: 2 }, ...fixture('activity')];
  assert.deepStrictEqual(lastEditOf(edited, '2'), { id: '2', name: 'Owner Test' }, 'the newest first, as Kanboard lists it');
  assert.strictEqual(lastEditOf([{ event_name: 'task.move.column', creator_id: 2, task_id: 2 }], '2'), null, 'a move is not an edit');
});

test('the provider: ready, its scope, its capabilities and the address of a task', async () => {
  const { p } = provider();
  assert.strictEqual(p.ready(), '');
  assert.match(provider({ username: 'member', token: TOKEN }).p.ready(), /no Kanboard address/);
  assert.match(provider({ url: 'https://kanboard.test', token: TOKEN }).p.ready(), /no username/);
  assert.match(provider({ url: 'https://kanboard.test', username: 'member', token: 'CHANGE_ME' }).p.ready(), /no API access token/);
  assert.deepStrictEqual(p.parseScope('Webship site'), SCOPE);
  assert.strictEqual(p.parseScope('bad\u0007name'), null);
  assert.deepStrictEqual(p.capabilities, { views: ['open', 'mine', 'assigned', 'query'], comment: true, worklog: true, transition: true, labels: true, assign: true, create: true, request: 'none' });
  assert.strictEqual(p.urlOf(SCOPE, '#1'), 'https://kanboard.test/task/1');
  assert.deepStrictEqual(await p.scopes!(), [{ id: 'Webship site', name: 'Webship site', web: 'https://kanboard.test/board/1' }]);
  assert.strictEqual(await p.account!(), 'Member Test');
});

test('the views: open, mine, assigned and a search; a task\'s state is its column', async () => {
  const { p, calls } = provider();
  const open = await p.list(SCOPE, { view: 'open', limit: 20 });
  assert.deepStrictEqual(open.map((i) => `${i.id} ${i.state} ${i.stateClass}`).sort(), ['1 Work in progress doing', '2 Backlog open']);
  const greeting = open.find((i) => i.id === '1')!;
  assert.deepStrictEqual({ ...greeting, updated: undefined }, {
    id: '1', title: 'The greeting script says Helo instead of Hello', url: 'https://kanboard.test/task/1',
    state: 'Work in progress', stateClass: 'doing', assignees: ['Member Test'], labels: ['greeting'], column: 'Work in progress', updated: undefined,
  });
  assert.match(String(greeting.updated), /^2026-11-26T\d\d:\d\d:\d\dZ$/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'mine', limit: 20 })).map((i) => i.id), ['1'], 'member has the greeting');
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'assigned', who: 'Member Test', limit: 20 })).map((i) => i.id), ['1']);
  assert.deepStrictEqual(await p.list(SCOPE, { view: 'assigned', limit: 20 }), []);
  await assert.rejects(p.list(SCOPE, { view: 'assigned', who: 'nobody', limit: 20 }), /nobody is not someone Webship site has/);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'query', text: 'GRETING', limit: 20 })).map((i) => i.id), ['2']);
  assert.deepStrictEqual((await p.list(SCOPE, { view: 'open', limit: 1 })).length, 1, 'the limit');
  assert.ok(calls.filter((c) => c.method === 'getAllTasks').every((c) => c.params.project_id === 1 && c.params.status_id === 1), 'the project, its open tasks');
  // The username and the token travel in a header file, never on curl's command line.
  const basic = Buffer.from(`member:${TOKEN}`).toString('base64');
  assert.ok(calls.every((c) => c.headers.includes(`Authorization: Basic ${basic}`) && !c.args.join(' ').includes(TOKEN) && !c.args.join(' ').includes(basic)));
  assert.ok(calls.every((c) => c.url === 'https://kanboard.test/jsonrpc.php'));
});

test('one task: its author and each comment\'s author by their role in the project; the last editor from its activity', async () => {
  const { p } = provider();
  const greeting = await p.get(SCOPE, '#1');
  assert.deepStrictEqual(greeting.author, { name: 'Owner Test', association: 'owner' }, 'the project\'s manager');
  assert.strictEqual(greeting.lastEditor, undefined, 'never edited');
  assert.strictEqual(greeting.body, '`greeting.sh` prints *Helo* where it should print *Hello*.', 'Kanboard keeps Markdown');
  assert.deepStrictEqual(greeting.labels, ['greeting']);
  assert.deepStrictEqual(greeting.comments.map((c) => [c.author, c.body, c.at]), [[{ name: 'Owner Test', association: 'owner' }, 'Seen on the test site: the greeting prints Helo.', '2026-11-26T05:41:57Z']]);
  assert.deepStrictEqual((await p.get(SCOPE, '2')).author, { name: 'Member Test', association: 'member' });
  const closed = await p.get(SCOPE, '3');
  assert.deepStrictEqual([closed.state, closed.stateClass, closed.column], ['Closed', 'done', 'Done']);
  // Someone the project has as a viewer now is outside; an edit by another person is the last edit.
  const changed = (c: ReturnType<typeof readCurl>): [number, unknown] => {
    if (c.method === 'getProjectUserRole' && c.params.user_id === 3) return [200, { jsonrpc: '2.0', id: 1, result: 'project-viewer' }];
    if (c.method === 'getProjectActivity') return [200, { jsonrpc: '2.0', id: 1, result: [{ event_name: 'task.update', creator_id: 2, author_name: 'Owner Test', task_id: 2 }] }];
    return recorded(c);
  };
  const usage = await provider(SETTINGS, changed).p.get(SCOPE, '2');
  assert.deepStrictEqual([usage.author, usage.lastEditor], [{ name: 'Member Test', association: 'outside' }, { name: 'Owner Test', association: 'owner' }]);
  await assert.rejects(p.get(SCOPE, '9'), /#9 is not a task of Webship site that the account can open/);
  await assert.rejects(p.get(SCOPE, 'WEB-1'), /not a task: WEB-1/);
  const elsewhere = provider(SETTINGS, (c) => (c.method === 'getTask' ? [200, { jsonrpc: '2.0', id: 1, result: { ...fixture('task-1'), project_id: 7 } }] : recorded(c))).p;
  await assert.rejects(elsewhere.get(SCOPE, '1'), /#1 is not a task of Webship site/);
});

test('the writes: a comment, a move on the board, closing, tags, an assignee, logged time and a new task, as the person', async () => {
  const { p, calls } = provider();
  const last = (m: string) => calls.filter((c) => c.method === m).pop()!;
  assert.deepStrictEqual(await p.comment!(SCOPE, '#1', 'Fixed in `greeting.sh` <b>now</b>'), { ok: true, error: '', url: 'https://kanboard.test/task/1', result: 7 });
  assert.deepStrictEqual(last('createComment').params, { task_id: 1, user_id: 3, content: 'Fixed in `greeting.sh` <b>now</b>' }, 'Markdown, as Kanboard keeps it; it shows raw HTML as text');
  assert.deepStrictEqual((await p.transitions!(SCOPE, '1')).map((t) => `${t.id}=${t.name}`), ['column:1=Backlog', 'column:2=Ready', 'column:4=Done', 'close=Close the task'], 'the other columns, and closing');
  assert.deepStrictEqual((await p.transitions!(SCOPE, '3')).map((t) => t.id), ['open'], 'a closed task opens again first');
  assert.strictEqual((await p.transition!(SCOPE, '1', 'column:4')).ok, true);
  assert.deepStrictEqual(last('moveTaskPosition').params, { project_id: 1, task_id: 1, column_id: 4, position: 1, swimlane_id: 1 });
  assert.match((await p.transition!(SCOPE, '1', 'column:99')).error, /not a column of Webship site: column:99/);
  assert.match((await p.transition!(SCOPE, '3', 'column:2')).error, /#3 is closed: open it again/);
  assert.strictEqual((await p.transition!(SCOPE, '1', 'close')).ok, true);
  assert.deepStrictEqual(last('closeTask').params, { task_id: 1 });
  assert.strictEqual((await p.transition!(SCOPE, '3', 'open')).ok, true);
  assert.strictEqual((await p.labels!(SCOPE, '1', ['docs', 'GREETING'], [])).ok, true);
  assert.deepStrictEqual(last('setTaskTags').params, { project_id: 1, task_id: 1, tags: ['greeting', 'docs'] }, 'a tag once, whatever its case; Kanboard makes a new one');
  assert.strictEqual((await p.labels!(SCOPE, '1', [], ['greeting'])).ok, true);
  assert.deepStrictEqual(last('setTaskTags').params.tags, []);
  assert.strictEqual((await p.assign!(SCOPE, '2', 'me')).ok, true);
  assert.deepStrictEqual(last('updateTask').params, { id: 2, owner_id: 3 });
  assert.strictEqual((await p.assign!(SCOPE, '2', 'Owner Test')).ok, true);
  assert.deepStrictEqual(last('updateTask').params, { id: 2, owner_id: 2 });
  assert.match((await p.assign!(SCOPE, '2', 'Reader Test')).error, /Reader Test is a viewer of Webship site: Kanboard gives tasks to the project's managers and members/);
  assert.match((await p.assign!(SCOPE, '2', 'Stranger Test')).error, /Stranger Test is not someone Webship site has/);
  assert.strictEqual((await p.worklog!(SCOPE, '1', { minutes: 90, text: 'Checked on the test site' })).ok, true);
  assert.deepStrictEqual(last('createSubtask').params, { task_id: 1, title: 'Checked on the test site', user_id: 3, time_spent: 1.5, status: 2 }, 'a subtask of the person, done, with the time');
  assert.match((await p.worklog!(SCOPE, '1', { minutes: 0, text: 'x' })).error, /more than none and at most a day/);
  assert.deepStrictEqual(await p.create!(SCOPE, { title: 'Webship test new', body: 'A **new** one' }), { ok: true, error: '', url: 'https://kanboard.test/task/9', id: '9' });
  assert.deepStrictEqual(last('createTask').params, { title: 'Webship test new', project_id: 1, description: 'A **new** one', creator_id: 3 });
  // A refusal of Kanboard's is said as it gave it, and a call it did not take is said so.
  const refused = provider(SETTINGS, (c) => (c.method === 'createComment' ? [200, { jsonrpc: '2.0', id: 1, result: false }] : recorded(c))).p;
  assert.match((await refused.comment!(SCOPE, '1', 'x')).error, /Kanboard did not take it \(createComment answered false\)/);
  const expired = provider(SETTINGS, () => [401, 'Not Authorized']).p;
  await assert.rejects(expired.list(SCOPE, { view: 'open', limit: 5 }), /refused the username and the token \(401\): connect again/);
  assert.ok(calls.every((c) => !c.args.join(' ').includes(TOKEN)), 'the token never on a command line');
});

test('an item of the list is built from a task of the API', () => {
  const columns = (fixture('columns') as any[]).map((c) => ({ id: String(c.id), title: c.title, position: c.position }));
  const item = itemOf({ id: 8, title: 'T', column_id: 2, owner_id: 9, is_active: 1, date_modification: 0 }, 'https://kanboard.test', columns, new Map(), ['x']);
  assert.deepStrictEqual(item, { id: '8', title: 'T', url: 'https://kanboard.test/task/8', state: 'Ready', stateClass: 'doing', assignees: ['#9'], labels: ['x'], column: 'Ready', updated: undefined });
});
