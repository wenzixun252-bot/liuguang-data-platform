"""评分辅助函数测试。"""

import pytest


class TestTierScore:
    """阶梯插值函数测试。"""

    def test_highest_tier(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.95, tiers) == 38  # (0.95-0.85)/(1.0-0.85)=0.667 -> 36+int(0.667*4)=38

    def test_mid_tier(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36), (0.50, 0.70, 20, 28), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.75, tiers) == 30  # (0.75-0.70)/(0.85-0.70)=0.333 -> 28+int(0.333*8)=30

    def test_below_all_tiers(self):
        from app.api.assets import _tier_score
        tiers = [(0.30, 0.50, 12, 20), (0.10, 0.30, 5, 12)]
        assert _tier_score(0.05, tiers) == 0

    def test_exact_boundary(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.70, 0.85, 28, 36)]
        assert _tier_score(0.85, tiers) == 36  # exactly on boundary -> min of that tier

    def test_zero_value(self):
        from app.api.assets import _tier_score
        tiers = [(0.85, 1.0, 36, 40), (0.0, 0.30, 0, 12)]
        assert _tier_score(0.0, tiers) == 0

    def test_quality_avg_tiers_full_range(self):
        """验证 ETL 质量均分阶梯常量的完整区间覆盖。"""
        from app.api.assets import _tier_score, _QUALITY_AVG_TIERS
        assert _tier_score(1.0, _QUALITY_AVG_TIERS) == 40  # max
        assert _tier_score(0.5, _QUALITY_AVG_TIERS) == 20  # mid boundary
        assert _tier_score(0.0, _QUALITY_AVG_TIERS) == 0   # min

    def test_high_quality_tiers_full_range(self):
        """验证高质量占比阶梯常量的完整区间覆盖。"""
        from app.api.assets import _tier_score, _HIGH_QUALITY_TIERS
        assert _tier_score(1.0, _HIGH_QUALITY_TIERS) == 35  # max
        assert _tier_score(0.0, _HIGH_QUALITY_TIERS) == 0   # min


class TestLogScore:
    """对数曲线评分测试。"""

    def test_zero(self):
        from app.api.assets import _log_score
        assert _log_score(0) == 0

    def test_max_ref(self):
        from app.api.assets import _log_score
        assert _log_score(500, 500) == 100

    def test_custom_max(self):
        from app.api.assets import _log_score
        score = _log_score(1000, 1000)
        assert score == 100

    def test_half_log(self):
        from app.api.assets import _log_score
        score = _log_score(22, 500)  # log(23)/log(501) ≈ 0.504
        assert 45 <= score <= 55


class TestLevel:
    """等级映射测试。"""

    def test_levels(self):
        from app.api.assets import _level
        assert _level(95) == "卓越"
        assert _level(90) == "卓越"
        assert _level(75) == "优秀"
        assert _level(70) == "优秀"
        assert _level(55) == "良好"
        assert _level(50) == "良好"
        assert _level(40) == "待提升"
        assert _level(0) == "待提升"
