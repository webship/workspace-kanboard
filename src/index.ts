/**
 * Kanboard for Webship Workspace: a platform plugin and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites
 * folders, their functions and argparse under core/scripts/plugins/kanboard/ (with the compose file of Kanboard's
 * service, the PHP script the builder runs with Kanboard's own code in its container, on its models, and the first
 * feature of a site), and its AI items (ai/ in this package) in the folder of their kind.
 *
 * What register() adds: the tasks of a Kanboard as work items (@webship.co/workspace-tracker): the KANBOARD menu on
 * the project rows of sites and code folders that work against a Kanboard project, the list, one task, analyze, do
 * the work with the workspace's AI CLI on a branch, and, with writes on, a comment, a move on the board (or closing and
 * opening), tags, an assignee and logged time, each a person's click after a preview. And what the assistant is told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerTracker } from '@webship.co/workspace-tracker';

import { kanboardTracker } from './lib/tracker';

export { kanboardTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'kanboard';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-kanboard-project.sh', 'cmd-tools-kanboard-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['kanboard-site-builder', 'kanboard-tester', 'kanboard-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['kanboard-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['kanboard-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['kanboard-build-and-test', 'kanboard-issue-to-branch'];

/** What the assistant is told about Kanboard sites in this workspace (the tasks are told by the tracker). */
export function assistantContext(): string {
  return [
    'Kanboard (a plugin, @webship.co/workspace-kanboard), the open-source Kanban project management software: a site is built with',
    '`bash cmd-kanboard-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos):',
    'Kanboard\'s own image (1.2.58 by default, `--release`) on the project\'s own MariaDB 11.4, on DDEV at https://<name>.ddev.site; other runtimes are not proven for it yet.',
    'The builder asks for 1 GB of free memory before it starts. Kanboard\'s core only: no plugin of its directory is installed.',
    '`--install` puts the workspace account in the place of the administrator Kanboard\'s schema starts with (admin, password admin), so no default password is left; Kanboard has no sign-up;',
    '`--add-users` adds the default accounts (owner: the manager of the project Webship site, member: its member, reader: its viewer; stranger: not in it), each @example.com, logging in with its username;',
    '`--sample-content` adds its tasks #1 (Work in progress, assigned to member, category Bug, tag greeting, a comment and a subtask), #2 (Backlog) and #3 (closed).',
    '`bash cmd-tools-kanboard-cli.sh <name>` says what the site is and lists its accounts; `--run "<command>"` runs one of Kanboard\'s own console commands in its container,',
    '`--sample-content` adds the sample content later, `--tidy` removes the tasks a stopped test run left ("Webship test …"), `--add-users` and `--cancel-users` manage the default accounts,',
    'and `--connect <login>` points the dashboard\'s Kanboard at the site as that account (a new API access token in the plugin\'s settings, never shown, in the place of its earlier one).',
    'A viewer of a Kanboard project reads and changes nothing; Kanboard has no sprint; its time tracking is the subtasks\' time spent, which it adds to the task\'s.',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Kanboard step pack; `--run` runs the suite.',
    `For Kanboard sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working a task to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run Kanboard\'s tools on the host for a project; removing the project removes its database and its files too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  registerTracker(api, kanboardTracker(api));
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}
