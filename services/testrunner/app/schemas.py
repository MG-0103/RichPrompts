from typing import Literal, Union

from pydantic import BaseModel, Field


class ExpectTarget(BaseModel):
    kind: Literal["tool", "skill"]
    name: str


class ExpectNone(BaseModel):
    kind: Literal["none"]


ExpectedTarget = Union[ExpectTarget, ExpectNone]


class TestCase(BaseModel):
    id: str
    query: str
    expect: ExpectedTarget
    mustNotCall: list[str] | None = None
    notes: str | None = None


class TestRunConfig(BaseModel):
    model: str | None = None
    rollouts: int = 5
    temperature: float = 0.7
    mock: bool = True


class RegistryEntry(BaseModel):
    id: str
    raw: str


class TestRunRequest(BaseModel):
    prompt: str
    tools: list[RegistryEntry] = Field(default_factory=list)
    skills: list[RegistryEntry] = Field(default_factory=list)
    testCases: list[TestCase]
    config: TestRunConfig | None = None


class CalledTarget(BaseModel):
    kind: Literal["tool", "skill", "none"]
    name: str | None = None


class RolloutOutcome(BaseModel):
    called: CalledTarget | None
    args: dict | None = None
    latencyMs: float
    steps: int
    logprob: float | None = None
    error: str | None = None


class TestResult(BaseModel):
    testId: str
    passRate: float
    concentration: float
    modalCalled: CalledTarget | None = None
    meanLogprob: float | None = None
    meanSteps: float
    latencyP50: float
    routingScore: float
    rollouts: list[RolloutOutcome]
    cached: bool = False
    mock: bool = False


class TestRunResponse(BaseModel):
    results: list[TestResult]
    durationMs: float
    sidecarVersion: str
