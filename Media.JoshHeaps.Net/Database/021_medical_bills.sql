-- Migration 021: Medical Bills & Payments
-- Replaces the flat medical_document_costs model with proper billing:
-- Bills (charges) with Payments (receipts) tracked against them.

CREATE TABLE IF NOT EXISTS app.medical_bills (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    total_amount DECIMAL(10,2) NOT NULL,
    summary TEXT,
    category VARCHAR(50),
    bill_date DATE,
    doctor_id BIGINT REFERENCES app.medical_doctors(id) ON DELETE SET NULL,
    source VARCHAR(10) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app.medical_bill_documents (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES app.medical_bills(id) ON DELETE CASCADE,
    document_id BIGINT NOT NULL REFERENCES app.medical_documents(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(bill_id, document_id)
);

CREATE TABLE IF NOT EXISTS app.medical_bill_payments (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES app.medical_bills(id) ON DELETE CASCADE,
    document_id BIGINT REFERENCES app.medical_documents(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    payment_type VARCHAR(30) NOT NULL,
    payment_date DATE,
    description TEXT,
    source VARCHAR(10) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
