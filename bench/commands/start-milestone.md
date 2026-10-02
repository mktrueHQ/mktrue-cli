# Start a milestone

The kickoff. One plan, one decision page, answered in one sitting.

## Steps

1. Read `docs/STATE.md` and `docs/ROADMAP.md`. If the roadmap lists no milestones, stop and run `/create-roadmap` first: a milestone the roadmap does not name has nothing to be measured against.
2. Run the **architect**. It writes the milestone plan to `docs/design/<milestone>.md` and the decision page to `docs/decisions/<milestone>-kickoff.md`.
3. Stop. Hand the decision page to the founder and wait.
4. When it comes back answered, split it: one file per decision under `docs/decisions/`, each with its own number. The kickoff page becomes the index entry for that batch.
5. Freeze the plan. Record the slice list in `docs/STATE.md`.

## Rules

- The plan is not frozen until every question on the page has an answer. A question answered later is a new decision file, not an edit to a frozen plan.
- Questions do not trickle out across the milestone. If a slice raises a genuinely new one, it goes to the founder as a decision file, and the fact that the kickoff missed it goes in the log.
- Nothing is built during kickoff.

## Done when

The plan is frozen, every decision has a file, and `docs/STATE.md` names the first slice.
