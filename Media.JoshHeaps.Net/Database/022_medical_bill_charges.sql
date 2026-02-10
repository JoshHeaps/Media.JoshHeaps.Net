-- Migration 022: Bill Line Items (Charges)
-- Breaks down bill totals into individual named charges.

CREATE TABLE IF NOT EXISTS app.medical_bill_charges (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES app.medical_bills(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    source VARCHAR(10) NOT NULL DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
