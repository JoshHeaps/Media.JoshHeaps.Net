-- 023: Medical billing providers
-- Providers are the top-level billing entity. Bills belong to a provider, payments go to a provider.

CREATE TABLE IF NOT EXISTS app.medical_billing_providers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_providers_name_person
    ON app.medical_billing_providers (LOWER(name), person_id);

ALTER TABLE app.medical_bills ADD COLUMN IF NOT EXISTS provider_id BIGINT
    REFERENCES app.medical_billing_providers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS app.medical_provider_payments (
    id BIGSERIAL PRIMARY KEY,
    provider_id BIGINT NOT NULL REFERENCES app.medical_billing_providers(id) ON DELETE CASCADE,
    document_id BIGINT REFERENCES app.medical_documents(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_date DATE,
    description TEXT,
    source VARCHAR(10) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
