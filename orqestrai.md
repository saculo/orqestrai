IMPORTANT: LETS TRY TO BE MINIMALISTIC AND CHOOSE EFFICIENT SOLUTIONS.
USE YAGNI, AS WE DON'T WANT TO START WITH ORQESTR.AI TO BE OVERGROWN.
LETS WORK WITH ME ON THAT, AS I REALLY WANT IT TO BE SOLID.
IF YOU HAVE QUESTIONS, PROPOSITIONS, THINK THAT SOMETHING IS BAD - TELL ME.


1. orqestrai - orchestrated software factory with human gates
2. Orchestrator will know workflow and how to orchestrate
3. TRIAGE (Iterative step) - takes a requirement/problem/bug and iteratively task with user about that. It of course checks ADRs and codebase. RESULT = Not sure what it should result important.
4. PLAN/DESIGN/SPEC (Iterative step) - takes result of TRIAGE and iteratively designs some 1. Specs/Acceptance criterias 2. Verification flow 3. Some implementation plan 4. Blast radius, priority, risk. RESULT = File with acceptance criterias, needed checks and evidences, impl plan
5. IMPLEMENTATION - basing on Specs + Impl plan goes with implement. We want to run it in waves (but they are dynamically prepared during plan), so we allow to run some implementation in parallel. RESULT = Some impl result
6. VERIFY - this is the dynamic section, as how we verify a task is done during PLAN/DESIGN/SPEC step. So it takes IMPL RESULT and compares it with Impl plan. Later it run verifications flow (writes e2e, ut, it, sec, contract, semantic, ui verifications etc. basing on the flow - BUT IT CANT READ WRITEN CODE, SO TESTS WILL BE DONE WITHOUT KNOWING IMPL). This should work in some loop with IMPL (probably with limit of loops, but it shouldnt notify me if something isn't crtiical). RESULT = Evidences, comparison with expected verification flow/acceptance criterias.
7. LEARN/COMPOUND OR STH - It takes some important things as ADRs or sth like that. RESULT = ADR and TBD
8. SHIP - Basing on risk CREATE PR and wait on human merge or MERGE AUTOMATICALLY.


Additional things (ORCHESTRATION AND REMOTE):
1. Each task is separate GIT WORKTREE - orchestrator creates it before any step.
2. I want to CORE work the same when I work locally with harness or on VPS
3. I want to have possibility (main usage) to work on VPS. I want to have possibility to start it from Slack or from Tailscale + zellij. I don't want to use headless pi and Claude.
4. I want to have some global state of running tasks (SQLite, Git, Neon DB, sth else?) (on which step are they and if they need my attention). I want to have it stored somewhere and also to have dashboard where I can see that. (TODO, IN PROGRESS, WAITING FOR ME, MERGED).
5. At the moment I want use any sandboxing, but still VPS and usage of Pi or Claude has to be secure (secrets, access, traffic, non-root).
6. Each step use different model (especially PLAN should use different than IMPL, and VERIFY different than IMPL).
7. Each step should be run as new subagent.
8. For sure we have to separate a) Writing tests b) Impl c) REview. So Review doesn't see the code, tests should be also written independently from code (without seeing what). ## Maybe TDD is a good idea and Writing tests -> Writing IMPL -> Running all tests -> Rest of verification? Idk.


Additional things (WORTH TO TRY):
1. Verification can also check some architecture regression, modularity
2. Reuse principles from pstack/craftpath.
3. Use Formal Verification if it makes sense(?)
4. Use evals.
5. Use some advanced checks during CI (linters, semgrep, astgrep) - propose more tools which we can use to improve quality.
6. Use some MCPs/plugins which can make our work easier, cheaper etc.
7. For some repeating work we can create simple scripts or sth (how to work with git everytime etc.)
8. Adversarial Review
9. DDD as some chance to make language for a project
10. Lets write also skills for things like commit and pr messages,  ASD-STE100 etc.


For later:
1. Playbooks per type of work - as we will get different workflows later.
2. Metrics, tracing etc.
3. Self-improvement


We can take examples from:
- https://github.com/EricTechPro/super-board/tree/main
- https://github.com/humanlayer/skills/tree/main + https://github.com/humanlayer/humanlayer
- https://github.com/cursor/plugins/tree/main/pstack
- https://github.com/kunchenguid/firstmate
- https://github.com/app-vitals/shipwright
- https://github.com/mattpocock/skills
- https://github.com/mastra-ai/mastra/
