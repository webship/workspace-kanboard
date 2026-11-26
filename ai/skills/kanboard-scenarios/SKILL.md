---
name: kanboard-scenarios
description: Write webship-js scenarios for a Kanboard site (the open-source Kanban project management software) of the Webship Workspace from phrases that exist — the Kanboard step pack's steps by area (logging in and out and a refused login, a project's board and who may open it, its columns and list, one task open or closed with its comments, tags, category, assignee, subtasks and maker, a move on the board, a new task, what a viewer of the project or someone it does not have may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Kanboard site, or when a scenario of the site fails on a phrase.
---

# kanboard-scenarios

Scenarios for a site built with the Kanboard plugin (`bash cmd-kanboard-project.sh <site> --install --add-users
--sample-content`) in a container-based workspace (DDEV by default), tested with webship-js and
`@webship-js/kanboard-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase below exists in
the pack or in webship-js; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (the manager of Webship site), `member` (a member),
  `reader` (a viewer), `stranger` (not in the project). `Given I am not logged in` for a visitor.
- The accounts are made by the build (`cmd-tools-kanboard-cli.sh <site> --add-users`); a suite never creates or
  deletes one, and never writes a password: it logs in by the handle. Each logs in with its username (`member`) and
  shows as its name (`Member Test`).

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member" with the password "…"`, `the login should be refused with "Bad username or password"`, `I am not logged in`, `I log out`, `I should be logged in as "Member Test"` (or the username), `I should not be logged in` |
| Projects | `I open the project "Webship site"` (its board), `I should be refused the project "Webship site"` |
| Test content | `there is a task "Webship test …" in the project "Webship site"` (it goes after the scenario), `there is no task "Webship test …" in the project "Webship site"` |
| The board and the list | `the column "Work in progress" should list the task "…"` (`should not list`), `I open the list of the project "Webship site"`, `the task list should show "…"` (`should not show`), `I create a task "Webship test …" in the project "Webship site"` (through the board's "Add a new task", it goes after the scenario) |
| One task | `I open the task "…"` (its title, or its number "#1"), `I move the task to the column "Ready"`, `the task should be in the column "Ready"`, `I close the task`, `I open the task again`, `the task should be closed` (`should be open`), `I add the comment "…" to the task`, `the task should show the comment "…"` (`… by "Member Test"`), `I add the tag "greeting" to the task`, `the task should have the tag "greeting"`, `I set the category of the task to "Bug"`, `the task should be in the category "Bug"`, `I assign the task to "Owner Test"`, `the task should be assigned to "Owner Test"`, `I add the subtask "…" to the task`, `the task should have the subtask "…"`, `the task should be created by "Owner Test"` |
| What an account may not do | `I should not be able to change the task`, `I should not be able to comment on the task`, `I should not be able to create a task in the project "Webship site"`, `I should be refused the task "…"`, `I should be refused the project "Webship site"` |

## The sample content

`--sample-content` gives Webship site, managed by owner, with member (a member) and reader (a viewer), a category
"Bug", a tag "greeting" and three tasks: "The greeting script says Helo instead of Hello" (#1, by owner, in Work in
progress, priority 3, category Bug, tagged greeting, assigned to member, with owner's comment "Seen on the test site:
the greeting prints Helo." and member's subtask "Fix the spelling in greeting.sh"), "The usage line spells greeting as
greting" (#2, by member, in Backlog) and "The greeting script ends without a newline" (#3, by owner, closed, in Done:
the board and the list leave it out). A suite reads them and never changes them.

## Traps found on real sites

- A task's page has its actions in its sidebar ("Edit the task", "Add a comment", "Move position", "Close this task"),
  each opening a window over the page: the steps work in that window and wait for it to close.
- The Comments part of a task's page is folded away while it has no comment: the steps comment through the sidebar's
  "Add a comment".
- A closed task is not on the board and not in the list (they show the open tasks): read it on its own page.
- Tags are chosen in a field that offers the tags of the project and a new one: the steps take the project's tag of
  that name, and Kanboard makes one that is not there yet.
- A viewer gets the task without its sidebar's actions and the board without "Add a new task"; an account the project
  does not have gets "Access Forbidden" (403): tag those scenarios `@js-off`.
- After three wrong passwords in a row for one account, Kanboard asks for a captcha too; a right login starts the count
  again.
- A run that was stopped half way leaves its "Webship test …" tasks: `bash cmd-tools-kanboard-cli.sh <site> --tidy`
  removes them.

## Whole features

`examples/` holds three features that pass on a site built with `--install --add-users --sample-content`: the session
(`session.feature`), a task worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each role may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).
