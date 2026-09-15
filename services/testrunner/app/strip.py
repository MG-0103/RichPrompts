"""Descriptions-only ablation transform.

Given the registry the caller sent us, produce a copy with every
model-visible description replaced by the empty string:

- Tools: `description` and each `parameters.properties.*.description`
  in the JSON payload.
- Skills: the `description:` line in the frontmatter block. Body is
  left alone — the sidecar only ever surfaces the frontmatter
  description to Gemini (see `real_runner._skill_to_decl`).

We rewrite the raw text so downstream runners don't need to know
anything about the transform — they just build declarations from
what they're given.
"""

from __future__ import annotations

import json
import re

from .schemas import RegistryEntry


def strip_tool(raw: str) -> str:
    try:
        obj = json.loads(raw)
    except Exception:
        return raw
    if isinstance(obj, dict):
        if "description" in obj:
            obj["description"] = ""
        params = obj.get("parameters") or obj.get("input_schema")
        if isinstance(params, dict):
            props = params.get("properties")
            if isinstance(props, dict):
                for _, spec in props.items():
                    if isinstance(spec, dict) and "description" in spec:
                        spec["description"] = ""
    return json.dumps(obj, separators=(",", ":"))


_FRONTMATTER = re.compile(r"^(---\s*\n)([\s\S]*?)(\n---)")


def strip_skill(raw: str) -> str:
    m = _FRONTMATTER.match(raw)
    if not m:
        return raw
    fm = m.group(2)
    fm = re.sub(
        r"^description:[^\n]*(?:\n[ \t]+[^\n]*)*",
        "description:",
        fm,
        count=1,
        flags=re.M,
    )
    return raw[: m.start(2)] + fm + raw[m.end(2) :]


def strip_entries(entries: list[RegistryEntry], kind: str) -> list[RegistryEntry]:
    fn = strip_tool if kind == "tool" else strip_skill
    return [RegistryEntry(id=e.id, raw=fn(e.raw)) for e in entries]
