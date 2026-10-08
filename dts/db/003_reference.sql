-- =====================================================================
-- 003_reference.sql -- reference data
--
-- Everything here is editable by an administrator through the interface.
-- Adding a disease or a department requires no change to program code.
-- =====================================================================

BEGIN;

INSERT INTO age_groups (label, sort_order) VALUES
    ('Under 5',   1),
    ('5 to 14',   2),
    ('15 to 44',  3),
    ('45 to 64',  4),
    ('65 and over', 5)
ON CONFLICT (label) DO NOTHING;

INSERT INTO departments (name, code) VALUES
    ('General Outpatient Clinic', 'GOPD'),
    ('Accident and Emergency',    'A&E'),
    ('Paediatrics',               'PAED'),
    ('Internal Medicine',         'MED'),
    ('Obstetrics and Gynaecology','O&G'),
    ('Community Health Centre',   'CHC')
ON CONFLICT (code) DO NOTHING;

INSERT INTO diseases (name, code, category, is_notifiable) VALUES
    ('Malaria',                     'MAL',  'Communicable',     FALSE),
    ('Typhoid Fever',               'TYP',  'Communicable',     FALSE),
    ('Diarrhoeal Disease',          'DIA',  'Communicable',     FALSE),
    ('Acute Respiratory Infection', 'ARI',  'Communicable',     FALSE),
    ('Cholera',                     'CHO',  'Communicable',     TRUE),
    ('Lassa Fever',                 'LAS',  'Communicable',     TRUE),
    ('Measles',                     'MEA',  'Communicable',     TRUE),
    ('Hypertension',                'HTN',  'Non-communicable', FALSE),
    ('Diabetes Mellitus',           'DM',   'Non-communicable', FALSE),
    ('Anaemia',                     'ANA',  'Other',            FALSE)
ON CONFLICT (code) DO NOTHING;

COMMIT;
