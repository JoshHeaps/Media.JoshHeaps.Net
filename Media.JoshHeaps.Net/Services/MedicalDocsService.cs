using Media.JoshHeaps.Net.Models;

namespace Media.JoshHeaps.Net.Services;

public class MedicalDocsService(DbExecutor db, IWebHostEnvironment environment, EncryptionService encryption, ILogger<MedicalDocsService> logger)
{
    // --- People ---

    public async Task<List<MedicalPerson>> GetPeopleAsync()
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id, name, date_of_birth, notes, created_at, updated_at FROM app.medical_people ORDER BY name",
                reader => new MedicalPerson
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    DateOfBirth = reader.IsDBNull(2) ? null : reader.GetDateTime(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get medical people");
            return [];
        }
    }

    public async Task<MedicalPerson?> CreatePersonAsync(string name, DateTime? dateOfBirth = null, string? notes = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_people (name, date_of_birth, notes, created_at, updated_at)
                  VALUES (@name, @dateOfBirth, @notes, @createdAt, @updatedAt)
                  RETURNING id, name, date_of_birth, notes, created_at, updated_at",
                reader => new MedicalPerson
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    DateOfBirth = reader.IsDBNull(2) ? null : reader.GetDateTime(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5)
                },
                new { name, dateOfBirth, notes, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create medical person");
            return null;
        }
    }

    // --- Documents ---

    public async Task<MedicalDocument?> SaveDocumentAsync(long personId, IFormFile file, string? title = null, string? description = null, DateTime? documentDate = null, string? classification = null)
    {
        string? tempFilePath = null;
        string? encryptedFilePath = null;

        try
        {
            var fileExtension = Path.GetExtension(file.FileName);
            var uniqueFileName = $"{Guid.NewGuid()}{fileExtension}.enc";

            var mediaFolder = Path.Combine(environment.ContentRootPath, "App_Data", "medical", personId.ToString());
            Directory.CreateDirectory(mediaFolder);

            tempFilePath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
            encryptedFilePath = Path.Combine(mediaFolder, uniqueFileName);

            using (var fileStream = new FileStream(tempFilePath, FileMode.Create))
            {
                await file.CopyToAsync(fileStream);
            }

            await encryption.EncryptFileAsync(tempFilePath, encryptedFilePath);

            File.Delete(tempFilePath);
            tempFilePath = null;

            var relativeFilePath = Path.Combine("App_Data", "medical", personId.ToString(), uniqueFileName);
            var now = DateTime.UtcNow;

            var doc = await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_documents (person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, created_at, updated_at)
                  VALUES (@personId, 'file', @fileName, @filePath, @fileSize, @mimeType, true, @title, @description, @documentDate, @classification, @createdAt, @updatedAt)
                  RETURNING id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at",
                MapDocument,
                new
                {
                    personId,
                    fileName = file.FileName,
                    filePath = relativeFilePath,
                    fileSize = file.Length,
                    mimeType = file.ContentType,
                    title,
                    description,
                    documentDate,
                    classification,
                    createdAt = now,
                    updatedAt = now
                });

            return doc;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to save medical document for person {PersonId}", personId);

            if (tempFilePath != null && File.Exists(tempFilePath))
            {
                try { File.Delete(tempFilePath); } catch { }
            }
            if (encryptedFilePath != null && File.Exists(encryptedFilePath))
            {
                try { File.Delete(encryptedFilePath); } catch { }
            }

            return null;
        }
    }

    public async Task<MedicalDocument?> SaveNoteAsync(long personId, string title, string description, DateTime? documentDate = null, string? classification = null)
    {
        try
        {
            var now = DateTime.UtcNow;

            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_documents (person_id, document_type, title, description, document_date, classification, is_encrypted, created_at, updated_at)
                  VALUES (@personId, 'note', @title, @description, @documentDate, @classification, false, @createdAt, @updatedAt)
                  RETURNING id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at",
                MapDocument,
                new { personId, title, description, documentDate, classification, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to save medical note for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<List<MedicalDocument>> GetDocumentsAsync(long? personId = null, int offset = 0, int limit = 50)
    {
        try
        {
            string query;
            object parameters;

            if (personId.HasValue)
            {
                query = @"SELECT id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at
                          FROM app.medical_documents
                          WHERE person_id = @personId
                          ORDER BY created_at DESC
                          OFFSET @offset LIMIT @limit";
                parameters = new { personId = personId.Value, offset, limit };
            }
            else
            {
                query = @"SELECT id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at
                          FROM app.medical_documents
                          ORDER BY created_at DESC
                          OFFSET @offset LIMIT @limit";
                parameters = new { offset, limit };
            }

            return await db.ExecuteListReaderAsync(query, MapDocument, parameters);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get medical documents");
            return [];
        }
    }

    public async Task<MedicalDocument?> GetDocumentByIdAsync(long documentId)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at
                  FROM app.medical_documents
                  WHERE id = @documentId",
                MapDocument,
                new { documentId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get medical document {DocumentId}", documentId);
            return null;
        }
    }

    public async Task<byte[]?> GetDecryptedDocumentDataAsync(long documentId)
    {
        try
        {
            var doc = await GetDocumentByIdAsync(documentId);
            if (doc == null || doc.DocumentType != "file" || doc.FilePath == null)
                return null;

            var fullPath = Path.Combine(environment.ContentRootPath, doc.FilePath);

            if (!File.Exists(fullPath))
            {
                logger.LogError("Medical document file not found at {FilePath}", fullPath);
                return null;
            }

            if (doc.IsEncrypted)
            {
                return await encryption.DecryptFileAsync(fullPath);
            }
            else
            {
                return await File.ReadAllBytesAsync(fullPath);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get decrypted medical document data for {DocumentId}", documentId);
            return null;
        }
    }

    public async Task<bool> DeleteDocumentAsync(long documentId)
    {
        try
        {
            var doc = await GetDocumentByIdAsync(documentId);
            if (doc == null) return false;

            await db.ExecuteNonQueryAsync("DELETE FROM app.medical_documents WHERE id = @documentId", new { documentId });

            if (doc.DocumentType == "file" && doc.FilePath != null)
            {
                var physicalPath = Path.Combine(environment.ContentRootPath, doc.FilePath);
                if (File.Exists(physicalPath))
                {
                    File.Delete(physicalPath);
                }
            }

            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete medical document {DocumentId}", documentId);
            return false;
        }
    }

    // --- Doctors ---

    public async Task<List<MedicalDoctor>> GetDoctorsAsync()
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id, name, specialty, phone, address, notes, created_at, updated_at FROM app.medical_doctors ORDER BY name",
                reader => new MedicalDoctor
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    Specialty = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
                    Address = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Notes = reader.IsDBNull(5) ? null : reader.GetString(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get doctors");
            return [];
        }
    }

    public async Task<MedicalDoctor?> CreateDoctorAsync(string name, string? specialty = null, string? phone = null, string? address = null, string? notes = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_doctors (name, specialty, phone, address, notes, created_at, updated_at)
                  VALUES (@name, @specialty, @phone, @address, @notes, @createdAt, @updatedAt)
                  RETURNING id, name, specialty, phone, address, notes, created_at, updated_at",
                reader => new MedicalDoctor
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    Specialty = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Phone = reader.IsDBNull(3) ? null : reader.GetString(3),
                    Address = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Notes = reader.IsDBNull(5) ? null : reader.GetString(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                },
                new { name, specialty, phone, address, notes, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create doctor");
            return null;
        }
    }

    public async Task<bool> UpdateDoctorAsync(long id, string name, string? specialty = null, string? phone = null, string? address = null, string? notes = null)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_doctors SET name = @name, specialty = @specialty, phone = @phone, address = @address, notes = @notes, updated_at = @updatedAt
                  WHERE id = @id",
                new { id, name, specialty, phone, address, notes, updatedAt = DateTime.UtcNow });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update doctor {DoctorId}", id);
            return false;
        }
    }

    public async Task<bool> DeleteDoctorAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_doctors WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete doctor {DoctorId}", id);
            return false;
        }
    }

    // --- Conditions ---

    public async Task<List<MedicalCondition>> GetConditionsAsync(long personId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id, person_id, name, diagnosed_date, notes, is_active, created_at, updated_at FROM app.medical_conditions WHERE person_id = @personId ORDER BY name",
                reader => new MedicalCondition
                {
                    Id = reader.GetInt64(0),
                    PersonId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    DiagnosedDate = reader.IsDBNull(3) ? null : reader.GetDateTime(3),
                    Notes = reader.IsDBNull(4) ? null : reader.GetString(4),
                    IsActive = reader.GetBoolean(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                },
                new { personId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get conditions for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<MedicalCondition?> CreateConditionAsync(long personId, string name, DateTime? diagnosedDate = null, string? notes = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_conditions (person_id, name, diagnosed_date, notes, created_at, updated_at)
                  VALUES (@personId, @name, @diagnosedDate, @notes, @createdAt, @updatedAt)
                  RETURNING id, person_id, name, diagnosed_date, notes, is_active, created_at, updated_at",
                reader => new MedicalCondition
                {
                    Id = reader.GetInt64(0),
                    PersonId = reader.GetInt64(1),
                    Name = reader.GetString(2),
                    DiagnosedDate = reader.IsDBNull(3) ? null : reader.GetDateTime(3),
                    Notes = reader.IsDBNull(4) ? null : reader.GetString(4),
                    IsActive = reader.GetBoolean(5),
                    CreatedAt = reader.GetDateTime(6),
                    UpdatedAt = reader.GetDateTime(7)
                },
                new { personId, name, diagnosedDate, notes, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create condition for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> UpdateConditionAsync(long id, string name, DateTime? diagnosedDate = null, string? notes = null, bool isActive = true)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_conditions SET name = @name, diagnosed_date = @diagnosedDate, notes = @notes, is_active = @isActive, updated_at = @updatedAt
                  WHERE id = @id",
                new { id, name, diagnosedDate, notes, isActive, updatedAt = DateTime.UtcNow });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update condition {ConditionId}", id);
            return false;
        }
    }

    public async Task<bool> DeleteConditionAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_conditions WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete condition {ConditionId}", id);
            return false;
        }
    }

    // --- Prescriptions ---

    public async Task<List<MedicalPrescription>> GetPrescriptionsAsync(long personId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT p.id, p.person_id, p.doctor_id, p.medication_name, p.dosage, p.frequency, p.is_active, p.start_date, p.end_date, p.notes, p.created_at, p.updated_at,
                         d.name AS doctor_name,
                         (SELECT MAX(pk.pickup_date) FROM app.medical_prescription_pickups pk WHERE pk.prescription_id = p.id) AS last_pickup
                  FROM app.medical_prescriptions p
                  LEFT JOIN app.medical_doctors d ON p.doctor_id = d.id
                  WHERE p.person_id = @personId
                  ORDER BY p.medication_name",
                reader => new MedicalPrescription
                {
                    Id = reader.GetInt64(0),
                    PersonId = reader.GetInt64(1),
                    DoctorId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    MedicationName = reader.GetString(3),
                    Dosage = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Frequency = reader.IsDBNull(5) ? null : reader.GetString(5),
                    IsActive = reader.GetBoolean(6),
                    StartDate = reader.IsDBNull(7) ? null : reader.GetDateTime(7),
                    EndDate = reader.IsDBNull(8) ? null : reader.GetDateTime(8),
                    Notes = reader.IsDBNull(9) ? null : reader.GetString(9),
                    CreatedAt = reader.GetDateTime(10),
                    UpdatedAt = reader.GetDateTime(11),
                    DoctorName = reader.IsDBNull(12) ? null : reader.GetString(12),
                    LastPickupDate = reader.IsDBNull(13) ? null : reader.GetDateTime(13)
                },
                new { personId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get prescriptions for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<MedicalPrescription?> CreatePrescriptionAsync(long personId, string medicationName, string? dosage = null, string? frequency = null, long? doctorId = null, DateTime? startDate = null, string? notes = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_prescriptions (person_id, doctor_id, medication_name, dosage, frequency, start_date, notes, created_at, updated_at)
                  VALUES (@personId, @doctorId, @medicationName, @dosage, @frequency, @startDate, @notes, @createdAt, @updatedAt)
                  RETURNING id, person_id, doctor_id, medication_name, dosage, frequency, is_active, start_date, end_date, notes, created_at, updated_at",
                reader => new MedicalPrescription
                {
                    Id = reader.GetInt64(0),
                    PersonId = reader.GetInt64(1),
                    DoctorId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    MedicationName = reader.GetString(3),
                    Dosage = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Frequency = reader.IsDBNull(5) ? null : reader.GetString(5),
                    IsActive = reader.GetBoolean(6),
                    StartDate = reader.IsDBNull(7) ? null : reader.GetDateTime(7),
                    EndDate = reader.IsDBNull(8) ? null : reader.GetDateTime(8),
                    Notes = reader.IsDBNull(9) ? null : reader.GetString(9),
                    CreatedAt = reader.GetDateTime(10),
                    UpdatedAt = reader.GetDateTime(11)
                },
                new { personId, doctorId, medicationName, dosage, frequency, startDate, notes, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create prescription for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> UpdatePrescriptionAsync(long id, string medicationName, string? dosage = null, string? frequency = null, long? doctorId = null, DateTime? startDate = null, DateTime? endDate = null, string? notes = null, bool isActive = true)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_prescriptions SET medication_name = @medicationName, dosage = @dosage, frequency = @frequency, doctor_id = @doctorId, start_date = @startDate, end_date = @endDate, notes = @notes, is_active = @isActive, updated_at = @updatedAt
                  WHERE id = @id",
                new { id, medicationName, dosage, frequency, doctorId, startDate, endDate, notes, isActive, updatedAt = DateTime.UtcNow });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update prescription {PrescriptionId}", id);
            return false;
        }
    }

    public async Task<bool> DeletePrescriptionAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_prescriptions WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete prescription {PrescriptionId}", id);
            return false;
        }
    }

    // --- Prescription Pickups ---

    public async Task<List<MedicalPrescriptionPickup>> GetPickupsAsync(long prescriptionId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id, prescription_id, document_id, pickup_date, quantity, pharmacy, cost, notes, created_at FROM app.medical_prescription_pickups WHERE prescription_id = @prescriptionId ORDER BY pickup_date DESC",
                reader => new MedicalPrescriptionPickup
                {
                    Id = reader.GetInt64(0),
                    PrescriptionId = reader.GetInt64(1),
                    DocumentId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    PickupDate = reader.GetDateTime(3),
                    Quantity = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Pharmacy = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Cost = reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                    Notes = reader.IsDBNull(7) ? null : reader.GetString(7),
                    CreatedAt = reader.GetDateTime(8)
                },
                new { prescriptionId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get pickups for prescription {PrescriptionId}", prescriptionId);
            return [];
        }
    }

    public async Task<MedicalPrescriptionPickup?> CreatePickupAsync(long prescriptionId, DateTime pickupDate, string? quantity = null, string? pharmacy = null, decimal? cost = null, string? notes = null)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_prescription_pickups (prescription_id, pickup_date, quantity, pharmacy, cost, notes, created_at)
                  VALUES (@prescriptionId, @pickupDate, @quantity, @pharmacy, @cost, @notes, @createdAt)
                  RETURNING id, prescription_id, document_id, pickup_date, quantity, pharmacy, cost, notes, created_at",
                reader => new MedicalPrescriptionPickup
                {
                    Id = reader.GetInt64(0),
                    PrescriptionId = reader.GetInt64(1),
                    DocumentId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    PickupDate = reader.GetDateTime(3),
                    Quantity = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Pharmacy = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Cost = reader.IsDBNull(6) ? null : reader.GetDecimal(6),
                    Notes = reader.IsDBNull(7) ? null : reader.GetString(7),
                    CreatedAt = reader.GetDateTime(8)
                },
                new { prescriptionId, pickupDate, quantity, pharmacy, cost, notes, createdAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create pickup for prescription {PrescriptionId}", prescriptionId);
            return null;
        }
    }

    public async Task<bool> DeletePickupAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_prescription_pickups WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete pickup {PickupId}", id);
            return false;
        }
    }

    // --- AI Processing Helpers ---

    public async Task UpdateAiResultsAsync(long docId, string? extractedText, string? classification, string aiRawResponse)
    {
        try
        {
            await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_documents
                  SET extracted_text = @extractedText,
                      classification = @classification,
                      ai_processed = true,
                      ai_processed_at = @processedAt,
                      ai_raw_response = @aiRawResponse::jsonb,
                      updated_at = @updatedAt
                  WHERE id = @docId",
                new
                {
                    docId,
                    extractedText,
                    classification,
                    aiRawResponse,
                    processedAt = DateTime.UtcNow,
                    updatedAt = DateTime.UtcNow
                });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update AI results for document {DocumentId}", docId);
        }
    }

    public async Task AddTagsAsync(long docId, List<string> tagNames, string source = "ai")
    {
        try
        {
            foreach (var tagName in tagNames)
            {
                var normalizedName = tagName.Trim().ToLowerInvariant();
                if (string.IsNullOrEmpty(normalizedName)) continue;

                // Upsert tag
                var tagId = await db.ExecuteAsync<long>(
                    @"INSERT INTO app.medical_tags (name) VALUES (@name)
                      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                      RETURNING id",
                    new { name = normalizedName });

                // Link tag to document
                await db.ExecuteNonQueryAsync(
                    @"INSERT INTO app.medical_document_tags (document_id, tag_id, source)
                      VALUES (@documentId, @tagId, @source)
                      ON CONFLICT (document_id, tag_id) DO NOTHING",
                    new { documentId = docId, tagId, source });
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to add tags for document {DocumentId}", docId);
        }
    }

    public async Task AddCostsAsync(long docId, long personId, List<MedicalAiService.CostExtraction> costs)
    {
        try
        {
            foreach (var cost in costs)
            {
                if (cost.Amount <= 0) continue;

                DateTime? costDate = null;
                if (!string.IsNullOrEmpty(cost.Date) && DateTime.TryParse(cost.Date, out var parsed))
                    costDate = parsed;

                await db.ExecuteNonQueryAsync(
                    @"INSERT INTO app.medical_document_costs (document_id, person_id, amount, cost_type, category, cost_date, description, source)
                      VALUES (@documentId, @personId, @amount, @costType, @category, @costDate, @description, 'ai')",
                    new
                    {
                        documentId = docId,
                        personId,
                        amount = cost.Amount,
                        costType = cost.CostType,
                        category = cost.Category,
                        costDate,
                        description = cost.Description
                    });
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to add costs for document {DocumentId}", docId);
        }
    }

    public async Task<List<long>> GetUnprocessedDocumentIdsAsync()
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id FROM app.medical_documents WHERE ai_processed = false ORDER BY created_at",
                reader => reader.GetInt64(0));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get unprocessed document IDs");
            return [];
        }
    }

    public async Task<List<MedicalTag>> GetDocumentTagsAsync(long documentId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT t.id, t.name, t.created_at
                  FROM app.medical_tags t
                  JOIN app.medical_document_tags dt ON dt.tag_id = t.id
                  WHERE dt.document_id = @documentId
                  ORDER BY t.name",
                reader => new MedicalTag
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    CreatedAt = reader.GetDateTime(2)
                },
                new { documentId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get tags for document {DocumentId}", documentId);
            return [];
        }
    }

    private static MedicalDocument MapDocument(Npgsql.NpgsqlDataReader reader)
    {
        return new MedicalDocument
        {
            Id = reader.GetInt64(0),
            PersonId = reader.GetInt64(1),
            DocumentType = reader.GetString(2),
            FileName = reader.IsDBNull(3) ? null : reader.GetString(3),
            FilePath = reader.IsDBNull(4) ? null : reader.GetString(4),
            FileSize = reader.IsDBNull(5) ? null : reader.GetInt64(5),
            MimeType = reader.IsDBNull(6) ? null : reader.GetString(6),
            IsEncrypted = reader.GetBoolean(7),
            Title = reader.IsDBNull(8) ? null : reader.GetString(8),
            Description = reader.IsDBNull(9) ? null : reader.GetString(9),
            DocumentDate = reader.IsDBNull(10) ? null : reader.GetDateTime(10),
            Classification = reader.IsDBNull(11) ? null : reader.GetString(11),
            ExtractedText = reader.IsDBNull(12) ? null : reader.GetString(12),
            AiProcessed = reader.GetBoolean(13),
            AiProcessedAt = reader.IsDBNull(14) ? null : reader.GetDateTime(14),
            DoctorId = reader.IsDBNull(15) ? null : reader.GetInt64(15),
            CreatedAt = reader.GetDateTime(16),
            UpdatedAt = reader.GetDateTime(17)
        };
    }
}
