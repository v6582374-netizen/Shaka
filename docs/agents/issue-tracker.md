# Issue tracker: GitHub

Issues and specifications live in the GitHub repository
`v6582374-netizen/Shaka`. Use the `gh` CLI for issue operations.

## Common operations

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body "..."`
- Add a label: `gh issue edit <number> --add-label "..."`
- Remove a label: `gh issue edit <number> --remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

When a skill says “publish to the issue tracker”, create a GitHub issue.
When a skill says “fetch the relevant ticket”, read the corresponding
GitHub issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.
