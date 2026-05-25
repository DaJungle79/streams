"""The agent layer: conservative Claude-powered synthesis and digest.

Decoupled from the model via the ``LLM`` protocol so a local model can take over
routine passes later without rewiring (a brief requirement). Every agent write is
logged as an ``agent-note`` event, and token/cost usage is logged to the ``meta``
stream.
"""
