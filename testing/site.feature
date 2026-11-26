@site
Feature: The board of the site
  A first feature of a Kanboard site of the Webship Workspace, placed by the testing setup: the site opens on its
  login form, a member reads the sample project's board, and works a task of its own, which goes after the scenario.
  It passes on a site built with --install --add-users --sample-content; add your own features beside it.

  # A visitor is sent to the login form: Kanboard has no sign-up.
  Scenario: The site opens on its login form
    Given I am not logged in
    When I go to the homepage
    Then I should see "Username"
    And I should see "Forgot password?"

  Scenario: A member reads the sample project's board
    Given I am a logged in user with the "member" user
    When I open the project "Webship site"
    Then the column "Work in progress" should list the task "The greeting script says Helo instead of Hello"
    And the column "Backlog" should list the task "The usage line spells greeting as greting"

  Scenario: A member works a task of its own
    Given there is a task "Webship test site" in the project "Webship site"
    And I am a logged in user with the "member" user
    When I open the task "Webship test site"
    And I add the comment "Checked on the test site" to the task
    And I move the task to the column "Ready"
    Then the task should show the comment "Checked on the test site" by "Member Test"
    And the task should be in the column "Ready"

  @js-off
  Scenario: An account the project does not have is refused it
    Given I am a logged in user with the "stranger" user
    Then I should be refused the project "Webship site"
