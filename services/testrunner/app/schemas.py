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
    ablation: bool = False


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
    stripped: "TestResult | None" = None


TestResult.model_rebuild()


class TestRunResponse(BaseModel):
    results: list[TestResult]
    durationMs: float
    sidecarVersion: str


class EmbedRequest(BaseModel):
    texts: list[str]
    model: str | None = None


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    cachedCount: int
    model: str
    durationMs: float


class VerifyPair(BaseModel):
    a: str
    b: str


class VerifyRequest(BaseModel):
    pairs: list[VerifyPair]
    model: str | None = None


VerifyLabel = Literal["duplicate", "contradictory", "related", "unrelated"]


class VerifyVerdict(BaseModel):
    label: VerifyLabel
    reason: str


class VerifyResponse(BaseModel):
    verdicts: list[VerifyVerdict]
    cachedCount: int
    model: str
    durationMs: float


class ExtractionCandidateIn(BaseModel):
    text: str
    target: Literal["schema", "tool", "skill"]
    reason: str = ""


class VerifyExtractionRequest(BaseModel):
    candidates: list[ExtractionCandidateIn]
    toolNames: list[str] = []
    skillNames: list[str] = []
    model: str | None = None


ExtractDecision = Literal["extract", "reject"]


class ExtractionVerdict(BaseModel):
    decision: ExtractDecision
    reason: str


class VerifyExtractionResponse(BaseModel):
    verdicts: list[ExtractionVerdict]
    cachedCount: int
    model: str
    durationMs: float


CanonicalSectionLit = Literal["role", "task", "output", "constraints"]


class ClassifySectionsRequest(BaseModel):
    source: str
    model: str | None = None


class ClassifySectionsResponse(BaseModel):
    found: list[CanonicalSectionLit]
    reasoning: str
    cached: bool
    model: str
    durationMs: float
    # 0 when the source fit within MAX_CHARS. Otherwise the original
    # source length in chars, so the UI can show a "clipped to first N"
    # note.
    truncatedFrom: int = 0


class MergeClusterRequest(BaseModel):
    members: list[str]
    model: str | None = None


class MergeClusterResponse(BaseModel):
    merged: str
    reason: str
    cached: bool
    model: str
    durationMs: float
    # True when the LLM judged the members to be describing distinct
    # entities and declined to merge. `merged` is "" in that case;
    # `reason` names the distinct entities.
    refused: bool = False


class SegmentRequest(BaseModel):
    source: str
    # Regex Layer 1's boundaries (section-start offsets). The chunker
    # only proposes boundaries in gaps between these.
    knownBoundaries: list[int] = []
    threshold: float | None = None
    minGapChars: int | None = None
    model: str | None = None


class SegmentPairSimilarity(BaseModel):
    gap: int
    leftRange: list[int]
    rightRange: list[int]
    similarity: float


class SegmentDebugPayload(BaseModel):
    sentenceOffsets: list[list[int]]
    pairSimilarities: list[SegmentPairSimilarity]
    gapRegions: list[list[int]]


class SegmentResponse(BaseModel):
    boundaries: list[int]
    thresholdUsed: float
    model: str
    durationMs: float
    debug: SegmentDebugPayload


class ClassifyV2Request(BaseModel):
    text: str
    model: str | None = None


class ClassifyAlternative(BaseModel):
    label: str
    confidence: float


class ClassifyV2Response(BaseModel):
    family: str
    label: str
    confidence: float
    alternatives: list[ClassifyAlternative]
    ambiguous: bool
    reasoning: str
    cached: bool
    model: str
    durationMs: float


class AtomizeRequest(BaseModel):
    paragraph: str
    section: str | None = None
    model: str | None = None


class AtomOut(BaseModel):
    text: str
    kind: str
    startOffset: int
    endOffset: int


class AtomizeResponse(BaseModel):
    atoms: list[AtomOut]
    # Non-fatal warnings — atoms the LLM proposed but we couldn't
    # locate in the source (verbatim-substring rule). Useful for
    # debugging bad prompts.
    warnings: list[str]
    cached: bool
    model: str
    durationMs: float

