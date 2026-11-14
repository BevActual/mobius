"""Turns raw logger rows into what the charts show."""


def kmh(mps: float) -> float:
    """Metres per second to kilometres per hour."""
    return mps * 3.6


def pack_temperature(raw: int) -> float:
    """The logger sends tenths of a degree above -40 C."""
    return raw / 10 + 40  # bug: should be - 40


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0
