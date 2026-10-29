"""Unit tests for Penguin Volatility Engine (Nasdaq-100)."""

import math
import unittest
import numpy as np
from core.volatility_engine import (
    rma,
    compute_bb_kc_indicators,
    compute_forward_cone,
)


class TestVolatilityEngine(unittest.TestCase):
    def test_rma_wilder(self):
        """Verify RMA matches Wilder's alpha = 1 / length."""
        data = np.array([10.0, 11.0, 12.0, 13.0, 14.0])
        res = rma(data, length=3)
        # First valid value is SMA of first 3 elements: (10 + 11 + 12) / 3 = 11.0
        self.assertAlmostEqual(res[2], 11.0, places=4)
        # Next value: (11.0 * 2 + 13.0) / 3 = 35 / 3 = 11.66667
        self.assertAlmostEqual(res[3], 35.0 / 3.0, places=4)

    def test_bb_kc_flat_case(self):
        """Verify BB vs KC spread when price is constant (SD = 0)."""
        n = 30
        high = np.full(n, 102.0)
        low = np.full(n, 98.0)
        close = np.full(n, 100.0)

        ind = compute_bb_kc_indicators(high, low, close, period=20)
        # When SD = 0 and ATR = 4, UpperBB = 100, UpperKC = 100 + 2*4 = 108
        # diff = (100 - 108) / 108 * 100 = -8 / 108 * 100 = -7.4074%
        expected_diff = (100.0 - 108.0) / 108.0 * 100.0
        self.assertAlmostEqual(ind["diff"][-1], expected_diff, places=3)
        # Constant price means diff <= 0 (Squeeze)
        self.assertLess(ind["diff"][-1], 0)

    def test_forward_cone(self):
        """Verify 2SD forward cone formula."""
        res = compute_forward_cone(current_price=100.0, sigma_ann=0.20, horizon_days=60)
        days = res["days"]
        upper = res["upper"]
        lower = res["lower"]

        self.assertEqual(len(days), 60)
        self.assertEqual(len(upper), 60)
        self.assertEqual(len(lower), 60)

        # At day 0 (t = 1)
        t_1 = 1.0 / 252.0
        expected_up_1 = 100.0 * math.exp(-0.5 * (0.20 ** 2) * t_1 + 2.0 * 0.20 * math.sqrt(t_1))
        expected_low_1 = 100.0 * math.exp(-0.5 * (0.20 ** 2) * t_1 - 2.0 * 0.20 * math.sqrt(t_1))
        self.assertAlmostEqual(upper[0], round(expected_up_1, 2), places=2)
        self.assertAlmostEqual(lower[0], round(expected_low_1, 2), places=2)

        # At day 60 (t = 60)
        t_60 = 60.0 / 252.0
        expected_up_60 = 100.0 * math.exp(-0.5 * (0.20 ** 2) * t_60 + 2.0 * 0.20 * math.sqrt(t_60))
        expected_low_60 = 100.0 * math.exp(-0.5 * (0.20 ** 2) * t_60 - 2.0 * 0.20 * math.sqrt(t_60))
        self.assertAlmostEqual(upper[-1], round(expected_up_60, 2), places=2)
        self.assertAlmostEqual(lower[-1], round(expected_low_60, 2), places=2)


if __name__ == "__main__":
    unittest.main()
