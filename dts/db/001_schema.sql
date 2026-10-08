-- =====================================================================
-- Web-Based Disease Trend Analysis and Reporting System
-- 001_schema.sql  -- tables, constraints and indexes
--
-- Design note: this schema stores AGGREGATE counts only. There is no
-- table, column or index anywhere in this file capable of holding a
-- patient name, hospital number, address or date of birth. That is a
-- deliberate design decision, not an omission (see Chapter Three).
-- =====================================================================

BEGIN;

DROP TABLE IF EXISTS audit_log        CASCADE;
DROP TABLE IF EXISTS alerts           CASCADE;
DROP TABLE IF EXISTS return_status    CASCADE;
DROP TABLE IF EXISTS case_counts      CASCADE;
DROP TABLE IF EXISTS periods          CASCADE;
DROP TABLE IF EXISTS age_groups       CASCADE;
DROP TABLE IF EXISTS diseases         CASCADE;
DROP TABLE IF EXISTS departments      CASCADE;
DROP TABLE IF EXISTS users            CASCADE;

-- ---------------------------------------------------------------------
-- users : system accounts. Role decides what a person may do.
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    full_name       VARCHAR(120) NOT NULL,
    email           VARCHAR(160) NOT NULL UNIQUE,
    password_hash   VARCHAR(120) NOT NULL,
    role            VARCHAR(20)  NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_role
        CHECK (role IN ('administrator', 'records_officer', 'viewer')),
    CONSTRAINT chk_users_email
        CHECK (email = lower(email) AND position('@' IN email) > 1)
);

-- ---------------------------------------------------------------------
-- departments : the reporting units inside the hospital (the "place"
-- axis of descriptive epidemiology).
-- ---------------------------------------------------------------------
CREATE TABLE departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(120) NOT NULL UNIQUE,
    code        VARCHAR(12)  NOT NULL UNIQUE,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- diseases : reference list, editable by an administrator without any
-- change to program code (the flexibility attribute, Chapter Two).
-- ---------------------------------------------------------------------
CREATE TABLE diseases (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL UNIQUE,
    code            VARCHAR(12)  NOT NULL UNIQUE,
    category        VARCHAR(40)  NOT NULL,
    is_notifiable   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_disease_category
        CHECK (category IN ('Communicable', 'Non-communicable', 'Other'))
);

-- ---------------------------------------------------------------------
-- age_groups : broad bands only. Narrow bands would raise the
-- statistical disclosure risk discussed in section 2.2.12.
-- ---------------------------------------------------------------------
CREATE TABLE age_groups (
    id          SERIAL PRIMARY KEY,
    label       VARCHAR(20) NOT NULL UNIQUE,
    sort_order  SMALLINT    NOT NULL UNIQUE
);

-- ---------------------------------------------------------------------
-- periods : one row per calendar month. Year and month are held as
-- separate columns because the seasonal queries group by month across
-- years, which a single DATE column makes awkward.
-- ---------------------------------------------------------------------
CREATE TABLE periods (
    id          SERIAL PRIMARY KEY,
    year        SMALLINT NOT NULL,
    month       SMALLINT NOT NULL,
    ordinal     INTEGER  GENERATED ALWAYS AS (year * 12 + month) STORED,
    CONSTRAINT uq_period UNIQUE (year, month),
    CONSTRAINT chk_period_month CHECK (month BETWEEN 1 AND 12),
    CONSTRAINT chk_period_year  CHECK (year BETWEEN 2000 AND 2100)
);

-- ---------------------------------------------------------------------
-- case_counts : the fact table. One row is the number of cases of one
-- disease, in one department, in one month, for one age group and one
-- sex. Zeros are stored explicitly so that "no cases" is distinguishable
-- from "no report submitted" (section 2.2.10).
-- ---------------------------------------------------------------------
CREATE TABLE case_counts (
    id              BIGSERIAL PRIMARY KEY,
    disease_id      INTEGER  NOT NULL REFERENCES diseases(id)    ON DELETE RESTRICT,
    period_id       INTEGER  NOT NULL REFERENCES periods(id)     ON DELETE RESTRICT,
    department_id   INTEGER  NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    age_group_id    INTEGER  NOT NULL REFERENCES age_groups(id)  ON DELETE RESTRICT,
    sex             CHAR(1)  NOT NULL,
    case_count      INTEGER  NOT NULL,
    entered_by      INTEGER  REFERENCES users(id) ON DELETE SET NULL,
    entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_count_non_negative CHECK (case_count >= 0),
    CONSTRAINT chk_count_plausible    CHECK (case_count <= 100000),
    CONSTRAINT chk_sex                CHECK (sex IN ('M', 'F')),
    -- stops the same cell being entered twice, the commonest data
    -- entry error in this setting
    CONSTRAINT uq_case_cell UNIQUE (disease_id, period_id, department_id, age_group_id, sex)
);

CREATE INDEX idx_cc_period          ON case_counts (period_id);
CREATE INDEX idx_cc_disease_period  ON case_counts (disease_id, period_id);
CREATE INDEX idx_cc_department      ON case_counts (department_id, period_id);

-- ---------------------------------------------------------------------
-- return_status : whether a department has submitted its return for a
-- given month. This is what lets the dashboard show missing data as
-- missing rather than silently rendering it as absence of disease.
-- ---------------------------------------------------------------------
CREATE TABLE return_status (
    id              SERIAL PRIMARY KEY,
    department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    period_id       INTEGER NOT NULL REFERENCES periods(id)     ON DELETE CASCADE,
    status          VARCHAR(12) NOT NULL DEFAULT 'pending',
    submitted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    submitted_at    TIMESTAMPTZ,
    CONSTRAINT uq_return UNIQUE (department_id, period_id),
    CONSTRAINT chk_return_status CHECK (status IN ('pending', 'submitted'))
);

-- ---------------------------------------------------------------------
-- alerts : the output of the aberration detection rule. Stored rather
-- than recomputed on every page load so that the history of what was
-- flagged, and what an officer did about it, is auditable.
-- ---------------------------------------------------------------------
CREATE TABLE alerts (
    id                  BIGSERIAL PRIMARY KEY,
    disease_id          INTEGER NOT NULL REFERENCES diseases(id) ON DELETE CASCADE,
    period_id           INTEGER NOT NULL REFERENCES periods(id)  ON DELETE CASCADE,
    observed            INTEGER NOT NULL,
    baseline_mean       NUMERIC(10,2) NOT NULL,
    baseline_sd         NUMERIC(10,2) NOT NULL,
    threshold           NUMERIC(10,2) NOT NULL,
    multiplier          NUMERIC(4,2)  NOT NULL,
    years_in_baseline   SMALLINT NOT NULL,
    confidence          VARCHAR(10) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'open',
    reviewed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    review_note         TEXT,
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_alert UNIQUE (disease_id, period_id),
    CONSTRAINT chk_alert_status     CHECK (status IN ('open', 'investigating', 'closed')),
    CONSTRAINT chk_alert_confidence CHECK (confidence IN ('high', 'moderate', 'low'))
);

CREATE INDEX idx_alerts_status ON alerts (status, generated_at DESC);

-- ---------------------------------------------------------------------
-- audit_log : who did what, and when. A control on error as much as on
-- misconduct (section 2.2.11).
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(40)  NOT NULL,
    entity      VARCHAR(40)  NOT NULL,
    entity_id   VARCHAR(60),
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

-- ---------------------------------------------------------------------
-- keep updated_at honest on edits
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_case_counts_touch
    BEFORE UPDATE ON case_counts
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

COMMIT;
