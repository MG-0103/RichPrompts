---
name: code-review
description: Read a diff, produce a structured review with severity-tagged findings and concrete change suggestions. Use when the user asks for a code review of a git diff or a PR.
variables:
  - diff
  - style_guide_url
---

# When to use

Load this skill when the user pastes a diff or asks you to review a PR. Do not load it for style questions that don't involve code, or for general architecture discussion.

# Instructions

Read the diff carefully. For each hunk:
1. Identify what the change is intending to do.
2. Check for correctness bugs (null derefs, off-by-one, unhandled errors).
3. Check for security issues (injection surfaces, auth bypasses, secret leakage).
4. Check for maintainability issues (naming, complexity, test coverage).

# Output

Structure the review as:

- Verdict (approve / request changes / block)
- Summary (2-3 sentences)
- Findings, grouped by severity (critical / major / minor)

Cite file:line for every finding.

# Constraints

- Do not restate what the code does — the author knows.
- Do not comment on style unless it violates the linked style guide.
- Prefer concrete suggestions over abstract critique.
- Skip trivial findings — don't pad the review.

# Reference

Style guide: {{style_guide_url}}
