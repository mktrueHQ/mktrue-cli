# Start a milestone

The kickoff. One plan, one kickoff page, answered in one sitting.

## Steps

1. Read `docs/STATE.md` and `docs/ROADMAP.md`. If the roadmap lists no milestones, stop and run `/create-roadmap` first: a milestone the roadmap does not name has nothing to be measured against.
2. Run the **architect**. It writes the milestone plan to `docs/design/<milestone>.md` and the kickoff page to `docs/design/<milestone>-kickoff.md`. The page lives under `docs/design/`, never `docs/decisions/`. Save its report as rule 2 of `.claude/agents/README.md` says, verbatim to `<main checkout>/.mktrue/slices/<milestone>-kickoff/architect.md`, a folder you make as `/brief` step 2 makes a slice folder. Never save it under `docs/design/`: a report is not a design.
3. Stop. Hand the kickoff page to the founder and wait.
4. When it comes back answered, split it: one file per decision under `docs/decisions/`, each with its own number, and one line per decision in `docs/decisions/index.md`. The kickoff page stays where it is, as the record of what was asked.
5. Freeze the plan. Record the slice list in `docs/STATE.md`.

## Rules

- The plan is not frozen until every question on the page has an answer. A question answered later is a new decision file, not an edit to a frozen plan.
- Questions do not trickle out across the milestone. If a slice raises a genuinely new one, it goes to the founder as a decision file, and the fact that the kickoff missed it goes in the log.
- Nothing is built during kickoff.

## Done when

The plan is frozen, every decision has a file, and `docs/STATE.md` names the first slice.
