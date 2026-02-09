-- Junction table linking medical documents to conditions
CREATE TABLE IF NOT EXISTS app.medical_document_conditions (
    document_id BIGINT NOT NULL REFERENCES app.medical_documents(id) ON DELETE CASCADE,
    condition_id BIGINT NOT NULL REFERENCES app.medical_conditions(id) ON DELETE CASCADE,
    CONSTRAINT uq_medical_document_condition UNIQUE (document_id, condition_id)
);

CREATE INDEX IF NOT EXISTS idx_medical_document_conditions_document_id ON app.medical_document_conditions(document_id);
CREATE INDEX IF NOT EXISTS idx_medical_document_conditions_condition_id ON app.medical_document_conditions(condition_id);
