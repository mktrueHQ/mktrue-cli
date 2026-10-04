# Start a slice

From a written brief to a reviewed change. Read `<slice folder>/brief.md`; if there is none, run `/brief` first. Do the steps in order.

## 1 · Run the agents one at a time, each spawned fresh

`implementer` or `ui-engineer` → `security-auditor` **if triggered** → `reviewer`.

Save each report as rule 2 of `.claude/agents/README.md` says, before you spawn the next agent. Each agent reads the earlier saved reports, **never a summary you paste**. The auditor and the reviewer never run at once, and no finished agent is resumed (rule 3 of `.claude/agents/README.md`).

**When the auditor runs**, its scope is the branch diff against its base plus anything uncommitted, unless the brief says otherwise; say which it is. **Do not pre-filter what it sees.** Then triage its report:

- Anything touching a trigger surface — __MKTRUE_AUDIT_TRIGGERS__ — is **must-fix before merge**, no exceptions. Rank the rest honestly; do not inflate notes into blockers.
- A bounded fix goes to the implementer as a follow-up (step 2). Anything structural is written up as a decision question for the founder, never improvised as a security design mid-review.
- If the audit found a class of bug worth preventing, propose the **mandatory-test addition** to the rules rather than only fixing the instance.
- The verdict and its findings go into the slice record. Every critical and high finding is fixed or has an explicit ruling.

## 2 · Follow-ups are new agents

Append a `## Follow-up <n>` section to the brief with the saved report paths, and spawn a fresh agent against it.

## 3 · On an `approve` verdict

Run `/close-slice`.

## Done when

The brief has a saved report beside it for every agent that ran, every audit finding is triaged, the reviewer found no surviving plants, and the change is ready to close.
