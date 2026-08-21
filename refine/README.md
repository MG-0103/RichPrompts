# refine — a refinement tool for multi-agent systems

Take a Google-ADK agent's **prompt + tools + subagents + skills**,
analyse what's necessary / compressible / contradictory / under-specified,
then behaviourally test it with **shadow execution** — real LLM on your
real prompt, but with every tool call intercepted and mocked so you catch
"did the routing / tool call / skill load actually happen correctly?"
without paying real-world side effects.

Backend only for now — a small local web UI can layer on top later; every
CLI subcommand also emits JSON so a UI (or CI) can consume the same data.

---

## What it does

Two phases, either usable on its own.

### Phase A — Analyse (`refine analyze`)

For each agent, produces a report of two kinds of findings:

- **Static lints** (deterministic, no LLM):
  - prompt length outliers
  - instruction stacking (rule count past the point where attention degrades)
  - `CRITICAL / MUST / NEVER` inflation (over-eager on frontier models)
  - negative-only instructions (the model suppresses "don't X" less
    reliably than it follows "do Y")
  - orphan tools / subagents / skills — defined but never referenced in
    the prompt
  - duplicate authority — two skills or two subagents with near-identical
    descriptions, so routing is a coin flip
  - tool-description drift — the prompt talks about a tool but none of
    its docstring words appear anywhere in the prompt
  - undefined tool references — `foo(` in the prompt with no matching tool
  - under-specified triggers — `"when appropriate"`, `"if needed"`, etc.
- **LLM findings + suggested rewrite** (Claude Opus 5, adaptive thinking):
  what's necessary vs. compressible, contradictions, enforcement drift,
  missing rationale — each with a one-sentence concrete fix, plus a
  proposed rewrite of the system prompt.

### Phase B — Test (`refine test`)

Shadow-executes the agent against a set of `TestCase`s:

1. Builds a real google-adk `LlmAgent` from your `AgentSpec`.
2. Wraps every tool with an interceptor — the LLM call is real, but
   when the agent calls `search_web(...)` the interceptor **records
   the call** and **returns the case's mock response**, so nothing
   actually hits the world.
3. Wraps each subagent as a **stub** that just signals "I was routed
   to" and exits, so routing decisions are observable without paying
   for downstream runs.
4. Wraps skills as a synthetic `load_skill(name)` tool that records
   loads and returns the skill body.

Each case can assert any of:

- `expected_route` — which subagent should have been picked (or `null`
  for "handle it yourself")
- `expected_tools` — which tools should have been called, optionally
  with an `args_contains` subset check
- `expected_skills` — which skills should have been loaded
- `forbidden_tools` — tools that must NOT have been called
- `judge_criteria` — freeform criteria for an LLM-judge (Claude) that
  scores whether the loaded skill's guidance was actually followed

### Bonus — `refine gen-cases`

Auto-generates a starter set of test cases from the agent definition
so you don't write them cold. You edit them; the generator is
scaffolding.

---

## Install

```bash
cd refine
pip install -e '.[adk]'           # includes google-adk for shadow execution
# or
pip install -e .                  # analyzer only, no google-adk needed
```

You'll need `ANTHROPIC_API_KEY` in the environment (or an `ant auth
login` profile) for the LLM analyzer, the LLM judge, and the test-case
generator. If you're only running static lints, no key is required.

To run the shadow executor, you'll also need `GOOGLE_API_KEY` (or
Vertex creds) since the agent under test is a google-adk `LlmAgent`
that calls Gemini.

---

## Quickstart

The `examples/` folder has a deliberately mediocre `support_router`
agent so you can see all three subcommands do something interesting.

```bash
# 1. Static + LLM analysis
refine analyze examples/support_router.yaml
# same, JSON out:
refine analyze examples/support_router.yaml --json > analysis.json
# save the suggested rewrite:
refine analyze examples/support_router.yaml --write-prompt suggested.txt

# 2. Generate starter test cases
refine gen-cases examples/support_router.yaml -o cases.yaml
# ... edit cases.yaml by hand ...

# 3. Shadow-execute
refine test examples/support_router.yaml --cases examples/support_router_cases.yaml
```

`refine test` exits non-zero if any case fails, so it drops straight
into CI.

---

## Python API

Everything the CLI does is available as a library:

```python
from refine import (
    AgentSpec, analyze, generate_test_cases, run_tests,
)

agent = AgentSpec.from_yaml("examples/support_router.yaml")

report = analyze(agent)                        # AnalysisReport
cases = generate_test_cases(agent)             # list[TestCase]
results = run_tests(agent, cases)              # list[TestResult]
```

All models are Pydantic, so `.model_dump_json()` / `.model_dump()` give
you clean JSON for the eventual UI.

---

## AgentSpec shape

Framework-agnostic on purpose — an ingest adapter for your other repo
just needs to produce one of these. The analyzer and the shadow
harness both accept a plain YAML/JSON:

```yaml
name: support_router
model: gemini-2.5-pro                # optional; used by the harness only
system_prompt: |
  You are a support router. ...
tools:
  - name: lookup_customer
    description: Look up a customer's account by email or account_id.
    parameters:                       # JSON Schema
      type: object
      properties:
        email: {type: string}
        account_id: {type: string}
subagents:
  - name: billing_agent
    description: Handles billing and invoice questions.
skills:
  - name: refund_policy
    description: When a user asks about a refund, load this skill.
    body: |
      # Refund policy (v3)
      ...
```

---

## Adapters for your other repo

`AgentSpec` is the ingest contract; the tool doesn't care where the
data comes from. When you're ready to wire in your Google-ADK repo,
write an adapter that walks your `LlmAgent` registry and constructs
`AgentSpec`s from it. A rough sketch:

```python
def adapter_from_adk(adk_agent) -> AgentSpec:
    return AgentSpec(
        name=adk_agent.name,
        model=adk_agent.model,
        system_prompt=adk_agent.instruction,
        tools=[
            ToolSpec(
                name=t.name,
                description=t.description or "",
                parameters=t.get_schema().get("parameters", {}),
            )
            for t in adk_agent.tools
        ],
        subagents=[
            SubagentRef(name=s.name, description=s.description)
            for s in adk_agent.sub_agents
        ],
        skills=load_skills_from(adk_agent.name),   # your repo's skill loader
    )
```

---

## Layout

```
refine/
├── README.md                    # you are here
├── pyproject.toml               # deps + `refine` CLI entry
├── refine/
│   ├── __init__.py              # public API
│   ├── models.py                # AgentSpec, TestCase, Finding, ...
│   ├── llm_client.py            # thin Anthropic Messages API wrapper
│   ├── analyze/
│   │   ├── __init__.py          # analyze() = static + LLM
│   │   ├── static.py            # deterministic lints
│   │   └── llm.py               # Claude Opus 5 reviewer
│   ├── testing/
│   │   ├── __init__.py
│   │   ├── shadow.py            # google-adk shadow harness
│   │   ├── judge.py             # LLM judge for skill-usage fidelity
│   │   └── generator.py         # auto-generate starter test cases
│   └── cli.py                   # typer CLI
├── examples/
│   ├── support_router.yaml
│   └── support_router_cases.yaml
└── tests/
    └── test_static.py           # deterministic lint tests
```

---

## Design decisions worth naming

- **Ingest is a stub.** The tool takes a `dict`/YAML/JSON, not a live
  agent object. An adapter for your other repo layers on top; the
  analyzers and the harness never depend on the framework version.
- **Static lints run without keys.** Zero-network CI gate for style
  regressions — useful even without the LLM stage.
- **The shadow harness never runs your tools.** Every tool becomes an
  interceptor that records the call and returns the case's mock. No
  real side effects, no real cost outside the LLM call itself.
- **Subagents are stubbed.** We measure routing, not downstream
  execution — routing failures are the highest-leverage thing to catch,
  and downstream runs would balloon cost.
- **Skills become a `load_skill()` tool.** Loading is observable as a
  tool call; the body of the loaded skill becomes the tool return
  value, so the model actually sees it in context and the judge can
  score whether it was followed.
- **LLM = Claude Opus 5, adaptive thinking.** Analyzer, judge, and
  case generator all use it. Streaming with `.get_final_message()`
  keeps long reviews within SDK timeouts.
- **Every technique in the analyzer prompts is documented in the
  sibling `docs/`** — this whole tool is an application of what's in
  `RichPrompts/docs/`, so if you want to change how the analyzer
  reasons, that's where to start.

---

## Roadmap

Landed in this cut:

- [x] Framework-agnostic models
- [x] Static analyzer (11 lints)
- [x] LLM analyzer + suggested prompt rewrite
- [x] Test case auto-generator
- [x] Shadow-execution harness (google-adk)
- [x] LLM judge for skill-usage fidelity
- [x] CLI + JSON output
- [x] Sample agent + tests

Deferred until we need them:

- [ ] Ingest adapter for your specific ADK wrapper (asked to defer)
- [ ] Local web UI (asked to defer)
- [ ] Recursive analysis of subagents (models support it; runner needs to walk)
- [ ] Multi-agent cross-analysis (find capability overlaps between agents)
- [ ] Diff view of prompt suggestion vs. current
- [ ] Regression mode: rerun a cases set on N versions of a prompt, chart pass-rate
