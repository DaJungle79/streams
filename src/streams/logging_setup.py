"""Logging setup, kept in its own module so it never shadows stdlib ``logging``."""

from __future__ import annotations

import logging

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"


def setup_logging(level: int | str = logging.INFO) -> None:
    """Configure root logging with a consistent, readable format."""
    logging.basicConfig(level=level, format=_FORMAT, datefmt=_DATEFMT)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
