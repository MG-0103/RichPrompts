"""Command-line interface for the refine tool.

Three subcommands:

    refine analyze <agent.yaml> [--no-llm] [--json]
    refine gen-cases <agent.yaml> [--out cases.yaml]
    refine test <agent.yaml> --cases <cases.yaml> [--no-judge] [--json]

Each subcommand can also emit JSON with `--json`, so the eventual web UI
(or a CI pipeline) can consume the same output the terminal renders.
"""

from __future__ import annotations

import json
from pathlib import Path

import typer
import yaml
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from refine.analyze import analyze
from refine.models import AgentSpec, ExpectedToolCall, TestCase
from refine.testing import generate_test_cases, run_tests

app = typer.Typer(add_completion=False, help="Refine — analyze & test multi-agent definitions.")
# Force a stable width so pipes and log capture still render legibly.
console = Console(width=140)


# ---------------------------------------------------------------------------
# analyze
# ---------------------------------------------------------------------------


@app.command("analyze")
def analyze_cmd(
    agent_path: Path = typer.Argument(..., exists=True, readable=True, help="Path to an AgentSpec YAML/JSON file."),
    no_llm: bool = typer.Option(False, "--no-llm", help="Skip the LLM analyzer; static lints only."),
    as_json: bool = typer.Option(False, "--json", help="Emit the report as JSON to stdout."),
    write_prompt: Path | None = typer.Option(None, "--write-prompt", help="If set, write the suggested prompt rewrite to this path."),
) -> None:
    """Analyze an agent's prompt + tools + subagents + skills."""
    agent = _load_agent(agent_path)
    report = analyze(agent, use_llm=not no_llm)

    if as_json:
        typer.echo(report.model_dump_json(indent=2))
    else:
        _render_report(report)

    if write_prompt and report.suggested_prompt:
        write_prompt.write_text(report.suggested_prompt)
        console.print(f"[green]Wrote suggested prompt to {write_prompt}[/green]")


# ---------------------------------------------------------------------------
# gen-cases
# ---------------------------------------------------------------------------


@app.command("gen-cases")
def gen_cases_cmd(
    agent_path: Path = typer.Argument(..., exists=True, readable=True),
    out_path: Path = typer.Option(Path("cases.yaml"), "--out", "-o"),
    max_cases: int = typer.Option(12, "--max", help="Max cases to generate."),
) -> None:
    """Auto-generate starter test cases for an agent."""
    agent = _load_agent(agent_path)
    cases = generate_test_cases(agent, max_cases=max_cases)
    payload = {"cases": [c.model_dump(exclude_none=True) for c in cases]}
    out_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True))
    console.print(f"[green]Wrote {len(cases)} cases to {out_path}[/green]")
    console.print("Review and edit before running `refine test`.")


# ---------------------------------------------------------------------------
# test
# ---------------------------------------------------------------------------


@app.command("test")
def test_cmd(
    agent_path: Path = typer.Argument(..., exists=True, readable=True),
    cases_path: Path = typer.Option(..., "--cases", exists=True, readable=True),
    no_judge: bool = typer.Option(False, "--no-judge", help="Skip the LLM judge for skill-usage scoring."),
    as_json: bool = typer.Option(False, "--json"),
) -> None:
    """Shadow-execute the agent against each test case."""
    agent = _load_agent(agent_path)
    cases = _load_cases(cases_path)
    results = run_tests(agent, cases, judge=not no_judge)

    if as_json:
        typer.echo(json.dumps([r.model_dump() for r in results], indent=2, default=str))
    else:
        _render_results(results)

    passed = sum(1 for r in results if r.passed)
    if passed < len(results):
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def _load_agent(path: Path) -> AgentSpec:
    if path.suffix in {".yaml", ".yml"}:
        return AgentSpec.from_yaml(path)
    if path.suffix == ".json":
        return AgentSpec.from_json(path)
    raise typer.BadParameter(f"Unsupported agent file type: {path.suffix}")


def _load_cases(path: Path) -> list[TestCase]:
    with open(path) as f:
        data = yaml.safe_load(f) if path.suffix in {".yaml", ".yml"} else json.load(f)
    return [TestCase.model_validate(c) for c in data.get("cases", [])]


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def _render_report(report) -> None:
    console.print(Panel.fit(f"[bold]{report.agent_name}[/bold] — analysis", style="cyan"))

    if report.all_findings:
        table = Table(show_lines=False, expand=True)
        table.add_column("sev", width=5)
        table.add_column("src", width=6)
        table.add_column("category", width=24)
        table.add_column("issue", overflow="fold")
        table.add_column("fix", overflow="fold")
        table.add_column("where", width=24, overflow="fold")

        for f in sorted(report.all_findings, key=lambda x: (0 if x.severity == "error" else 1 if x.severity == "warn" else 2)):
            sev_color = {"error": "red", "warn": "yellow", "info": "cyan"}[f.severity.value]
            table.add_row(
                f"[{sev_color}]{f.severity.value}[/{sev_color}]",
                f.source,
                f.category,
                f.message,
                f.suggestion,
                f.location or "-",
            )
        console.print(table)
    else:
        console.print("[green]No findings.[/green]")

    console.print(
        f"\n{report.error_count} error(s), {report.warn_count} warning(s), "
        f"{len(report.all_findings)} total finding(s)."
    )

    if report.suggested_prompt:
        console.print("\n[dim]A rewritten prompt was suggested. Use --write-prompt to save it.[/dim]")


def _render_results(results) -> None:
    table = Table(title="Test results", show_lines=False, expand=True)
    table.add_column("case")
    table.add_column("pass", width=6)
    table.add_column("route")
    table.add_column("tools")
    table.add_column("skills")
    table.add_column("judge")
    table.add_column("notes", overflow="fold")

    for r in results:
        pass_cell = "[green]✓[/green]" if r.passed else "[red]✗[/red]"
        route_cell = (
            "-" if r.route_ok is None
            else "[green]ok[/green]" if r.route_ok
            else f"[red]{r.actual_route or 'none'}[/red]"
        )
        tools_bits = []
        if r.tools_missing:
            tools_bits.append(f"[red]missing:[/red] {', '.join(r.tools_missing)}")
        if r.tools_unexpected:
            tools_bits.append(f"[yellow]unexpected:[/yellow] {', '.join(r.tools_unexpected)}")
        if r.forbidden_tools_hit:
            tools_bits.append(f"[red]forbidden:[/red] {', '.join(r.forbidden_tools_hit)}")
        if not tools_bits:
            tools_bits.append("[green]ok[/green]")
        skills_cell = (
            "[green]ok[/green]" if not r.skills_missing
            else f"[red]missing:[/red] {', '.join(r.skills_missing)}"
        )
        judge_cell = f"{r.skill_usage_score:.2f}" if r.skill_usage_score is not None else "-"
        notes = r.error or r.skill_usage_reason or ""
        table.add_row(r.case_id, pass_cell, route_cell, " | ".join(tools_bits), skills_cell, judge_cell, notes)

    console.print(table)
    passed = sum(1 for r in results if r.passed)
    console.print(f"\n{passed}/{len(results)} passed.")


if __name__ == "__main__":
    app()
