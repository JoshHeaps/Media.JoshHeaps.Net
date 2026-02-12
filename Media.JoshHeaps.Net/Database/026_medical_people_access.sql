CREATE TABLE IF NOT EXISTS app.medical_people_access (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mpa_user_id ON app.medical_people_access(user_id);
CREATE INDEX IF NOT EXISTS idx_mpa_person_id ON app.medical_people_access(person_id);
