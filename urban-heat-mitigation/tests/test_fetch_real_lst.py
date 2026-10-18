import numpy as np
import pytest
from pipeline.config import LANDSAT_SCALE_FACTOR, LANDSAT_OFFSET
from pipeline.fetch_real_lst import calibrate_lst


def test_calibrate_lst_normal_window():
    """Verify normal digital numbers calibrate correctly to Celsius."""
    raw_dn = np.array([[44000, 45000], [43000, 44500]], dtype=np.uint16)
    lst_c = calibrate_lst(raw_dn)

    expected_0_0 = 44000 * LANDSAT_SCALE_FACTOR + LANDSAT_OFFSET - 273.15
    assert np.isclose(lst_c[0, 0], expected_0_0, atol=1e-3)
    assert np.all(np.isfinite(lst_c))
    assert np.all(lst_c >= -20)
    assert np.all(lst_c <= 70)


def test_calibrate_lst_masked_and_nodata():
    """Verify nodata values and Landsat 0-fill values are masked to NaN."""
    nodata_val = 65535
    raw_dn = np.array([
        [0, 44000],              # 0 is standard fill
        [nodata_val, 45000],     # nodata_val is custom nodata
    ], dtype=np.uint16)

    lst_c = calibrate_lst(raw_dn, nodata=nodata_val)

    assert np.isnan(lst_c[0, 0])
    assert np.isnan(lst_c[1, 0])
    assert np.isfinite(lst_c[0, 1])
    assert np.isfinite(lst_c[1, 1])


def test_calibrate_lst_empty_window():
    """Verify empty raster window returns an empty array safely without error."""
    empty_dn = np.empty((0, 0), dtype=np.uint16)
    lst_c = calibrate_lst(empty_dn)
    assert lst_c.shape == (0, 0)
    assert lst_c.size == 0


def test_calibrate_lst_invalid_and_nonfinite():
    """Verify out-of-range, non-finite, and implausible temperatures are masked."""
    # DN 500  -> ~ -122 °C (too cold)
    # DN 65000 -> ~ 98 °C (too hot)
    raw_dn = np.array([500, 65000], dtype=np.float32)
    lst_c = calibrate_lst(raw_dn)
    assert np.isnan(lst_c[0])
    assert np.isnan(lst_c[1])

    # Test array with non-finite values
    raw_with_inf = np.array([np.inf, -np.inf, np.nan, 44000], dtype=np.float32)
    lst_c2 = calibrate_lst(raw_with_inf)
    assert np.isnan(lst_c2[0])
    assert np.isnan(lst_c2[1])
    assert np.isnan(lst_c2[2])
    assert np.isfinite(lst_c2[3])
