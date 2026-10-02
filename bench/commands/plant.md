# Plant a bug

A test you have not seen fail is a test you have not seen work.

## Steps

1. Pick the code the slice changed. Plants go where the work was, not across the codebase.
2. Introduce one deliberate bug. Useful kinds:
   - invert a condition
   - change a boundary by one
   - drop an `await`
   - remove a permission or ownership check
   - return the default instead of the computed value
   - swap two arguments of the same type
3. Run the suite.
4. **Caught** means the test did its job. Record it and revert.
5. **Survived** means a hollow test. Record the file, the assertion that should have failed, and what it would take to catch it. Revert.
6. Repeat until every meaningful path in the diff has been probed.
7. Revert every plant. Confirm with `git diff` that the tree is clean and the suite is green.

## Rules

- Never leave a plant in the tree. Check before you finish, every time.
- Never plant in code the slice did not touch.
- A plant that cannot be written for some path is itself a finding: that path has no observable behaviour to test.

## Done when

Every plant is reverted, the suite is green, and each surviving plant is recorded as a hollow test with its fix.
