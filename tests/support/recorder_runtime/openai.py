"""Replacement OpenAI client for offline invocation evaluation tests."""

from __future__ import annotations

import json
import os
from types import SimpleNamespace


class FakeResponses:
    def parse(self, **arguments: object) -> object:
        assessment = json.loads(os.environ["SHAKA_FAKE_MODEL_ASSESSMENT"])
        text_format = arguments["text_format"]
        return SimpleNamespace(
            id="response-test-1",
            output_parsed=text_format.model_validate(assessment),
        )


class OpenAI:
    def __init__(self) -> None:
        self.responses = FakeResponses()
