# Create the roadmap

The first command after `mktrue new`. It turns the founder's description of the product into a milestone ladder, confirmed before a line of it is written.

## When

Once, while `docs/ROADMAP.md` lists no milestones. If it lists any, stop: from then on scope moves only through `/update-roadmap`.

## Steps

1. **Ask for the features, in detail, in one message.** Ask the founder to describe every feature the product should eventually have, and for each one:
   - **What someone can do with it**, in their own words: "I can see where last month's money went, from my phone."
   - **Who** does it, and how often.
   - **What data** it reads or keeps, and whether any of it is personal.
   - **How much it matters**: needed for the first real use, needed soon after, or someday.
   - **What it depends on**: another feature, an outside service, a sign-in.
   - **How they would know it works**, tried by hand on a real device.

   Take the answer in any shape: a list, prose, a pasted document. Then stop and wait. Nothing is drafted from a guess.

2. **Close the gaps in one round.** Read the whole description, then ask every remaining question at once: a feature too vague to place, two that conflict, one with no way to know it works. Never trickle questions. If nothing is unclear, skip this step.

3. **Run the architect** to write the draft to `docs/design/roadmap.md`:
   - **A feature table.** Each feature gets an id (F1, F2, …), the founder's own sentence, its priority and what it depends on.
   - **Milestones.** Each has a goal in the owner's terms, the feature ids it delivers, and a done-when the founder can check by hand on a device. Milestone 1 is the smallest thing the founder would actually use, and every milestone ends usable.
   - **The order.** Dependencies first, then value, then risk. The riskiest unknown goes early, never last.
   - **Out of scope.** Every "someday" feature and everything the founder excluded, each with the trigger that would bring it back.
   - **A size for each milestone**, in one-evening slices, derived from its features and labelled an estimate.
   - **Open calls.** Every question the ladder turns on (an order, a cut, a dependency on an outside service), each with options, their costs and a recommendation.

4. **Check coverage before showing it.** Every feature id appears in exactly one milestone or in out of scope. A feature that silently vanished is the defect this command exists to prevent. A feature the founder never described is the other.

5. **Publish the draft and its open calls as one decision page**, then stop. The founder answers it in one sitting.

6. **When it comes back answered:**
   - Write `docs/ROADMAP.md` from the confirmed draft: the milestone table, every status `planned`, each done-when as confirmed, and the out-of-scope list.
   - Record the ladder as a decision file, with its line in the index.
   - Replace `docs/STATE.md`, under __MKTRUE_BUDGET_STATE__ characters, so that it names `/start-milestone` for milestone 1 as the next step.

## Rules

- Nothing is built during this command: no code, and no milestone plan. Planning a milestone is `/start-milestone`.
- The founder's words are the source. The architect may split, merge or reorder features, and says where it did. It never adds one.
- Priorities and done-whens belong to the founder. Where the architect proposes one, the page marks it as proposed.

## Done when

`docs/ROADMAP.md` lists every confirmed milestone with a done-when checkable on a device, every described feature sits in a milestone or in out of scope, the ladder has a decision file, and `docs/STATE.md` names milestone 1 as next.
