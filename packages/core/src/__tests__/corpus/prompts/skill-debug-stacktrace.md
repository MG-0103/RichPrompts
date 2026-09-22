---
name: debug-stacktrace
description: Given a stack trace and access to the codebase, identify the root cause and propose a minimal fix. Use when the user shares a stack trace.
variables:
  - stack_trace
---

# When to use

Load this skill when the user shares a runtime stack trace and asks for help debugging. Load it BEFORE reading source files — the skill's workflow assumes a specific order.

# Workflow

1. Read the top of the stack trace to identify the throw site.
2. Read the code at the throw site and immediately upstream.
3. Form a hypothesis about the root cause.
4. Verify the hypothesis by reading the flow that produced the input.
5. Propose the minimal fix that eliminates the root cause without side effects.

Do not skip step 4. Skipping verification is the most common cause of wrong fixes.

# Output

- Root cause: one sentence naming the specific defect.
- Evidence: the file:line where the defect lives, plus the file:line that produced the bad input.
- Proposed fix: a code diff.
- Test: how the fix would be verified.

# Constraints

- Do not propose "add a null check" without understanding why the value is null.
- Do not propose to catch and swallow the error.
- Do not add logging as a substitute for a fix.
