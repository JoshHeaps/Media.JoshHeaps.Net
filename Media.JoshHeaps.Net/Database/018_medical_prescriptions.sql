-- Medical prescriptions and pickup tracking
CREATE TABLE IF NOT EXISTS app.medical_prescriptions (
    id BIGSERIAL PRIMARY KEY,
    person_id BIGINT NOT NULL REFERENCES app.medical_people(id) ON DELETE CASCADE,
    doctor_id BIGINT NULL REFERENCES app.medical_doctors(id) ON DELETE SET NULL,
    medication_name VARCHAR(255) NOT NULL,
    dosage VARCHAR(100) NULL,
    frequency VARCHAR(100) NULL,
    is_active BOOLEAN DEFAULT true,
    start_date DATE NULL,
    end_date DATE NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_person_id ON app.medical_prescriptions(person_id);
CREATE INDEX IF NOT EXISTS idx_medical_prescriptions_doctor_id ON app.medical_prescriptions(doctor_id);

CREATE TABLE IF NOT EXISTS app.medical_prescription_pickups (
    id BIGSERIAL PRIMARY KEY,
    prescription_id BIGINT NOT NULL REFERENCES app.medical_prescriptions(id) ON DELETE CASCADE,
    document_id BIGINT NULL REFERENCES app.medical_documents(id) ON DELETE SET NULL,
    pickup_date DATE NOT NULL,
    quantity VARCHAR(100) NULL,
    pharmacy VARCHAR(255) NULL,
    cost DECIMAL(10,2) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_medical_prescription_pickups_prescription_id ON app.medical_prescription_pickups(prescription_id);
