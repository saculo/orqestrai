# Test guidelines

The general layer: what to test and why, independent of language and framework. The
project layer, `.orqestrai/testing.md`, says **with what**: tools, commands, existing
doubles and containers, examples of good tests in that repo. Read both. When they
disagree, the project file wins for tools; this file wins for principles.

Read by plan (behaviors, levels, verification plan), impl (writes the tests) and the
reviewer in verify (judges each assertion).

## 1. Levels

| Level       | One behavior is                                                    |
|-------------|--------------------------------------------------------------------|
| unit        | a business rule, through the module's public API, in memory; pure logic, no storage |
| integration | the same kind of behavior, with real infrastructure                |
| contract    | the shape and meaning of what crosses a service boundary           |
| e2e         | a user journey through the running app                             |

- Contracts get contract tests. Behaviors get integration and e2e tests.
- A behavior that needs storage is an integration test with the real store, not a unit
  test with a fake repository.
- Impl writes unit, integration and contract tests, test first. E2E tests are written in
  verify by the verifier, which does not read the app's source. Impl never changes them.
- **One level per behavior.** A behavior covered by an e2e test gets no second test at a
  lower level. Lower levels are for what e2e cannot cover well: rule variants, edge
  cases, failures of other systems.

## 2. Choosing the level

Take the **highest seam where the test is still fast and deterministic**. Then:

- **Push down** to unit when a rule has many input variants that change its business
  meaning (a price with ten factors). Test the variants there, one journey above.
- **Push up** when the risk is in the wiring: queries, serialization, configuration,
  transactions.
- An interface layer (controller, handler, CLI command) that only delegates is tested
  through the layer below. One that holds logic (filtering, branching, orchestration)
  is tested itself.
- An inner abstraction (a validator registry, a policy object) looks testable but is
  usually an implementation detail. Test through the behavior it serves. Test it
  directly only when the variants are too many for the level above; record that choice.

## 3. Observable assertions

Assert on what a user or another system can observe:

- a return value, an error, a response;
- state the user can read back through the API;
- an effect at a boundary: a request sent, a message published, a file written.

Ask: *what can the user or system do now that they could not before, or the other way
round?* Not: *what happened inside?*

**Exception: CRUD.** When saving and reading back is the whole behavior, asserting on the
saved state is right.

Smells (each one is a finding in review):

- asserts on internal fields, flags, counters or private types;
- verifies calls to a repository or to our own collaborators;
- verifies mock interactions where the call has no outside cost;
- builds the given state by writing to storage;
- computes the expected value with the same formula as the code, or copies it from a run;
- waits with a fixed sleep;
- depends on another test's data or on test order.

Asserting on internal types freezes them: every refactor breaks the test. Assert on
behavior and keep the freedom to change the inside.

## 4. Given state

- The data under test and the data it needs come **through the app's public API**, the
  same way a user creates them. The state is then one the app can really reach.
- Build it with small helpers named in glossary words (`aCustomer().vip()`,
  `anOrder(customer).onSaturday()`). A helper sets only what the test cares about and
  uses sensible defaults for the rest. A schema change then means one helper to fix.
- Base setup (schema, reference data, configuration) may use scripts or migrations.
- Each test creates its own data. No shared data that one test changes under another.
- E2E tests never seed by SQL.
- Find what you created by the reference the API returned (an id in the response), not
  by searching the store.

## 5. Real vs double

- **Our own code:** real. No mocking library for our own collaborators.
- **Infrastructure we run** (database, broker, cache, object store): real, in a container
  or a local emulator.
- **Third-party services:** network-level doubles (a stub server that answers like the
  service), backed by contract tests, so the double cannot drift from the real thing.
- **Costly calls** (payment, email, rate-limited APIs): a recording double. Here the call
  itself is the observable effect, so asserting on what was sent is correct.
- A mock only where no double fits. Say why in the test.

## 6. Hard-to-test patterns

When a behavior matches one, plan names it in **Behaviors**, and the test asserts this way.

| Pattern | The difficulty | How to assert |
|---------|----------------|---------------|
| invisible side effect | the effect does not show through the API | observe where it leaves the system: the recording double, the stub server's received requests, a test consumer on the broker |
| expected no-op | "nothing happens" passes even when the code is missing | trigger what would cause the effect, assert the observable stays the same; pair it with a test where the effect does happen |
| time-dependent | expiry, deadlines, schedules | an injected clock; move time in the test; check just before, at, and just after the boundary |
| multi-step process | a workflow over several commands | drive each step through the API; assert what is visible after each step and at the end; test a failure in the middle |
| history-dependent | the result depends on earlier actions | build the history with real operations in the given part, not by setting a counter |
| race | concurrent requests on the same data | start two conflicting commands together; assert the rule holds and the loser gets the agreed answer; repeat enough to matter |
| multi-factor calculation | many parameters | group parameters by business meaning; one table of cases per variant that changes the meaning, not every permutation |
| permission gate | same action, different actors | allowed and denied for each role that matters; for denied, assert the effect is absent |
| eventual effect | the result arrives later, maybe in another context | poll the observable with a timeout (never a fixed sleep); assert it eventually holds |
| costly call | the call costs money or quota | a recording double; assert how many calls and what they carried |

## 7. Naming

- One sentence about the behavior, in glossary words: `a VIP customer gets the weekend
  discount`. Not the method name, not "works correctly".
- E2E tests also carry the AC id: `AC3: a VIP customer gets the weekend discount`.
- Given / when / then is the structure of the body, not of the name.

## 8. Time and concurrency

- Time comes from an injected clock, never from the system clock directly.
- Contended data gets a race test (see the pattern above and `orq-consistency-unit`).
- Async results are awaited by polling with a timeout.

## 9. Flaky tests

A flaky test is a failing test. Never retry it to green. It points to a real problem in
the code or in the test: time, order, shared data, an async wait. Find the cause.

A flaky test that already fails on the base branch is reported as pre-existing; learn
proposes a separate task for it.

## 10. Coverage

No percentage gate. Every AC is covered by a test or a check (the plan guarantees it),
and the reviewer flags changed behavior that no test covers.

## 11. Review rubric

For each test in the diff, the reviewer asks: *does this assertion check something the
user or system observes, or something only a reader of the code would know?*

```
<test name>: OK | SMELL
<for a SMELL: what it asserts, why that is not observable, what to assert instead>
```

A SMELL is a **Standards** finding.
