-- Medical conditions linked to people
CREATE TABLE IF NOT EXISTS app.medical_conditions (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    diagnosed_date DATE NULL,
    notes TEXT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_conditions_person_id ON app.medical_conditions(person_id);
