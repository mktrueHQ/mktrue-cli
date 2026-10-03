# Run a security review

## Steps

1. **Establish the scope.** By default: the branch diff against its base, plus anything uncommitted. Say which it is.
2. **Delegate to the `security-auditor`** with the absolute path of the slice folder and its `brief.md`. **Do not pre-filter what it sees.** It returns its report as its final message, at most 600 words; save it verbatim to `<slice folder>/audit.md`.
3. **Triage.** Anything touching a trigger surface — __MKTRUE_AUDIT_TRIGGERS__ — is **must-fix before merge**, no exceptions. Rank the rest honestly; do not inflate notes into blockers.
4. **Route the fixes.** A bounded fix goes to the implementer as a follow-up brief. Anything structural is written up as a decision question for the founder, never improvised as a security design mid-review.
5. **Record.** The verdict and its findings go into the slice record.
6. **Generalise.** If the audit found a class of bug worth preventing, propose the **mandatory-test addition** to the rules rather than only fixing the instance.

## Done when

Every critical and high finding is fixed or has an explicit ruling, and the verdict is recorded.
