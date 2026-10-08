-- =====================================================================
-- 002_analysis.sql -- the analytical layer
--
-- Aggregation, ranking, seasonal profiling and baseline computation are
-- expressed here as database objects rather than as JavaScript. The
-- engine is optimised for set operations, less data crosses the wire,
-- and each rule can be inspected and tested on its own (section 2.2.9).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- vw_monthly_totals : the spine of every trend chart. One row per
-- disease per month, summed across departments, age groups and sexes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_monthly_totals AS
SELECT  d.id                AS disease_id,
        d.name              AS disease_name,
        p.id                AS period_id,
        p.year,
        p.month,
        p.ordinal,
        SUM(c.case_count)::INTEGER AS total_cases
FROM        case_counts c
JOIN        diseases    d ON d.id = c.disease_id
JOIN        periods     p ON p.id = c.period_id
GROUP BY    d.id, d.name, p.id, p.year, p.month, p.ordinal;

-- ---------------------------------------------------------------------
-- vw_disease_burden : ranking of diseases by caseload. Bars share a
-- common baseline and length is the visual variable people judge most
-- accurately, so this feeds a horizontal bar chart (section 2.2.7).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_disease_burden AS
SELECT  d.id            AS disease_id,
        d.name          AS disease_name,
        d.category,
        d.is_notifiable,
        p.year,
        SUM(c.case_count)::INTEGER AS total_cases
FROM        case_counts c
JOIN        diseases    d ON d.id = c.disease_id
JOIN        periods     p ON p.id = c.period_id
GROUP BY    d.id, d.name, d.category, d.is_notifiable, p.year;

-- ---------------------------------------------------------------------
-- vw_demographics : the "person" axis. A stable total can hide a rise
-- in one age group offset by a fall in another, which is exactly what
-- this view exists to expose.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_demographics AS
SELECT  d.id        AS disease_id,
        d.name      AS disease_name,
        p.year,
        a.id        AS age_group_id,
        a.label     AS age_group,
        a.sort_order,
        c.sex,
        SUM(c.case_count)::INTEGER AS total_cases
FROM        case_counts c
JOIN        diseases    d ON d.id = c.disease_id
JOIN        periods     p ON p.id = c.period_id
JOIN        age_groups  a ON a.id = c.age_group_id
GROUP BY    d.id, d.name, p.year, a.id, a.label, a.sort_order, c.sex;

-- ---------------------------------------------------------------------
-- vw_department_load : the "place" axis.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_department_load AS
SELECT  dep.id      AS department_id,
        dep.name    AS department_name,
        p.year,
        p.month,
        SUM(c.case_count)::INTEGER AS total_cases
FROM        case_counts c
JOIN        departments dep ON dep.id = c.department_id
JOIN        periods     p   ON p.id   = c.period_id
GROUP BY    dep.id, dep.name, p.year, p.month;

-- ---------------------------------------------------------------------
-- vw_seasonal_profile : the average caseload for each calendar month,
-- computed across all years held. years_contributing is reported
-- alongside the mean so the user can judge how much weight the profile
-- bears -- a profile from one year is that year, not a pattern.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_seasonal_profile AS
SELECT  disease_id,
        disease_name,
        month,
        ROUND(AVG(total_cases), 1)                    AS mean_cases,
        ROUND(COALESCE(STDDEV_SAMP(total_cases), 0), 1) AS sd_cases,
        MIN(total_cases)                              AS min_cases,
        MAX(total_cases)                              AS max_cases,
        COUNT(*)::INTEGER                             AS years_contributing
FROM        vw_monthly_totals
GROUP BY    disease_id, disease_name, month;

-- ---------------------------------------------------------------------
-- vw_reporting_completeness : which departments have submitted for a
-- given month. Missing data is displayed as missing.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_reporting_completeness AS
SELECT  p.id    AS period_id,
        p.year,
        p.month,
        COUNT(*) FILTER (WHERE rs.status = 'submitted')::INTEGER AS submitted,
        COUNT(*)::INTEGER                                        AS expected,
        ROUND(
            100.0 * COUNT(*) FILTER (WHERE rs.status = 'submitted') / NULLIF(COUNT(*), 0)
        , 1) AS completeness_pct
FROM        periods p
CROSS JOIN  departments dep
LEFT JOIN   return_status rs
       ON   rs.period_id = p.id AND rs.department_id = dep.id
WHERE       dep.is_active
GROUP BY    p.id, p.year, p.month;

-- =====================================================================
-- fn_baseline : the seasonally corrected expectation.
--
-- The baseline for August is drawn from previous AUGUSTS, not from the
-- months immediately preceding it. A baseline taken from adjacent
-- months is systematically wrong for any seasonal condition, because
-- the months before a peak are by definition low (section 2.2.5).
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_baseline(
    p_disease_id INTEGER,
    p_year       SMALLINT,
    p_month      SMALLINT
)
RETURNS TABLE (
    baseline_mean     NUMERIC,
    baseline_sd       NUMERIC,
    years_in_baseline INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT  ROUND(COALESCE(AVG(v.total_cases), 0), 2),
            ROUND(COALESCE(STDDEV_SAMP(v.total_cases), 0), 2),
            COUNT(*)::INTEGER
    FROM    vw_monthly_totals v
    WHERE   v.disease_id = p_disease_id
      AND   v.month      = p_month
      AND   v.year       < p_year;      -- history only, never the month itself
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================================
-- fn_evaluate_period : run the threshold rule across every disease for
-- one month and write the results into alerts.
--
-- A flag means the count is statistically high against its own history.
-- It does not mean an outbreak has occurred. It is an invitation to
-- investigate, and the interface says so.
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_evaluate_period(
    p_period_id  INTEGER,
    p_multiplier NUMERIC DEFAULT 2.0
)
RETURNS INTEGER AS $$
DECLARE
    v_year       SMALLINT;
    v_month      SMALLINT;
    v_row        RECORD;
    v_base       RECORD;
    v_sd         NUMERIC;
    v_threshold  NUMERIC;
    v_confidence VARCHAR(10);
    v_flagged    INTEGER := 0;
    -- Minimum proportional rise before anything is flagged. Without it a
    -- disease with a tight baseline trips on ordinary month-to-month
    -- movement, and an alert list nobody trusts is worse than none.
    c_min_ratio  CONSTANT NUMERIC := 1.25;
BEGIN
    SELECT year, month INTO v_year, v_month FROM periods WHERE id = p_period_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown period id %', p_period_id;
    END IF;

    FOR v_row IN
        SELECT disease_id, total_cases
        FROM   vw_monthly_totals
        WHERE  period_id = p_period_id
    LOOP
        SELECT * INTO v_base
        FROM   fn_baseline(v_row.disease_id, v_year, v_month);

        -- Fewer than two prior years gives no defensible spread. The rule
        -- declines to compute rather than dressing up ignorance as evidence.
        IF v_base.years_in_baseline < 2 THEN
            CONTINUE;
        END IF;

        v_confidence := CASE
            WHEN v_base.years_in_baseline >= 3 THEN 'high'
            ELSE 'moderate'
        END;

        -- Case counts behave roughly like Poisson data, where the variance
        -- tracks the mean. A sample standard deviation taken from three or
        -- four observations can fall far below that and produce a threshold
        -- only a few cases above the mean. Holding the spread at no less
        -- than the square root of the mean keeps the rule honest on
        -- short baselines.
        v_sd := GREATEST(v_base.baseline_sd, SQRT(GREATEST(v_base.baseline_mean, 0)));

        v_threshold := GREATEST(
            v_base.baseline_mean + (p_multiplier * v_sd),
            v_base.baseline_mean * c_min_ratio
        );

        IF v_row.total_cases > v_threshold AND v_threshold > 0 THEN
            INSERT INTO alerts (
                disease_id, period_id, observed, baseline_mean, baseline_sd,
                threshold, multiplier, years_in_baseline, confidence
            ) VALUES (
                v_row.disease_id, p_period_id, v_row.total_cases,
                v_base.baseline_mean, ROUND(v_sd, 2),
                ROUND(v_threshold, 2), p_multiplier,
                v_base.years_in_baseline, v_confidence
            )
            ON CONFLICT (disease_id, period_id) DO UPDATE
                SET observed          = EXCLUDED.observed,
                    baseline_mean     = EXCLUDED.baseline_mean,
                    baseline_sd       = EXCLUDED.baseline_sd,
                    threshold         = EXCLUDED.threshold,
                    multiplier        = EXCLUDED.multiplier,
                    years_in_baseline = EXCLUDED.years_in_baseline,
                    confidence        = EXCLUDED.confidence,
                    generated_at      = NOW();
            v_flagged := v_flagged + 1;
        END IF;
    END LOOP;

    RETURN v_flagged;
END;
$$ LANGUAGE plpgsql;

COMMIT;
