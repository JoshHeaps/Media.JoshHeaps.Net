-- Medical document costs
CREATE TABLE IF NOT EXISTS app.medical_document_costs (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES app.medical_documents(id) ON DELETE CASCADE,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    cost_type VARCHAR(50) NULL, -- copay, deductible, out_of_pocket, etc.
    category VARCHAR(50) NULL, -- office_visit, lab, pharmacy, etc.
    cost_date DATE NULL,
    description TEXT NULL,
    source VARCHAR(10) NOT NULL DEFAULT 'manual', -- 'ai' or 'manual'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_document_costs_document_id ON app.medical_document_costs(document_id);
CREATE INDEX IF NOT EXISTS idx_medical_document_costs_person_id ON app.medical_document_costs(person_id);
