from telemetry import average, kmh, pack_temperature


def test_kmh():
    assert kmh(10) == 36


def test_pack_temperature():
    assert pack_temperature(650) == 25


def test_average():
    assert average([1, 2, 3]) == 2
    assert average([]) == 0
