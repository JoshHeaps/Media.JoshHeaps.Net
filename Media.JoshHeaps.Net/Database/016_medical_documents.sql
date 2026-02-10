-- Core medical documents table
CREATE TABLE IF NOT EXISTS app.medical_documents (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    document_type VARCHAR(10) NOT NULL DEFAULT 'file', -- 'file' or 'note'
    file_name VARCHAR(255) NULL,
    file_path VARCHAR(500) NULL,
    file_size BIGINT NULL,
    mime_type VARCHAR(100) NULL,
    is_encrypted BOOLEAN DEFAULT true,
    title VARCHAR(500) NULL,
    description TEXT NULL,
    document_date DATE NULL, -- the date OF the document
    classification VARCHAR(100) NULL, -- receipt, lab_result, prescription, imaging, etc.
    extracted_text TEXT NULL,
    ai_processed BOOLEAN DEFAULT false,
    ai_processed_at TIMESTAMP NULL,
    ai_raw_response JSONB NULL,
    doctor_id BIGINT NULL REFERENCES app.medical_doctors(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_documents_person_id ON app.medical_documents(person_id);
CREATE INDEX IF NOT EXISTS idx_medical_documents_doctor_id ON app.medical_documents(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medical_documents_classification ON app.medical_documents(classification);
CREATE INDEX IF NOT EXISTS idx_medical_documents_document_date ON app.medical_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_medical_documents_created_at ON app.medical_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_medical_documents_ai_processed ON app.medical_documents(ai_processed);
