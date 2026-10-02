# Scaffold a module

A new bounded module is a real event, not a routine scaffold.

## Preconditions

1. **The module is the current milestone in `docs/ROADMAP.md`.** If it is not, stop — adding a module the roadmap does not call for is exactly the scope creep the rules forbid.
2. **State in one sentence why the work does not belong in an existing module.** If you cannot, stop.

## Steps

1. **Design first.** Delegate to the **architect** to produce the plan section for this module, and **stop there**. The founder answers the design questions before any scaffolding happens.
2. **Scaffold only the layers the plan earns.** No empty folders for symmetry.
3. Add the shared shapes to the contracts package. A second copy of a schema anywhere else is a fork.
4. Add the routes. **Every route is gated by default** unless the plan explicitly lists it public. Verify the route-table backstop test picks the new routes up.
5. Mirror the test tree, **including the unauthorised-access test** and the mandatory test classes the new surface touches.
6. Run the affected tests, the type check and the linter — not the full chain.

## Done when

The module exists with the layers its plan earned, its routes are gated and covered by the backstop, and its mandatory tests pass.
