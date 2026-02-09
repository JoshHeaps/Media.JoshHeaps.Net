-- Medical tags and document-tag junction
CREATE TABLE IF NOT EXISTS app.medical_tags (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app.medical_document_tags (
    document_id BIGINT NOT NULL REFERENCES app.medical_documents(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES app.medical_tags(id) ON DELETE CASCADE,
    source VARCHAR(10) NOT NULL DEFAULT 'manual', -- 'ai' or 'manual'
    CONSTRAINT uq_medical_document_tag UNIQUE (document_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_medical_document_tags_document_id ON app.medical_document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_medical_document_tags_tag_id ON app.medical_document_tags(tag_id);
