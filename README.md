# @webship.co/workspace-kanboard

Kanboard, the open-source Kanban project management software, for the
[Webship Workspace](https://github.com/webship/workspace), a container-based workspace (DDEV by default). The plugin
brings:

- **a builder**, `cmd-kanboard-project.sh`: a real Kanboard site from Kanboard's own image on the project's own
  MariaDB, on DDEV, with the workspace account in the place of the administrator Kanboard starts with, the default
  accounts in their roles of a sample project, and its tasks in the board's columns, a category, a tag, a comment and a
  subtask;
- **a tool**, `cmd-tools-kanboard-cli.sh`: what a site is and its accounts, Kanboard's own console commands in its
  container, the default accounts, the sample content, a clean-up after a stopped test run, and the dashboard's
  connection;
- **the step pack** [`@webship-js/kanboard-steps`](https://github.com/webship/kanboard-steps) wired into the
  workspace's testing setup, with a first feature for a site;
- **the tasks as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): the KANBOARD menu on a project row
  lists them, reads one, analyzes it, and lets the workspace's AI CLI work it on a branch, with a person in charge;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

Kanboard's core only: the plugin installs none of the third-party plugins of its directory.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-kanboard
bash core/scripts/plugins.sh --activate kanboard --with-needs
bash core/scripts/plugins.sh --install kanboard --with-needs
bash core/scripts/plugins.sh --configure kanboard
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- DDEV, the container runtime Kanboard is proven on so far. Docker Compose, Podman and Kubernetes are not proven for it
  yet: asked for one, the builder says so and changes nothing.
- A download of about 35 MB for Kanboard's image the first time, and memory: the builder asks for 1 GB free before it
  starts (`free -m`).

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-kanboard-project.sh mysite --install --add-users --sample-content
```

| Flag | What it does |
| --- | --- |
| `--install` | Puts the workspace account (`account` of `core/config/settings.yml`) in the place of the administrator Kanboard's schema starts with (`admin`, password `admin`), so no default password is left. Kanboard asks a password of at least six characters |
| `--add-users` | With `--install`: the default accounts, in their roles of the project Webship site |
| `--sample-content` | With `--install --add-users`: three tasks of Webship site in the board's columns, one of them closed, a category, a tag, a comment and a subtask |
| `--release <X.Y.Z>` | The release of Kanboard's image (tagged `v<X.Y.Z>`): 1.2.58 by default |
| `--runtime ddev` | DDEV, the runtime proven for Kanboard so far (the default, or `container.runtime` of `settings.yml`) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database and its files. Kanboard's own image
(`kanboard/kanboard`: nginx and PHP in one container) is a service of a generic project, on the project's MariaDB 11.4,
at `https://mysite.ddev.site`. What Kanboard keeps beside its database (attachments, avatars, its cache) and its
plugins folder are in volumes named after the project, which go with it. The project's web container keeps the mail
catcher, at `https://mysite.ddev.site:8026`, where the site's mail goes. Kanboard has no sign-up: an administrator
makes the accounts.

| Image | What it is | Source and licence |
| --- | --- | --- |
| `docker.io/kanboard/kanboard:v1.2.58` | Kanboard: its web server, PHP and Kanboard (`--release` picks another tag) | [kanboard/kanboard](https://github.com/kanboard/kanboard), MIT |

**The database is MariaDB.** Kanboard supports SQLite, MySQL, MariaDB and PostgreSQL; the Workspace uses MariaDB 11.4,
so a site's database is the same on every runtime the Workspace has. Kanboard makes its tables on its first request.

**How the accounts are made.** The builder's site script runs in Kanboard's container with Kanboard's own code
(on its models: `kanboard/kanboard-site.php` of the project) and makes the accounts as Kanboard's own
forms would, a password hashed by Kanboard's own model. The passwords come on the script's input, never on a command
line, never in a log. `--install` puts the workspace account in the place of the administrator Kanboard's schema
starts with, so no account with the password `admin` is left.

The site's own values (the address and the project's database) are kept in `kanboard/env` of the project, which only
you can read. The builder never prints them.

**Failed logins.** Kanboard asks for a captcha after three wrong passwords in a row for an account, and locks the
account for 15 minutes after six; a right login starts the count again. A test suite tries one wrong password at a
time, so a site the workspace builds keeps Kanboard's own settings.

### The default accounts

| Account | Name | Their role in Webship site |
| --- | --- | --- |
| `owner` | Owner Test | Its manager (and a manager of projects on the site) |
| `member` | Member Test | A member |
| `reader` | Reader Test | A viewer: reads, and changes nothing |
| `stranger` | Stranger Test | None: the project does not have them |

Each has the password of the workspace's other default lists, `dD.123123ddd`, logs in with its username, and shows as
its name. They are configuration: a test suite never creates or deletes one. `bash cmd-tools-add-users.sh mysite
kanboard` and `bash cmd-tools-cancel-users.sh mysite kanboard` (the row's Tests menu) add them and keep them from
logging in.

### The sample content

Webship site (identifier `WEB`), managed by owner, with member and reader, the category Bug and the tag greeting:
"The greeting script says Helo instead of Hello" (#1, by owner, in Work in progress, priority 3, in Bug, tagged
greeting, assigned to member, with owner's comment and member's subtask "Fix the spelling in greeting.sh"), "The usage
line spells greeting as greting" (#2, by member, in Backlog) and "The greeting script ends without a newline" (#3, by
owner, closed, in Done). The builder makes them with Kanboard's own code, as their authors: its activity says who did
what.

## The tool

```bash
bash cmd-tools-kanboard-cli.sh mysite                                 # what the site is: release, address, accounts
bash cmd-tools-kanboard-cli.sh mysite --run "version"                 # one of Kanboard's own console commands, in its container
bash cmd-tools-kanboard-cli.sh mysite --sample-content                # the sample content, where it is missing
bash cmd-tools-kanboard-cli.sh mysite --tidy                          # what a stopped test run left
bash cmd-tools-kanboard-cli.sh mysite --add-users                     # the default accounts, their passwords and roles back
bash cmd-tools-kanboard-cli.sh mysite --cancel-users                  # keep them from logging in
bash cmd-tools-kanboard-cli.sh mysite --connect member                # the dashboard reads this site as member
```

`--connect <login>` makes a new API access token of the account with Kanboard's own code (in the place of its earlier
one, as My profile → API does), and writes it, with the account's username and the site's address, into
`core/config/plugin.kanboard.settings.yml`, and the sample project as the default one when none was set. The token is
never shown. The dashboard then acts as that person.

`--tidy` deletes for good, with no way back. It removes the tasks a stopped test run left: titled "Webship test …",
made by one of the default accounts in Webship site, by Kanboard's own removal, with what it keeps of them (comments,
subtasks, tags, links, files), and the project's tags titled "Webship test …" that no task has (Kanboard keeps a tag a
test made). A task with another title ("Webship testing plan") or another author stays, and so does everything of
other people.

## The tasks as work items

The plugin is a provider of the tracker family. With a Kanboard address, a username and an API access token in its
settings (`--connect` writes them for a site the workspace built; for your own Kanboard, My profile → API), the project
rows of sites and code folders carry the **KANBOARD** menu, once they have a Kanboard project to work against
(`default_scope` as the project's name, `Webship site`, or one remembered from the list):

- **The list**: the open tasks, mine, assigned to someone, and a search in the title. A task's state is its column on
  the board (Backlog, Ready, Work in progress, Done by default), and Closed once it is closed. Kanboard has no sprint:
  there is no iteration view.
- **One task** (`#12`, or `12`: a number the whole site shares): its text, its author with their standing, its tags
  and its comments.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the default branch of
  the project's remote, in a screen session you watch. The task is saved as data, never as instructions; Kanboard
  keeps Markdown, and raw HTML in it stays as it was written.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true`): a comment, a move to another column (or closing the task, and opening it
  again), tags (Kanboard makes a tag that is not there yet), an assignee (`me`, or one of the project's managers or
  members, by their name), logged time and a new task, each your click after a preview. Logged time is a subtask of
  the person, done, with the time spent: Kanboard's time tracking keeps time on subtasks, and adds it to the task's.
  The text the dashboard writes is Markdown, as Kanboard keeps it.

**Who is inside.** Each person's standing is their role in the project: its managers are owners of it, its members
members; a custom role of the project is a member's. A viewer, who reads only, and someone the project does not have
are outside. A group's role counts for its people. A task made, or last edited, by someone outside is analyze only
unless you confirm it by its author's name (`outsider_items: refuse` refuses it), and each comment's author counts on
their own.

**The last editor** is the person of the task's newest edit in the project's activity, else its creator.

**Credentials.** The username and the token travel in a file only you can read, never on a command line. Before
anything is posted, the text is checked for credentials: the ones the tracker family knows, the token of the settings,
and anything shaped like a Kanboard API access token (60 hexadecimal characters).

Kanboard opens no pull request: push the branch and open its pull request from the project's forge menu (GITHUB,
GITLAB) when its remote is on a forge.

### Settings

`core/config/plugin.kanboard.settings.yml` (Settings → Plugins → Kanboard):

| Key | What it is |
| --- | --- |
| `url` | The Kanboard address, without a trailing slash |
| `username` | The username of the account the dashboard reads (and, with writes on, writes) as |
| `token` | The API access token of that account. Never printed |
| `allow_writes` | Comments, moves on the board, closing and opening, tags, assignees, logged time and new tasks to Kanboard; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The Kanboard project a workspace project works against when it remembers none: its name, `Webship site` |
| `scopes` | The Kanboard projects (their names) the list may be switched to; empty is any project the account has |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved task keeps: `members` (the project's managers and members), `all`, `none` |
| `outsider_items` | A task from outside the project: `analyze` (work it only after a confirmation by name) or `refuse` |

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/kanboard-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's own API), the project of the steps
(`Webship site`), the users registry (`owner`, `member`, `reader`, `stranger`, each logging in with its username), and
`tests/features/site.feature`, whose first scenario checks the site opens on its login form. The suite leaves the site
as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `kanboard-site-builder` | Build, look after and remove Kanboard sites |
| Agent | `kanboard-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `kanboard-issue-worker` | Work a task on a branch, the writes left to a person |
| Skill | `kanboard-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/kanboard-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `kanboard-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `kanboard-issue-to-branch` | Work a task on a branch |

## License

ISC (see `LICENSE`). Kanboard itself is MIT: the plugin runs Kanboard's own image and carries none of its code.
