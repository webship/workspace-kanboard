/**
 * Kanboard, as a provider of the tracker family (@webship.co/workspace-tracker): the tasks of a Kanboard project, over
 * its JSON-RPC API (/jsonrpc.php) as a person, with that person's username and API access token (HTTP Basic), in a
 * header file, never on a command line. The builder's tool makes the token with Kanboard's own code in its container
 * (--connect <login>); on your own Kanboard, My profile → API.
 *
 * A scope is a project, by its name ("Webship site"); an item is a task, by its number ("12"), which is the same on
 * the whole site: Kanboard shows it as "#12".
 *
 * Reads: the open tasks, mine, assigned to someone, and a search in the title; one task with its comments. Kanboard
 * has no sprint: no iteration view. A task's state is its column on the board (Backlog, Ready, Work in progress, Done
 * by default), and "Closed" once it is closed.
 *
 * Each author's standing is their role in the project: its managers are owners of it, its members members; a viewer,
 * who reads only, and someone the project does not have are outside, so the base keeps their tasks analyze-only unless
 * a person confirms by name. A group's role counts for its people. Each comment's author is read on their own. The last
 * editor is the person of the newest edit of the task in the project's activity ("task.update"), else its creator.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, a move to another column
 * (or closing and opening the task), tags as labels, an assignee, logged time (the worklog: a subtask done, of the
 * person, with the time spent, which Kanboard adds to the task's time spent), and a new task. Kanboard keeps Markdown,
 * and shows raw HTML in it as text. Kanboard is not a forge: the pull request of the work is opened from the project's
 * forge menu. A Kanboard API access token is 60 hexadecimal characters; the base refuses that shape, and the
 * provider's own token, in whatever is about to be posted.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import type { Person, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

/** A task: its number, with or without Kanboard's "#". */
export const ITEM_RE = /^#?([1-9][0-9]{0,9})$/;
/** A project's name, as a scope. */
const NAME_RE = /^[^\u0000-\u001f\u007f]{1,120}$/;
/** What a Kanboard API access token looks like: 60 hexadecimal characters. */
export const TOKEN_RE = /(?<![0-9a-fA-F])[0-9a-f]{60}(?![0-9a-fA-F])/;
/** How long the account, a project, its columns and its people are kept before they are asked again. */
const KEEP_MS = 5 * 60 * 1000;
/** Tags are read a task at a time: so many at once. */
const AT_ONCE = 8;

const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** A role in the project, as the base reads an author's standing. A custom role of the project is a member's. */
export function roleAssociation(role: unknown): Person['association'] {
  const r = String(role || '');
  if (r === 'project-manager') return 'owner';
  if (r === 'project-viewer' || r === '') return 'outside';
  return 'member';
}

export interface Column { id: string; title: string; position: number }

/** How a task's state reads: closed, or in the last column, is done; in the first column open; in between, work going on. */
export function stateClassOf(t: any, columns: Column[]): TrackerItem['stateClass'] {
  if (Number(t && t.is_active) === 0) return 'done';
  const ordered = columns.slice().sort((a, b) => a.position - b.position);
  const at = ordered.findIndex((c) => c.id === String(t && t.column_id));
  if (at < 0) return undefined;
  if (at === ordered.length - 1) return 'done';
  return at === 0 ? 'open' : 'doing';
}

/** A Unix time of Kanboard's, as ISO time. */
export function isoOf(seconds: unknown): string | undefined {
  const n = Number(seconds);
  return n > 0 ? new Date(n * 1000).toISOString().replace(/\.000Z$/, 'Z') : undefined;
}

/** A task of the API, as the base reads an item. */
export function itemOf(t: any, base: string, columns: Column[], people: Map<string, string>, tags: string[]): TrackerItem {
  const column = columns.find((c) => c.id === String(t.column_id));
  const owner = String(t.owner_id || '');
  const closed = Number(t.is_active) === 0;
  return {
    id: String(t.id),
    title: String(t.title || ''),
    url: `${base}/task/${t.id}`,
    state: closed ? 'Closed' : (column ? column.title : String(t.column_name || t.column_id || '')),
    stateClass: stateClassOf(t, columns),
    assignees: owner && owner !== '0' ? [people.get(owner) || String(t.assignee_name || '') || `#${owner}`] : [],
    labels: tags,
    ...(column ? { column: column.title } : {}),
    updated: isoOf(t.date_modification),
  };
}

/** What an answer of Kanboard says went wrong, in one line. */
export function saidOf(data: any): string {
  const e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') return '';
  const message = typeof e.message === 'string' ? e.message : '';
  const more = typeof e.data === 'string' ? e.data : '';
  return [message, more && more !== message ? more : ''].filter(Boolean).join(': ').slice(0, 300);
}

/** The newest edit of a task in a project's activity, the newest first as Kanboard lists it: its author's id and name. */
export function lastEditOf(activity: any[], taskId: string): { id: string; name: string } | null {
  const edit = (Array.isArray(activity) ? activity : []).find((a) => a && String(a.task_id) === String(taskId) && a.event_name === 'task.update');
  return edit ? { id: String(edit.creator_id || ''), name: String(edit.author_name || edit.author_username || '') } : null;
}

export function kanboardTracker(api: PluginApi): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const base = () => configured(settings().url).replace(/\/+$/, '');
  const username = () => configured(settings().username);
  const token = () => configured(settings().token);

  // Who is asking: the site, the account and its token, so that what is kept follows a change of any of them.
  const asker = () => crypto.createHash('sha1').update(`${base()}\n${username()}\n${token()}`).digest('hex').slice(0, 12);

  /** One call of the JSON-RPC API: the credentials and the body in files only this user reads, removed after. */
  async function rpc(method: string, params: Record<string, unknown>): Promise<any> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-kanboard-'));
    try {
      const h = path.join(dir, 'headers');
      const basic = Buffer.from(`${username()}:${token()}`).toString('base64');
      fs.writeFileSync(h, `Authorization: Basic ${basic}\nAccept: application/json\nContent-Type: application/json\n`, { mode: 0o600 });
      const b = path.join(dir, 'body.json');
      fs.writeFileSync(b, JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), { mode: 0o600 });
      const args = ['-sS', '-m', '30', '-X', 'POST', '-w', '\n%{http_code}', '-H', `@${h}`, '--data-binary', `@${b}`, `${base()}/jsonrpc.php`];
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      if (!status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = JSON.parse(at >= 0 ? out.slice(0, at) : out); } catch (_) { data = null; }
      if (status === 401) throw new Error(`Kanboard refused the username and the token (${status}): connect again with the site's tool (--connect <login>)`);
      if (status === 403) throw new Error(`Kanboard refused ${method} to this account (${status})`);
      if (status < 200 || status >= 300 || !data) throw new Error(`Kanboard answered ${status}${saidOf(data) ? `: ${saidOf(data)}` : ''}`);
      if (data.error) throw new Error(`Kanboard refused ${method}: ${saidOf(data) || 'no reason given'}`);
      return data.result;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async function write(method: string, params: Record<string, unknown>, url: string): Promise<WriteResult & { result?: any }> {
    try {
      const result = await rpc(method, params);
      return result === false || result === null ? { ok: false, error: `Kanboard did not take it (${method} answered ${String(result)})` } : { ok: true, error: '', url, result };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  // What is kept for five minutes: the token's own account, a project, its columns, its people and their roles.
  const kept = new Map<string, { at: number; value: unknown }>();
  async function keep<T>(what: string, make: () => Promise<T>): Promise<T> {
    const key = `${asker()}:${what}`;
    const hit = kept.get(key);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value as T;
    const value = await make();
    kept.set(key, { at: Date.now(), value });
    return value;
  }

  const me = () => keep('me', async () => { const u = await rpc('getMe', {}); return { id: String(u && u.id || ''), username: String(u && u.username || ''), name: String(u && (u.name || u.username) || '') }; });
  async function projectOf(scope: TrackerScope): Promise<{ id: string; name: string }> {
    return keep(`project:${scope.id}`, async () => {
      const mine = await rpc('getMyProjectsList', {});
      const hit = Object.entries(mine && typeof mine === 'object' ? mine : {}).find(([, name]) => String(name) === scope.id);
      if (hit) return { id: String(hit[0]), name: String(hit[1]) };
      // An administrator sees projects that are not theirs.
      const p = await rpc('getProjectByName', { name: scope.id }).catch(() => null);
      if (!p || !p.id) throw new Error(`no project "${scope.id}" the account of the token can open`);
      return { id: String(p.id), name: String(p.name) };
    });
  }
  const columnsOf = (scope: TrackerScope) => keep(`columns:${scope.id}`, async () => {
    const project = await projectOf(scope);
    const rows = await rpc('getColumns', { project_id: Number(project.id) });
    return (Array.isArray(rows) ? rows : []).map((c: any) => ({ id: String(c.id), title: String(c.title || ''), position: Number(c.position || 0) } as Column));
  });
  /** The people of the project (its managers, members and viewers, and its groups' people): their names by id. */
  const peopleOf = (scope: TrackerScope) => keep(`people:${scope.id}`, async () => {
    const project = await projectOf(scope);
    const rows = await rpc('getProjectUsers', { project_id: Number(project.id) });
    return new Map(Object.entries(rows && typeof rows === 'object' ? rows : {}).map(([id, name]) => [String(id), String(name)] as [string, string]));
  });
  const roleOf = (scope: TrackerScope, uid: string) => keep(`role:${scope.id}:${uid}`, async () => {
    const project = await projectOf(scope);
    return String(await rpc('getProjectUserRole', { project_id: Number(project.id), user_id: Number(uid) }) || '');
  });
  async function personOf(scope: TrackerScope, uid: unknown, fallback = ''): Promise<Person> {
    const id = String(uid || '');
    if (!id || id === '0') return { name: fallback || 'unknown', association: 'unknown' };
    const people = await peopleOf(scope);
    return { name: people.get(id) || fallback || `#${id}`, association: roleAssociation(await roleOf(scope, id)) };
  }

  /**
   * Someone the project gives tasks to, by what the person typed: "me", or their name. Their id. Kanboard gives tasks to
   * the project's managers and members: a viewer reads only.
   */
  async function assigneeBy(scope: TrackerScope, who: string): Promise<string> {
    const w = who.trim().toLowerCase();
    const project = await projectOf(scope);
    const rows = await rpc('getAssignableUsers', { project_id: Number(project.id) });
    const assignable = Object.entries(rows && typeof rows === 'object' ? rows : {}).map(([id, name]) => [String(id), String(name)] as [string, string]);
    if (w === 'me') {
      const mine = (await me()).id;
      if (!assignable.some(([id]) => id === mine)) throw new Error(`the account of the token may not be given tasks in ${scope.id}`);
      return mine;
    }
    const found = assignable.find(([id]) => id === w.replace(/^#/, '')) || assignable.find(([, name]) => name.toLowerCase() === w);
    if (found) return found[0];
    const inProject = [...(await peopleOf(scope)).entries()].find(([, name]) => name.toLowerCase() === w);
    if (inProject) throw new Error(`${who} is a viewer of ${scope.id}: Kanboard gives tasks to the project's managers and members`);
    throw new Error(`${who} is not someone ${scope.id} has`);
  }

  /** The task behind an id of the scope (its project checked), as the API gives it. */
  async function taskIn(scope: TrackerScope, id: string): Promise<any> {
    const m = ITEM_RE.exec(String(id || '').trim());
    if (!m) throw new Error(`not a task: ${id}`);
    const project = await projectOf(scope);
    // Kanboard answers 403 for a task the account may not open, and for one that is not there.
    const t = await rpc('getTask', { task_id: Number(m[1]) }).catch((e: Error) => {
      if (/\(403\)/.test(String(e.message))) throw new Error(`#${m[1]} is not a task of ${scope.id} that the account can open`);
      throw e;
    });
    if (!t || typeof t !== 'object' || String(t.project_id) !== project.id) throw new Error(`#${m[1]} is not a task of ${scope.id}`);
    return t;
  }
  async function tagsOf(taskId: string): Promise<string[]> {
    const rows = await rpc('getTaskTags', { task_id: Number(taskId) });
    return Object.values(rows && typeof rows === 'object' ? rows : {}).map((t) => String(t)).sort();
  }
  const taskUrl = (id: string) => `${base()}/task/${String(id).replace(/^#/, '')}`;
  const failed = (e: unknown): WriteResult => ({ ok: false, error: String((e as Error).message || e) });
  async function listOf(scope: TrackerScope, keepIt: (t: any) => boolean, limit: number): Promise<TrackerItem[]> {
    const project = await projectOf(scope);
    const [columns, people] = [await columnsOf(scope), await peopleOf(scope)];
    const rows = await rpc('getAllTasks', { project_id: Number(project.id), status_id: 1 });
    const chosen = (Array.isArray(rows) ? rows : []).filter((t: any) => t && t.id && keepIt(t))
      .sort((a: any, b: any) => Number(b.date_modification || 0) - Number(a.date_modification || 0))
      .slice(0, limit);
    const items: TrackerItem[] = [];
    for (let at = 0; at < chosen.length; at += AT_ONCE) {
      const part = chosen.slice(at, at + AT_ONCE);
      const tags = await Promise.all(part.map((t: any) => tagsOf(String(t.id)).catch(() => [] as string[])));
      part.forEach((t: any, n: number) => items.push(itemOf(t, base(), columns, people, tags[n])));
    }
    return items;
  }

  return {
    id: api.name,
    title: 'Kanboard',
    label: 'KANBOARD',
    noun: { one: 'task', many: 'tasks' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'query'],
      comment: true, worklog: true, transition: true, labels: true, assign: true, create: true,
      request: 'none',
    },
    idPattern: ITEM_RE,
    tokenVariables: ['KANBOARD_TOKEN', 'KANBOARD_API_TOKEN'],
    secret: () => token(),
    tokenShapes: [['a Kanboard API access token', TOKEN_RE]],
    ready: () => (!base() ? `no Kanboard address in ${api.settings.file} (url)`
      : !username() ? `no username in ${api.settings.file} (username)`
        : !token() ? `no API access token in ${api.settings.file} (token)` : ''),
    // A workspace project has no Kanboard project of its own: it remembers one, or the default is used.
    scopeOf: () => null,
    parseScope: (text) => {
      const t = String(text || '').trim();
      return NAME_RE.test(t) && base() ? { id: t, name: t, web: `${base()}/projects` } : null;
    },
    urlOf: (_scope, id) => taskUrl(id),
    account: async () => { try { return (await me()).name; } catch (_) { return ''; } },
    // The projects the token's account has.
    scopes: async () => {
      const mine = await rpc('getMyProjectsList', {});
      return Object.entries(mine && typeof mine === 'object' ? mine : {}).filter(([, name]) => NAME_RE.test(String(name)))
        .map(([id, name]) => ({ id: String(name), name: String(name), web: `${base()}/board/${id}` }));
    },

    list: async (scope, q) => {
      const limit = Math.max(1, Math.min(q.limit, 100));
      if (q.view === 'mine') { const mine = (await me()).id; return listOf(scope, (t) => String(t.owner_id || '') === mine, limit); }
      if (q.view === 'assigned') {
        if (!q.who) return [];
        const w = q.who.trim().toLowerCase();
        const uid = w === 'me' ? (await me()).id : ([...(await peopleOf(scope)).entries()].find(([id, name]) => id === w.replace(/^#/, '') || name.toLowerCase() === w) || [''])[0];
        if (!uid) throw new Error(`${q.who} is not someone ${scope.id} has`);
        return listOf(scope, (t) => String(t.owner_id || '') === uid, limit);
      }
      if (q.view === 'query') {
        const words = String(q.text || '').trim().toLowerCase();
        return listOf(scope, (t) => String(t.title || '').toLowerCase().includes(words), limit);
      }
      return listOf(scope, () => true, limit);
    },

    get: async (scope, id) => {
      const t = await taskIn(scope, id);
      const [columns, people] = [await columnsOf(scope), await peopleOf(scope)];
      const author = await personOf(scope, t.creator_id);
      // The last editor: the person of the newest edit of the task in the project's activity, when not the creator.
      const activity = await rpc('getProjectActivity', { project_id: Number(t.project_id) }).catch(() => []);
      const edit = lastEditOf(activity, String(t.id));
      const lastEditor = edit && edit.id && edit.id !== String(t.creator_id) ? await personOf(scope, edit.id, edit.name) : undefined;
      const comments = [];
      const rows = await rpc('getAllComments', { task_id: Number(t.id) });
      for (const c of (Array.isArray(rows) ? rows : []).slice().sort((a: any, b: any) => Number(a.date_creation || 0) - Number(b.date_creation || 0))) {
        const body = String(c.comment || '').trim();
        if (body) comments.push({ author: await personOf(scope, c.user_id, String(c.name || c.username || '')), body, at: isoOf(c.date_creation) || '' });
      }
      const full: TrackerItemFull = { ...itemOf(t, base(), columns, people, await tagsOf(String(t.id))), body: String(t.description || ''), author, ...(lastEditor ? { lastEditor } : {}), comments };
      return full;
    },

    comment: async (scope, id, markdown) => {
      try {
        const t = await taskIn(scope, id);
        return await write('createComment', { task_id: Number(t.id), user_id: Number((await me()).id), content: String(markdown || '') }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    // Logged time, as Kanboard keeps it: a subtask of the person, done, with the time spent; Kanboard adds it to the task's.
    worklog: async (scope, id, entry) => {
      try {
        const t = await taskIn(scope, id);
        const minutes = Math.round(Number(entry.minutes));
        if (!(minutes > 0 && minutes <= 24 * 60)) return { ok: false, error: 'the time is a number of minutes, more than none and at most a day' };
        const title = String(entry.text || '').trim().slice(0, 200);
        if (!title) return { ok: false, error: 'a line of what was done names the time' };
        return await write('createSubtask', { task_id: Number(t.id), title, user_id: Number((await me()).id), time_spent: Math.round((minutes / 60) * 100) / 100, status: 2 }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    transitions: async (scope, id) => {
      const t = await taskIn(scope, id);
      const columns = (await columnsOf(scope)).slice().sort((a, b) => a.position - b.position);
      const moves = Number(t.is_active) === 0 ? [] : columns.filter((c) => c.id !== String(t.column_id)).map((c) => ({ id: `column:${c.id}`, name: c.title }));
      return [...moves, Number(t.is_active) === 0 ? { id: 'open', name: 'Open the task again' } : { id: 'close', name: 'Close the task' }];
    },
    transition: async (scope, id, to) => {
      try {
        const t = await taskIn(scope, id);
        const url = taskUrl(String(t.id));
        if (to === 'close') return await write('closeTask', { task_id: Number(t.id) }, url);
        if (to === 'open') return await write('openTask', { task_id: Number(t.id) }, url);
        const column = /^column:(\d+)$/.exec(String(to));
        if (!column || !(await columnsOf(scope)).some((c) => c.id === column[1])) return { ok: false, error: `not a column of ${scope.id}: ${to}` };
        if (Number(t.is_active) === 0) return { ok: false, error: `#${t.id} is closed: open it again before it moves on the board` };
        return await write('moveTaskPosition', { project_id: Number(t.project_id), task_id: Number(t.id), column_id: Number(column[1]), position: 1, swimlane_id: Number(t.swimlane_id) }, url);
      } catch (e) { return failed(e); }
    },
    labels: async (scope, id, add, remove) => {
      try {
        const t = await taskIn(scope, id);
        const now = await tagsOf(String(t.id));
        const gone = new Set(remove.map((r) => r.trim().toLowerCase()));
        const tags = [...now.filter((x) => !gone.has(x.toLowerCase())), ...add.map((a) => a.trim()).filter((a) => a && !now.some((x) => x.toLowerCase() === a.toLowerCase()))];
        return await write('setTaskTags', { project_id: Number(t.project_id), task_id: Number(t.id), tags }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    assign: async (scope, id, who) => {
      try {
        const t = await taskIn(scope, id);
        const uid = await assigneeBy(scope, who);
        return await write('updateTask', { id: Number(t.id), owner_id: Number(uid) }, taskUrl(String(t.id)));
      } catch (e) { return failed(e); }
    },
    create: async (scope, item) => {
      try {
        const project = await projectOf(scope);
        const r = await write('createTask', { title: String(item.title || ''), project_id: Number(project.id), description: String(item.body || ''), creator_id: Number((await me()).id) }, '');
        if (!r.ok) return r;
        const tid = Number(r.result) > 0 ? String(r.result) : '';
        return tid ? { ok: true, error: '', url: taskUrl(tid), id: tid } : { ok: false, error: 'Kanboard made no task (createTask answered no number)' };
      } catch (e) { return failed(e); }
    },
  };
}
