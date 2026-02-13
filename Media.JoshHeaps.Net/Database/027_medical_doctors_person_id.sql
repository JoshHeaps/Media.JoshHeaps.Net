-- Add person_id to medical_doctors to scope doctors per person

ALTER TABLE app.medical_doctors ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES app.medical_people(id);

CREATE INDEX IF NOT EXISTS idx_medical_doctors_person_id ON app.medical_doctors(person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_medical_doctors_person_name
    ON app.medical_doctors(person_id, LOWER(name)) WHERE person_id IS NOT NULL;
