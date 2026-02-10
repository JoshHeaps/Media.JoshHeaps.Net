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

    public async Task<List<MedicalDocument>> SearchDocumentsAsync(long personId, string? search = null, string? classification = null, string? documentType = null, long? doctorId = null, long? tagId = null, long? conditionId = null, DateTime? fromDate = null, DateTime? toDate = null, bool? aiProcessed = null, int offset = 0, int limit = 50)
    {
        try
        {
            var conditions = new List<string> { "person_id = @personId" };

            if (!string.IsNullOrWhiteSpace(search))
                conditions.Add("(title ILIKE @search OR description ILIKE @search OR extracted_text ILIKE @search)");

            if (!string.IsNullOrEmpty(classification))
                conditions.Add("classification = @classification");

            if (!string.IsNullOrEmpty(documentType))
                conditions.Add("document_type = @documentType");

            if (doctorId.HasValue)
                conditions.Add("doctor_id = @doctorId");

            if (tagId.HasValue)
                conditions.Add("id IN (SELECT document_id FROM app.medical_document_tags WHERE tag_id = @tagId)");

            if (conditionId.HasValue)
                conditions.Add("id IN (SELECT document_id FROM app.medical_document_conditions WHERE condition_id = @conditionId)");

            if (fromDate.HasValue)
                conditions.Add("document_date >= @fromDate");

            if (toDate.HasValue)
                conditions.Add("document_date <= @toDate");

            if (aiProcessed.HasValue)
                conditions.Add("ai_processed = @aiProcessed");

            var whereClause = string.Join(" AND ", conditions);
            var query = $@"SELECT id, person_id, document_type, file_name, file_path, file_size, mime_type, is_encrypted, title, description, document_date, classification, extracted_text, ai_processed, ai_processed_at, doctor_id, created_at, updated_at
                          FROM app.medical_documents
                          WHERE {whereClause}
                          ORDER BY document_date DESC NULLS LAST, created_at DESC
                          OFFSET @offset LIMIT @limit";

            return await db.ExecuteListReaderAsync(query, MapDocument, new
            {
                personId,
                search = !string.IsNullOrWhiteSpace(search) ? $"%{search}%" : (string?)null,
                classification,
                documentType,
                doctorId = doctorId ?? 0L,
                tagId = tagId ?? 0L,
                conditionId = conditionId ?? 0L,
                fromDate,
                toDate,
                aiProcessed = aiProcessed ?? false,
                offset,
                limit
            });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to search medical documents for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<List<MedicalTag>> GetPersonTagsAsync(long personId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT DISTINCT t.id, t.name, t.created_at
                  FROM app.medical_tags t
                  JOIN app.medical_document_tags dt ON dt.tag_id = t.id
                  JOIN app.medical_documents d ON dt.document_id = d.id
                  WHERE d.person_id = @personId
                  ORDER BY t.name",
                reader => new MedicalTag
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    CreatedAt = reader.GetDateTime(2)
                },
                new { personId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get tags for person {PersonId}", personId);
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

    public async Task<bool> UpdateDocumentAsync(long docId, string? title, string? description, DateTime? documentDate, string? classification, long? doctorId)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_documents
                  SET title = @title,
                      description = @description,
                      document_date = @documentDate,
                      classification = @classification,
                      doctor_id = @doctorId,
                      updated_at = @updatedAt
                  WHERE id = @docId",
                new
                {
                    docId,
                    title,
                    description,
                    documentDate,
                    classification,
                    doctorId,
                    updatedAt = DateTime.UtcNow
                });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update document {DocumentId}", docId);
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

    public async Task<MedicalDoctor?> GetDoctorByIdAsync(long id)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                "SELECT id, name, specialty, phone, address, notes, created_at, updated_at FROM app.medical_doctors WHERE id = @id",
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
                new { id });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get doctor {DoctorId}", id);
            return null;
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
                @"SELECT p.id, p.person_id, p.doctor_id, p.medication_name, p.dosage, p.frequency, p.is_active, p.start_date, p.end_date, p.notes, p.created_at, p.updated_at, p.rx_number,
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
                    RxNumber = reader.IsDBNull(12) ? null : reader.GetString(12),
                    DoctorName = reader.IsDBNull(13) ? null : reader.GetString(13),
                    LastPickupDate = reader.IsDBNull(14) ? null : reader.GetDateTime(14)
                },
                new { personId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get prescriptions for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<MedicalPrescription?> CreatePrescriptionAsync(long personId, string medicationName, string? dosage = null, string? frequency = null, long? doctorId = null, DateTime? startDate = null, string? notes = null, string? rxNumber = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_prescriptions (person_id, doctor_id, medication_name, dosage, frequency, start_date, notes, rx_number, created_at, updated_at)
                  VALUES (@personId, @doctorId, @medicationName, @dosage, @frequency, @startDate, @notes, @rxNumber, @createdAt, @updatedAt)
                  RETURNING id, person_id, doctor_id, medication_name, dosage, frequency, is_active, start_date, end_date, notes, rx_number, created_at, updated_at",
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
                    RxNumber = reader.IsDBNull(10) ? null : reader.GetString(10),
                    CreatedAt = reader.GetDateTime(11),
                    UpdatedAt = reader.GetDateTime(12)
                },
                new { personId, doctorId, medicationName, dosage, frequency, startDate, notes, rxNumber, createdAt = now, updatedAt = now });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create prescription for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> UpdatePrescriptionAsync(long id, string medicationName, string? dosage = null, string? frequency = null, long? doctorId = null, DateTime? startDate = null, DateTime? endDate = null, string? notes = null, bool isActive = true, string? rxNumber = null)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_prescriptions SET medication_name = @medicationName, dosage = @dosage, frequency = @frequency, doctor_id = @doctorId, start_date = @startDate, end_date = @endDate, notes = @notes, is_active = @isActive, rx_number = @rxNumber, updated_at = @updatedAt
                  WHERE id = @id",
                new { id, medicationName, dosage, frequency, doctorId, startDate, endDate, notes, isActive, rxNumber, updatedAt = DateTime.UtcNow });
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

    public async Task<MedicalPrescriptionPickup?> CreatePickupAsync(long prescriptionId, DateTime pickupDate, string? quantity = null, string? pharmacy = null, decimal? cost = null, string? notes = null, long? documentId = null)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_prescription_pickups (prescription_id, pickup_date, quantity, pharmacy, cost, notes, document_id, created_at)
                  VALUES (@prescriptionId, @pickupDate, @quantity, @pharmacy, @cost, @notes, @documentId, @createdAt)
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
                new { prescriptionId, pickupDate, quantity, pharmacy, cost, notes, documentId, createdAt = DateTime.UtcNow });
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

    // --- AI Prescription Helpers ---

    public async Task<MedicalPrescription?> FindActivePrescriptionByMedicationAsync(long personId, string medicationName)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT id, person_id, doctor_id, medication_name, dosage, frequency, is_active, start_date, end_date, notes, rx_number, created_at, updated_at
                  FROM app.medical_prescriptions
                  WHERE person_id = @personId AND LOWER(medication_name) = LOWER(@medicationName) AND is_active = true
                  LIMIT 1",
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
                    RxNumber = reader.IsDBNull(10) ? null : reader.GetString(10),
                    CreatedAt = reader.GetDateTime(11),
                    UpdatedAt = reader.GetDateTime(12)
                },
                new { personId, medicationName });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find active prescription by medication for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> HasPickupOnDateAsync(long prescriptionId, DateTime date)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                "SELECT EXISTS (SELECT 1 FROM app.medical_prescription_pickups WHERE prescription_id = @prescriptionId AND pickup_date::date = @date::date)",
                reader => reader.GetBoolean(0),
                new { prescriptionId, date });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to check pickup on date for prescription {PrescriptionId}", prescriptionId);
            return false;
        }
    }

    public async Task<MedicalBill?> FindSameDayPharmacyBillAsync(long providerId, DateTime billDate)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT b.id, b.person_id, b.total_amount, b.summary, b.category, b.bill_date, b.doctor_id, b.provider_id, b.source, b.created_at, b.updated_at,
                         d.name AS doctor_name,
                         bp.name AS provider_name,
                         (SELECT string_agg(COALESCE(md.title, md.file_name, 'Document #' || md.id::text), ', ')
                          FROM app.medical_bill_documents bd
                          JOIN app.medical_documents md ON bd.document_id = md.id
                          WHERE bd.bill_id = b.id) AS document_names
                  FROM app.medical_bills b
                  LEFT JOIN app.medical_doctors d ON b.doctor_id = d.id
                  LEFT JOIN app.medical_billing_providers bp ON b.provider_id = bp.id
                  WHERE b.provider_id = @providerId AND b.bill_date::date = @billDate::date AND b.source = 'ai' AND b.category = 'pharmacy'
                  ORDER BY b.created_at DESC
                  LIMIT 1",
                MapBill,
                new { providerId, billDate });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find same-day pharmacy bill for provider {ProviderId}", providerId);
            return null;
        }
    }

    public async Task AddToBillTotalAsync(long billId, decimal additionalAmount)
    {
        try
        {
            await db.ExecuteNonQueryAsync(
                "UPDATE app.medical_bills SET total_amount = total_amount + @amount, updated_at = @updatedAt WHERE id = @billId",
                new { billId, amount = additionalAmount, updatedAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to add to bill total for bill {BillId}", billId);
        }
    }

    public async Task<bool> AddToProviderPaymentAmountAsync(long providerId, DateTime paymentDate, decimal additionalAmount)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_provider_payments
                  SET amount = amount + @amount
                  WHERE id = (
                      SELECT id FROM app.medical_provider_payments
                      WHERE provider_id = @providerId AND payment_date::date = @paymentDate::date AND source = 'ai'
                      ORDER BY created_at DESC LIMIT 1
                  )",
                new { providerId, paymentDate, amount = additionalAmount });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to add to provider payment amount for provider {ProviderId}", providerId);
            return false;
        }
    }

    public async Task<MedicalDoctor?> FindOrCreateDoctorByNameAsync(string doctorName)
    {
        try
        {
            var existing = await db.ExecuteReaderAsync(
                "SELECT id, name, specialty, phone, address, notes, created_at, updated_at FROM app.medical_doctors WHERE LOWER(name) = LOWER(@name) LIMIT 1",
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
                new { name = doctorName });

            if (existing != null) return existing;

            return await CreateDoctorAsync(doctorName);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find or create doctor by name \"{DoctorName}\"", doctorName);
            return null;
        }
    }

    public async Task AddPrescriptionFromAiAsync(long documentId, long personId, MedicalAiService.PrescriptionInfo rxInfo, string? doctorName, MedicalAiService aiService)
    {
        // Parse pickup date
        DateTime? pickupDate = null;
        if (!string.IsNullOrEmpty(rxInfo.PickupDate) && DateTime.TryParse(rxInfo.PickupDate, out var parsedDate))
            pickupDate = parsedDate;

        // Resolve doctor
        long? doctorId = null;
        var docName = rxInfo.DoctorName ?? doctorName;
        if (!string.IsNullOrWhiteSpace(docName))
        {
            var doctor = await FindOrCreateDoctorByNameAsync(docName.Trim());
            doctorId = doctor?.Id;
        }

        // Find or create prescription
        var existing = await FindActivePrescriptionByMedicationAsync(personId, rxInfo.MedicationName!);
        long prescriptionId;

        if (existing != null)
        {
            prescriptionId = existing.Id;
            // Update with new info if fields were previously null
            var needsUpdate = false;
            var updatedRxNumber = existing.RxNumber;
            var updatedDosage = existing.Dosage;
            var updatedFrequency = existing.Frequency;
            var updatedDoctorId = existing.DoctorId;

            if (!string.IsNullOrWhiteSpace(rxInfo.RxNumber) && rxInfo.RxNumber != existing.RxNumber)
            {
                updatedRxNumber = rxInfo.RxNumber;
                needsUpdate = true;
            }
            if (string.IsNullOrEmpty(existing.Dosage) && !string.IsNullOrEmpty(rxInfo.Dosage))
            {
                updatedDosage = rxInfo.Dosage;
                needsUpdate = true;
            }
            if (string.IsNullOrEmpty(existing.Frequency) && !string.IsNullOrEmpty(rxInfo.Frequency))
            {
                updatedFrequency = rxInfo.Frequency;
                needsUpdate = true;
            }
            if (!existing.DoctorId.HasValue && doctorId.HasValue)
            {
                updatedDoctorId = doctorId;
                needsUpdate = true;
            }

            if (needsUpdate)
            {
                await UpdatePrescriptionAsync(existing.Id, existing.MedicationName,
                    updatedDosage, updatedFrequency, updatedDoctorId,
                    existing.StartDate, existing.EndDate, existing.Notes, existing.IsActive, updatedRxNumber);
            }

            logger.LogInformation("Matched existing prescription {PrescriptionId} for medication \"{Medication}\"", prescriptionId, rxInfo.MedicationName);
        }
        else
        {
            var newRx = await CreatePrescriptionAsync(personId, rxInfo.MedicationName!,
                rxInfo.Dosage, rxInfo.Frequency, doctorId, pickupDate, null, rxInfo.RxNumber);
            if (newRx == null) return;
            prescriptionId = newRx.Id;
            logger.LogInformation("Created new prescription {PrescriptionId} for medication \"{Medication}\"", prescriptionId, rxInfo.MedicationName);
        }

        // Log pickup if date present and not already logged
        if (pickupDate.HasValue && !await HasPickupOnDateAsync(prescriptionId, pickupDate.Value))
        {
            await CreatePickupAsync(prescriptionId, pickupDate.Value,
                pharmacy: rxInfo.Pharmacy, cost: rxInfo.Copay, documentId: documentId);
            logger.LogInformation("Logged pickup for prescription {PrescriptionId} on {Date}", prescriptionId, pickupDate.Value);
        }

        // Create pharmacy billing if applicable
        if (!string.IsNullOrWhiteSpace(rxInfo.Pharmacy) && rxInfo.Copay is > 0 && pickupDate.HasValue)
        {
            var providerId = await FindOrCreateProviderAsync(personId, rxInfo.Pharmacy.Trim(), aiService);
            if (providerId == null) return;

            var existingBill = await FindSameDayPharmacyBillAsync(providerId.Value, pickupDate.Value);

            if (existingBill != null)
            {
                // Consolidate into existing same-day pharmacy bill
                await CreateChargeAsync(existingBill.Id, rxInfo.MedicationName!, rxInfo.Copay.Value, "ai");
                await AddToBillTotalAsync(existingBill.Id, rxInfo.Copay.Value);

                var paymentUpdated = await AddToProviderPaymentAmountAsync(providerId.Value, pickupDate.Value, rxInfo.Copay.Value);
                if (!paymentUpdated)
                    await CreateProviderPaymentAsync(providerId.Value, rxInfo.Copay.Value, pickupDate, $"Pharmacy - {rxInfo.MedicationName}", documentId, source: "ai");

                await LinkDocumentToBillAsync(existingBill.Id, documentId);
                logger.LogInformation("Consolidated prescription billing into existing bill {BillId} for provider {ProviderId}", existingBill.Id, providerId);
            }
            else
            {
                // Create new pharmacy bill
                var newBill = await CreateBillAsync(personId, rxInfo.Copay.Value,
                    $"Pharmacy - {rxInfo.MedicationName}", "pharmacy", pickupDate, providerId: providerId, source: "ai");
                if (newBill == null) return;

                await CreateChargeAsync(newBill.Id, rxInfo.MedicationName!, rxInfo.Copay.Value, "ai");
                await LinkDocumentToBillAsync(newBill.Id, documentId);
                await CreateProviderPaymentAsync(providerId.Value, rxInfo.Copay.Value, pickupDate, $"Pharmacy - {rxInfo.MedicationName}", documentId, source: "ai");
                logger.LogInformation("Created pharmacy bill {BillId} for prescription from provider {ProviderId}", newBill.Id, providerId);
            }
        }
    }

    // --- AI Processing Helpers ---

    public async Task UpdateAiResultsAsync(long docId, string? extractedText, string? classification, string aiRawResponse, long? doctorId = null)
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
                      doctor_id = @doctorId,
                      updated_at = @updatedAt
                  WHERE id = @docId",
                new
                {
                    docId,
                    extractedText,
                    classification,
                    aiRawResponse,
                    doctorId,
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

    // --- Billing Providers ---

    public async Task<List<MedicalBillingProvider>> GetProvidersAsync(long personId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at,
                         COALESCE(SUM(b.total_amount), 0) AS total_charged,
                         COALESCE((SELECT SUM(pp.amount) FROM app.medical_provider_payments pp WHERE pp.provider_id = p.id), 0) AS total_paid,
                         COUNT(DISTINCT b.id) AS bill_count
                  FROM app.medical_billing_providers p
                  LEFT JOIN app.medical_bills b ON b.provider_id = p.id
                  WHERE p.person_id = @personId
                  GROUP BY p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at
                  ORDER BY p.name",
                reader => new MedicalBillingProvider
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    PersonId = reader.GetInt64(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    TotalCharged = reader.GetDecimal(6),
                    TotalPaid = reader.GetDecimal(7),
                    BillCount = reader.GetInt32(8)
                },
                new { personId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get billing providers for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<MedicalBillingProvider?> GetProviderByIdAsync(long providerId)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at,
                         COALESCE(SUM(b.total_amount), 0) AS total_charged,
                         COALESCE((SELECT SUM(pp.amount) FROM app.medical_provider_payments pp WHERE pp.provider_id = p.id), 0) AS total_paid,
                         COUNT(DISTINCT b.id) AS bill_count
                  FROM app.medical_billing_providers p
                  LEFT JOIN app.medical_bills b ON b.provider_id = p.id
                  WHERE p.id = @providerId
                  GROUP BY p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at",
                reader => new MedicalBillingProvider
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    PersonId = reader.GetInt64(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    TotalCharged = reader.GetDecimal(6),
                    TotalPaid = reader.GetDecimal(7),
                    BillCount = reader.GetInt32(8)
                },
                new { providerId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get billing provider {ProviderId}", providerId);
            return null;
        }
    }

    public async Task<MedicalBillingProvider?> CreateProviderAsync(long personId, string name, string? notes = null)
    {
        try
        {
            var now = DateTime.UtcNow;
            var id = await db.ExecuteAsync<long>(
                @"INSERT INTO app.medical_billing_providers (name, person_id, notes, created_at, updated_at)
                  VALUES (@name, @personId, @notes, @createdAt, @updatedAt)
                  RETURNING id",
                new { name, personId, notes, createdAt = now, updatedAt = now });

            return await GetProviderByIdAsync(id);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create billing provider for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> UpdateProviderAsync(long id, string name, string? notes = null)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_billing_providers SET name = @name, notes = @notes, updated_at = @updatedAt WHERE id = @id",
                new { id, name, notes, updatedAt = DateTime.UtcNow });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update billing provider {ProviderId}", id);
            return false;
        }
    }

    public async Task<bool> DeleteProviderAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_billing_providers WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete billing provider {ProviderId}", id);
            return false;
        }
    }

    public async Task<MedicalBillingProvider?> FindProviderByNameAsync(long personId, string name)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at,
                         COALESCE(SUM(b.total_amount), 0) AS total_charged,
                         COALESCE((SELECT SUM(pp.amount) FROM app.medical_provider_payments pp WHERE pp.provider_id = p.id), 0) AS total_paid,
                         COUNT(DISTINCT b.id) AS bill_count
                  FROM app.medical_billing_providers p
                  LEFT JOIN app.medical_bills b ON b.provider_id = p.id
                  WHERE p.person_id = @personId AND LOWER(p.name) = LOWER(@name)
                  GROUP BY p.id, p.name, p.person_id, p.notes, p.created_at, p.updated_at",
                reader => new MedicalBillingProvider
                {
                    Id = reader.GetInt64(0),
                    Name = reader.GetString(1),
                    PersonId = reader.GetInt64(2),
                    Notes = reader.IsDBNull(3) ? null : reader.GetString(3),
                    CreatedAt = reader.GetDateTime(4),
                    UpdatedAt = reader.GetDateTime(5),
                    TotalCharged = reader.GetDecimal(6),
                    TotalPaid = reader.GetDecimal(7),
                    BillCount = reader.GetInt32(8)
                },
                new { personId, name });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find provider by name for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<long?> FindOrCreateProviderAsync(long personId, string providerName, MedicalAiService aiService)
    {
        // Exact match first
        var existing = await FindProviderByNameAsync(personId, providerName);
        if (existing != null) return existing.Id;

        // AI fuzzy match
        try
        {
            var allProviders = await GetProvidersAsync(personId);
            if (allProviders.Count > 0)
            {
                var existingNames = allProviders.Select(p => p.Name).ToList();
                var matchedName = await aiService.FuzzyMatchProviderAsync(providerName, existingNames);
                if (matchedName != null)
                {
                    var matched = allProviders.FirstOrDefault(p => string.Equals(p.Name, matchedName, StringComparison.OrdinalIgnoreCase));
                    if (matched != null) return matched.Id;
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Fuzzy provider match failed, creating new provider");
        }

        // Create new
        var newProvider = await CreateProviderAsync(personId, providerName);
        return newProvider?.Id;
    }

    // --- Provider Payments ---

    public async Task<List<MedicalProviderPayment>> GetProviderPaymentsAsync(long providerId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT id, provider_id, document_id, amount, payment_date, description, source, created_at
                  FROM app.medical_provider_payments
                  WHERE provider_id = @providerId
                  ORDER BY payment_date DESC NULLS LAST, created_at DESC",
                reader => new MedicalProviderPayment
                {
                    Id = reader.GetInt64(0),
                    ProviderId = reader.GetInt64(1),
                    DocumentId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    Amount = reader.GetDecimal(3),
                    PaymentDate = reader.IsDBNull(4) ? null : reader.GetDateTime(4),
                    Description = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Source = reader.GetString(6),
                    CreatedAt = reader.GetDateTime(7)
                },
                new { providerId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get payments for provider {ProviderId}", providerId);
            return [];
        }
    }

    public async Task<MedicalProviderPayment?> CreateProviderPaymentAsync(long providerId, decimal amount, DateTime? paymentDate = null, string? description = null, long? documentId = null, string source = "manual")
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_provider_payments (provider_id, amount, payment_date, description, document_id, source, created_at)
                  VALUES (@providerId, @amount, @paymentDate, @description, @documentId, @source, @createdAt)
                  RETURNING id, provider_id, document_id, amount, payment_date, description, source, created_at",
                reader => new MedicalProviderPayment
                {
                    Id = reader.GetInt64(0),
                    ProviderId = reader.GetInt64(1),
                    DocumentId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    Amount = reader.GetDecimal(3),
                    PaymentDate = reader.IsDBNull(4) ? null : reader.GetDateTime(4),
                    Description = reader.IsDBNull(5) ? null : reader.GetString(5),
                    Source = reader.GetString(6),
                    CreatedAt = reader.GetDateTime(7)
                },
                new { providerId, amount, paymentDate, description, documentId, source, createdAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create payment for provider {ProviderId}", providerId);
            return null;
        }
    }

    public async Task<bool> HasMatchingProviderPaymentAsync(long providerId, decimal amount, DateTime? paymentDate)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT EXISTS (
                    SELECT 1 FROM app.medical_provider_payments
                    WHERE provider_id = @providerId
                      AND amount = @amount
                      AND source = 'ai'
                      AND ((@paymentDate IS NULL AND payment_date IS NULL)
                           OR payment_date = @paymentDate)
                )",
                reader => reader.GetBoolean(0),
                new { providerId, amount, paymentDate });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to check for matching payment on provider {ProviderId}", providerId);
            return false;
        }
    }

    public async Task<bool> DeleteProviderPaymentAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_provider_payments WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete provider payment {PaymentId}", id);
            return false;
        }
    }

    // --- Bills ---

    public async Task<List<MedicalBill>> GetBillsAsync(long personId, long? providerId = null)
    {
        try
        {
            var providerFilter = providerId.HasValue ? "AND b.provider_id = @providerId" : "";

            var query = $@"SELECT b.id, b.person_id, b.total_amount, b.summary, b.category, b.bill_date, b.doctor_id, b.provider_id, b.source, b.created_at, b.updated_at,
                                  d.name AS doctor_name,
                                  bp.name AS provider_name,
                                  (SELECT string_agg(COALESCE(md.title, md.file_name, 'Document #' || md.id::text), ', ')
                                   FROM app.medical_bill_documents bd
                                   JOIN app.medical_documents md ON bd.document_id = md.id
                                   WHERE bd.bill_id = b.id) AS document_names
                           FROM app.medical_bills b
                           LEFT JOIN app.medical_doctors d ON b.doctor_id = d.id
                           LEFT JOIN app.medical_billing_providers bp ON b.provider_id = bp.id
                           WHERE b.person_id = @personId {providerFilter}
                           ORDER BY b.bill_date DESC NULLS LAST, b.created_at DESC";

            return await db.ExecuteListReaderAsync(query, MapBill, new { personId, providerId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get bills for person {PersonId}", personId);
            return [];
        }
    }

    public async Task<MedicalBill?> GetBillByIdAsync(long billId)
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"SELECT b.id, b.person_id, b.total_amount, b.summary, b.category, b.bill_date, b.doctor_id, b.provider_id, b.source, b.created_at, b.updated_at,
                         d.name AS doctor_name,
                         bp.name AS provider_name,
                         (SELECT string_agg(COALESCE(md.title, md.file_name, 'Document #' || md.id::text), ', ')
                          FROM app.medical_bill_documents bd
                          JOIN app.medical_documents md ON bd.document_id = md.id
                          WHERE bd.bill_id = b.id) AS document_names
                  FROM app.medical_bills b
                  LEFT JOIN app.medical_doctors d ON b.doctor_id = d.id
                  LEFT JOIN app.medical_billing_providers bp ON b.provider_id = bp.id
                  WHERE b.id = @billId",
                MapBill,
                new { billId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get bill {BillId}", billId);
            return null;
        }
    }

    public async Task<MedicalBill?> CreateBillAsync(long personId, decimal totalAmount, string? summary = null, string? category = null, DateTime? billDate = null, long? doctorId = null, long? providerId = null, string source = "manual")
    {
        try
        {
            var now = DateTime.UtcNow;
            var id = await db.ExecuteAsync<long>(
                @"INSERT INTO app.medical_bills (person_id, total_amount, summary, category, bill_date, doctor_id, provider_id, source, created_at, updated_at)
                  VALUES (@personId, @totalAmount, @summary, @category, @billDate, @doctorId, @providerId, @source, @createdAt, @updatedAt)
                  RETURNING id",
                new { personId, totalAmount, summary, category, billDate, doctorId, providerId, source, createdAt = now, updatedAt = now });

            return await GetBillByIdAsync(id);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create bill for person {PersonId}", personId);
            return null;
        }
    }

    public async Task<bool> UpdateBillAsync(long id, decimal totalAmount, string? summary = null, string? category = null, DateTime? billDate = null, long? doctorId = null, long? providerId = null)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                @"UPDATE app.medical_bills SET total_amount = @totalAmount, summary = @summary, category = @category, bill_date = @billDate, doctor_id = @doctorId, provider_id = @providerId, updated_at = @updatedAt
                  WHERE id = @id",
                new { id, totalAmount, summary, category, billDate, doctorId, providerId, updatedAt = DateTime.UtcNow });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to update bill {BillId}", id);
            return false;
        }
    }

    public async Task<bool> DeleteBillAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_bills WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete bill {BillId}", id);
            return false;
        }
    }

    public async Task<bool> LinkDocumentToBillAsync(long billId, long documentId)
    {
        try
        {
            await db.ExecuteNonQueryAsync(
                @"INSERT INTO app.medical_bill_documents (bill_id, document_id) VALUES (@billId, @documentId) ON CONFLICT (bill_id, document_id) DO NOTHING",
                new { billId, documentId });
            return true;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to link document {DocumentId} to bill {BillId}", documentId, billId);
            return false;
        }
    }

    public async Task<bool> UnlinkDocumentFromBillAsync(long billId, long documentId)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync(
                "DELETE FROM app.medical_bill_documents WHERE bill_id = @billId AND document_id = @documentId",
                new { billId, documentId });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to unlink document {DocumentId} from bill {BillId}", documentId, billId);
            return false;
        }
    }

    // --- Bill Summary ---

    public async Task<BillSummary> GetBillSummaryAsync(long personId)
    {
        try
        {
            var totals = await db.ExecuteReaderAsync(
                @"SELECT COALESCE(SUM(b.total_amount), 0),
                         COALESCE((SELECT SUM(pp.amount) FROM app.medical_provider_payments pp
                                   JOIN app.medical_billing_providers prov ON pp.provider_id = prov.id
                                   WHERE prov.person_id = @personId), 0)
                  FROM app.medical_bills b
                  WHERE b.person_id = @personId",
                reader => new { Charged = reader.GetDecimal(0), TotalPaid = reader.GetDecimal(1) },
                new { personId });

            var byYear = await db.ExecuteListReaderAsync(
                @"SELECT EXTRACT(YEAR FROM COALESCE(b.bill_date, b.created_at))::int AS year,
                         SUM(b.total_amount),
                         COUNT(b.id)
                  FROM app.medical_bills b
                  WHERE b.person_id = @personId
                  GROUP BY EXTRACT(YEAR FROM COALESCE(b.bill_date, b.created_at))::int
                  ORDER BY year DESC",
                reader => new YearBreakdown
                {
                    Year = reader.GetInt32(0),
                    Total = reader.GetDecimal(1),
                    Count = reader.GetInt32(2)
                },
                new { personId });

            var byProvider = await db.ExecuteListReaderAsync(
                @"SELECT COALESCE(prov.name, 'Unassigned'),
                         COALESCE(SUM(b.total_amount), 0),
                         COUNT(b.id)
                  FROM app.medical_bills b
                  LEFT JOIN app.medical_billing_providers prov ON b.provider_id = prov.id
                  WHERE b.person_id = @personId
                  GROUP BY COALESCE(prov.name, 'Unassigned')
                  ORDER BY COALESCE(SUM(b.total_amount), 0) DESC",
                reader => new ProviderBreakdown
                {
                    ProviderName = reader.GetString(0),
                    Total = reader.GetDecimal(1),
                    Count = reader.GetInt32(2)
                },
                new { personId });

            var charged = totals?.Charged ?? 0;
            var totalPaid = totals?.TotalPaid ?? 0;

            return new BillSummary
            {
                TotalCharged = charged,
                TotalPaid = totalPaid,
                TotalDue = charged - totalPaid,
                ByYear = byYear,
                ByProvider = byProvider
            };
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get bill summary for person {PersonId}", personId);
            return new BillSummary();
        }
    }

    private static MedicalBill MapBill(Npgsql.NpgsqlDataReader reader)
    {
        return new MedicalBill
        {
            Id = reader.GetInt64(0),
            PersonId = reader.GetInt64(1),
            TotalAmount = reader.GetDecimal(2),
            Summary = reader.IsDBNull(3) ? null : reader.GetString(3),
            Category = reader.IsDBNull(4) ? null : reader.GetString(4),
            BillDate = reader.IsDBNull(5) ? null : reader.GetDateTime(5),
            DoctorId = reader.IsDBNull(6) ? null : reader.GetInt64(6),
            ProviderId = reader.IsDBNull(7) ? null : reader.GetInt64(7),
            Source = reader.GetString(8),
            CreatedAt = reader.GetDateTime(9),
            UpdatedAt = reader.GetDateTime(10),
            DoctorName = reader.IsDBNull(11) ? null : reader.GetString(11),
            ProviderName = reader.IsDBNull(12) ? null : reader.GetString(12),
            DocumentNames = reader.IsDBNull(13) ? null : reader.GetString(13)
        };
    }

    // --- Bill Charges ---

    public async Task<List<MedicalBillCharge>> GetChargesAsync(long billId)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                "SELECT id, bill_id, description, amount, source, created_at FROM app.medical_bill_charges WHERE bill_id = @billId ORDER BY created_at",
                reader => new MedicalBillCharge
                {
                    Id = reader.GetInt64(0),
                    BillId = reader.GetInt64(1),
                    Description = reader.GetString(2),
                    Amount = reader.GetDecimal(3),
                    Source = reader.GetString(4),
                    CreatedAt = reader.GetDateTime(5)
                },
                new { billId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get charges for bill {BillId}", billId);
            return [];
        }
    }

    public async Task<MedicalBillCharge?> CreateChargeAsync(long billId, string description, decimal amount, string source = "manual")
    {
        try
        {
            return await db.ExecuteReaderAsync(
                @"INSERT INTO app.medical_bill_charges (bill_id, description, amount, source, created_at)
                  VALUES (@billId, @description, @amount, @source, @createdAt)
                  RETURNING id, bill_id, description, amount, source, created_at",
                reader => new MedicalBillCharge
                {
                    Id = reader.GetInt64(0),
                    BillId = reader.GetInt64(1),
                    Description = reader.GetString(2),
                    Amount = reader.GetDecimal(3),
                    Source = reader.GetString(4),
                    CreatedAt = reader.GetDateTime(5)
                },
                new { billId, description, amount, source, createdAt = DateTime.UtcNow });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to create charge for bill {BillId}", billId);
            return null;
        }
    }

    public async Task<bool> DeleteChargeAsync(long id)
    {
        try
        {
            var rows = await db.ExecuteNonQueryAsync("DELETE FROM app.medical_bill_charges WHERE id = @id", new { id });
            return rows > 0;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to delete charge {ChargeId}", id);
            return false;
        }
    }

    // --- Line-Item Bill Matching ---

    public async Task<LineItemMatchResult?> FindMatchingBillByLineItemsAsync(long personId, List<MedicalAiService.LineItemExtraction> newItems, long? providerId = null)
    {
        if (newItems.Count == 0) return null;

        var chargesByBill = await GetChargesGroupedByPersonAsync(personId, providerId);
        if (chargesByBill.Count == 0) return null;

        LineItemMatchResult? bestResult = null;

        foreach (var (billId, existingCharges) in chargesByBill)
        {
            var matchedCount = CountGreedyMatches(existingCharges, newItems);
            if (matchedCount == 0) continue;

            var isFullMatch = matchedCount == newItems.Count && matchedCount == existingCharges.Count;

            var result = new LineItemMatchResult
            {
                BillId = billId,
                IsFullMatch = isFullMatch,
                MatchedCount = matchedCount,
                ExistingCharges = existingCharges
            };

            if (bestResult == null
                || (result.IsFullMatch && !bestResult.IsFullMatch)
                || (result.IsFullMatch == bestResult.IsFullMatch && result.MatchedCount > bestResult.MatchedCount))
            {
                bestResult = result;
            }
        }

        return bestResult;
    }

    private async Task<Dictionary<long, List<MedicalBillCharge>>> GetChargesGroupedByPersonAsync(long personId, long? providerId = null)
    {
        var providerFilter = providerId.HasValue ? "AND b.provider_id = @providerId" : "";
        var charges = await db.ExecuteListReaderAsync(
            $@"SELECT c.id, c.bill_id, c.description, c.amount, c.source, c.created_at
              FROM app.medical_bill_charges c
              JOIN app.medical_bills b ON c.bill_id = b.id
              WHERE b.person_id = @personId {providerFilter}
              ORDER BY c.bill_id, c.created_at",
            reader => new MedicalBillCharge
            {
                Id = reader.GetInt64(0),
                BillId = reader.GetInt64(1),
                Description = reader.GetString(2),
                Amount = reader.GetDecimal(3),
                Source = reader.GetString(4),
                CreatedAt = reader.GetDateTime(5)
            },
            new { personId, providerId });

        var grouped = new Dictionary<long, List<MedicalBillCharge>>();
        foreach (var charge in charges)
        {
            if (!grouped.ContainsKey(charge.BillId))
                grouped[charge.BillId] = [];
            grouped[charge.BillId].Add(charge);
        }

        return grouped;
    }

    private static int CountGreedyMatches(List<MedicalBillCharge> existing, List<MedicalAiService.LineItemExtraction> newItems)
    {
        // Sort both by amount descending so distinctive large charges match first
        var existingPool = existing.OrderByDescending(c => c.Amount).ToList();
        var newSorted = newItems.OrderByDescending(i => i.Amount).ToList();

        var matched = 0;
        var usedExisting = new HashSet<int>();

        foreach (var newItem in newSorted)
        {
            var bestIdx = -1;
            var bestSimilarity = -1.0;

            for (var i = 0; i < existingPool.Count; i++)
            {
                if (usedExisting.Contains(i)) continue;

                // Primary signal: amount within $0.01
                if (Math.Abs(existingPool[i].Amount - newItem.Amount) > 0.01m) continue;

                // Tiebreaker: description word overlap
                var similarity = JaccardSimilarity(existingPool[i].Description, newItem.Description);
                if (bestIdx == -1 || similarity > bestSimilarity)
                {
                    bestIdx = i;
                    bestSimilarity = similarity;
                }
            }

            if (bestIdx >= 0)
            {
                usedExisting.Add(bestIdx);
                matched++;
            }
        }

        return matched;
    }

    private static double JaccardSimilarity(string? a, string? b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return 0;

        var wordsA = TokenizeWords(a);
        var wordsB = TokenizeWords(b);

        if (wordsA.Count == 0 || wordsB.Count == 0) return 0;

        var intersection = wordsA.Intersect(wordsB).Count();
        var union = wordsA.Union(wordsB).Count();

        return union == 0 ? 0 : (double)intersection / union;
    }

    private static HashSet<string> TokenizeWords(string text)
    {
        // Lowercase, strip punctuation, split on whitespace
        var cleaned = new string(text.ToLowerInvariant().Select(c => char.IsLetterOrDigit(c) || c == ' ' ? c : ' ').ToArray());
        return cleaned.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
    }

    // --- AI Bill Helpers ---

    public async Task CleanupAiBillsForDocumentAsync(long documentId)
    {
        try
        {
            // Delete AI-sourced provider payments for this document
            await db.ExecuteNonQueryAsync(
                "DELETE FROM app.medical_provider_payments WHERE document_id = @documentId AND source = 'ai'",
                new { documentId });

            // Find all AI-sourced bills linked to this document
            var billIds = await db.ExecuteListReaderAsync(
                @"SELECT bd.bill_id FROM app.medical_bill_documents bd
                  JOIN app.medical_bills b ON bd.bill_id = b.id
                  WHERE bd.document_id = @documentId AND b.source = 'ai'",
                reader => reader.GetInt64(0),
                new { documentId });

            foreach (var billId in billIds)
            {
                // Unlink document from bill
                await db.ExecuteNonQueryAsync(
                    "DELETE FROM app.medical_bill_documents WHERE bill_id = @billId AND document_id = @documentId",
                    new { billId, documentId });

                // Delete AI-sourced charges on this bill
                await db.ExecuteNonQueryAsync(
                    "DELETE FROM app.medical_bill_charges WHERE bill_id = @billId AND source = 'ai'",
                    new { billId });

                // Delete the bill if it has no remaining document links
                var linkCount = await db.ExecuteAsync<long>(
                    "SELECT COUNT(*) FROM app.medical_bill_documents WHERE bill_id = @billId",
                    new { billId });

                if (linkCount == 0)
                {
                    await db.ExecuteNonQueryAsync(
                        "DELETE FROM app.medical_bill_payments WHERE bill_id = @billId",
                        new { billId });
                    await db.ExecuteNonQueryAsync(
                        "DELETE FROM app.medical_bills WHERE id = @billId AND source = 'ai'",
                        new { billId });
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to cleanup AI bills for document {DocumentId}", documentId);
        }
    }

    public async Task<MedicalBill?> FindMatchingBillAsync(long personId, decimal totalAmount, string? category, DateTime? billDate, long? providerId = null)
    {
        try
        {
            // Pass 1: strict — exact amount + category + date
            var match = await FindBillByConditionsAsync(personId, totalAmount, category, billDate, providerId);
            if (match != null) return match;

            // Pass 2: drop category (AI may classify same doc differently)
            if (!string.IsNullOrEmpty(category))
            {
                match = await FindBillByConditionsAsync(personId, totalAmount, null, billDate, providerId);
                if (match != null) return match;
            }

            // Pass 3: exact amount only (no category or date)
            if (billDate.HasValue)
            {
                match = await FindBillByConditionsAsync(personId, totalAmount, null, null, providerId);
                if (match != null) return match;
            }

            return null;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find matching bill for person {PersonId}", personId);
            return null;
        }
    }

    private async Task<MedicalBill?> FindBillByConditionsAsync(long personId, decimal totalAmount, string? category, DateTime? billDate, long? providerId = null)
    {
        var conditions = new List<string> { "b.person_id = @personId", "b.total_amount = @totalAmount" };

        if (!string.IsNullOrEmpty(category))
            conditions.Add("b.category = @category");

        if (billDate.HasValue)
            conditions.Add("b.bill_date IS NOT NULL AND ABS(EXTRACT(EPOCH FROM (b.bill_date - @billDate::timestamp)) / 86400) <= 30");

        if (providerId.HasValue)
            conditions.Add("b.provider_id = @providerId");

        var whereClause = string.Join(" AND ", conditions);

        return await db.ExecuteReaderAsync(
            $@"SELECT b.id, b.person_id, b.total_amount, b.summary, b.category, b.bill_date, b.doctor_id, b.provider_id, b.source, b.created_at, b.updated_at,
                      d.name AS doctor_name,
                      prov.name AS provider_name,
                      (SELECT string_agg(COALESCE(md.title, md.file_name, 'Document #' || md.id::text), ', ')
                       FROM app.medical_bill_documents bd2
                       JOIN app.medical_documents md ON bd2.document_id = md.id
                       WHERE bd2.bill_id = b.id) AS document_names
               FROM app.medical_bills b
               LEFT JOIN app.medical_doctors d ON b.doctor_id = d.id
               LEFT JOIN app.medical_billing_providers prov ON b.provider_id = prov.id
               WHERE {whereClause}
               ORDER BY b.created_at DESC
               LIMIT 1",
            MapBill,
            new { personId, totalAmount, category, billDate, providerId });
    }

    public async Task AddBillsFromAiAsync(long documentId, long personId, List<MedicalAiService.BillExtraction> bills, List<MedicalAiService.PaymentExtraction>? payments, MedicalAiService aiService)
    {
        try
        {
            var billIndexToId = new Dictionary<int, long>();
            var billIndexToProvider = new Dictionary<int, long>();

            for (var i = 0; i < bills.Count; i++)
            {
                var bill = bills[i];
                if (bill.TotalAmount <= 0) continue;

                DateTime? billDate = null;
                if (!string.IsNullOrEmpty(bill.BillDate) && DateTime.TryParse(bill.BillDate, out var parsed))
                    billDate = parsed;

                // Resolve provider
                long? providerId = null;
                if (!string.IsNullOrWhiteSpace(bill.ProviderName))
                {
                    providerId = await FindOrCreateProviderAsync(personId, bill.ProviderName.Trim(), aiService);
                }

                long? matchedBillId = null;

                // Phase 1: Line-item matching (if bill has line items)
                if (bill.LineItems is { Count: > 0 })
                {
                    // Try scoped to provider first, then unscoped
                    var lineItemMatch = await FindMatchingBillByLineItemsAsync(personId, bill.LineItems, providerId);
                    if (lineItemMatch == null && providerId.HasValue)
                        lineItemMatch = await FindMatchingBillByLineItemsAsync(personId, bill.LineItems);

                    if (lineItemMatch != null)
                    {
                        if (lineItemMatch.IsFullMatch)
                        {
                            matchedBillId = lineItemMatch.BillId;
                            logger.LogInformation("Line-item full match: doc {DocumentId} bill #{Index} → existing bill {BillId}", documentId, i, lineItemMatch.BillId);
                        }
                        else
                        {
                            // Partial match — ask AI to disambiguate
                            var isSame = await aiService.DisambiguateBillMatchAsync(lineItemMatch.ExistingCharges, bill.LineItems, bill.Summary);
                            if (isSame)
                            {
                                matchedBillId = lineItemMatch.BillId;
                                logger.LogInformation("Line-item partial match confirmed by AI: doc {DocumentId} bill #{Index} → existing bill {BillId}", documentId, i, lineItemMatch.BillId);
                            }
                        }
                    }
                }

                // Phase 2: Amount fallback — scoped to provider, then unscoped
                if (!matchedBillId.HasValue)
                {
                    var existingBill = await FindMatchingBillAsync(personId, bill.TotalAmount, bill.Category, billDate, providerId);
                    if (existingBill == null && providerId.HasValue)
                        existingBill = await FindMatchingBillAsync(personId, bill.TotalAmount, bill.Category, billDate);
                    if (existingBill != null)
                        matchedBillId = existingBill.Id;
                }

                // Phase 3: Create new bill
                long billId;
                var isNewBill = false;
                if (matchedBillId.HasValue)
                {
                    billId = matchedBillId.Value;
                }
                else
                {
                    var newBill = await CreateBillAsync(personId, bill.TotalAmount, bill.Summary, bill.Category, billDate, providerId: providerId, source: "ai");
                    if (newBill == null) continue;
                    billId = newBill.Id;
                    isNewBill = true;
                }

                await LinkDocumentToBillAsync(billId, documentId);
                billIndexToId[i] = billId;
                if (providerId.HasValue)
                    billIndexToProvider[i] = providerId.Value;

                // Only create charges for new bills to avoid duplicates
                if (isNewBill && bill.LineItems is { Count: > 0 })
                {
                    foreach (var item in bill.LineItems)
                    {
                        if (item.Amount > 0 && !string.IsNullOrWhiteSpace(item.Description))
                            await CreateChargeAsync(billId, item.Description, item.Amount, "ai");
                    }
                }
            }

            if (payments == null) return;

            foreach (var payment in payments)
            {
                if (payment.Amount <= 0) continue;

                // Determine target provider from bill index
                long? targetProviderId = null;
                if (payment.BillIndex.HasValue && billIndexToProvider.TryGetValue(payment.BillIndex.Value, out var mappedProviderId))
                {
                    targetProviderId = mappedProviderId;
                }
                else if (billIndexToProvider.Count == 1)
                {
                    targetProviderId = billIndexToProvider.Values.First();
                }

                if (!targetProviderId.HasValue) continue;

                DateTime? paymentDate = null;
                if (!string.IsNullOrEmpty(payment.PaymentDate) && DateTime.TryParse(payment.PaymentDate, out var parsedDate))
                    paymentDate = parsedDate;

                // Skip if a matching AI payment already exists (dedup for re-uploaded receipts)
                var isDuplicate = await HasMatchingProviderPaymentAsync(
                    targetProviderId.Value, payment.Amount, paymentDate);
                if (isDuplicate) continue;

                await CreateProviderPaymentAsync(targetProviderId.Value, payment.Amount, paymentDate, payment.Description, documentId, source: "ai");
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to add AI bills for document {DocumentId}", documentId);
        }
    }

    // --- AI Condition Assignment ---

    public async Task AssignConditionsFromAiAsync(long documentId, long personId, List<string> conditionNames, MedicalAiService aiService)
    {
        foreach (var name in conditionNames)
        {
            if (string.IsNullOrWhiteSpace(name)) continue;

            try
            {
                var condition = await FindOrCreateConditionByNameAsync(personId, name.Trim(), aiService);
                if (condition != null)
                {
                    await LinkDocumentToConditionAsync(documentId, condition.Id);
                    logger.LogInformation("Linked condition \"{ConditionName}\" (ID {ConditionId}) to document {DocumentId}",
                        condition.Name, condition.Id, documentId);
                }
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to assign condition \"{ConditionName}\" to document {DocumentId}", name, documentId);
            }
        }
    }

    public async Task<MedicalCondition?> FindOrCreateConditionByNameAsync(long personId, string conditionName, MedicalAiService aiService)
    {
        // Exact case-insensitive match
        try
        {
            var existing = await db.ExecuteReaderAsync(
                "SELECT id, person_id, name, diagnosed_date, notes, is_active, created_at, updated_at FROM app.medical_conditions WHERE person_id = @personId AND LOWER(name) = LOWER(@name) LIMIT 1",
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
                new { personId, name = conditionName });

            if (existing != null) return existing;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to find condition by name for person {PersonId}", personId);
        }

        // AI fuzzy match against existing conditions
        try
        {
            var allConditions = await GetConditionsAsync(personId);
            if (allConditions.Count > 0)
            {
                var existingNames = allConditions.Select(c => c.Name).ToList();
                var matchedName = await aiService.FuzzyMatchConditionAsync(conditionName, existingNames);
                if (matchedName != null)
                {
                    var matched = allConditions.FirstOrDefault(c => string.Equals(c.Name, matchedName, StringComparison.OrdinalIgnoreCase));
                    if (matched != null) return matched;
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Fuzzy condition match failed, creating new condition");
        }

        // Create new
        return await CreateConditionAsync(personId, conditionName);
    }

    public async Task LinkDocumentToConditionAsync(long documentId, long conditionId)
    {
        try
        {
            await db.ExecuteNonQueryAsync(
                @"INSERT INTO app.medical_document_conditions (document_id, condition_id)
                  VALUES (@documentId, @conditionId)
                  ON CONFLICT DO NOTHING",
                new { documentId, conditionId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to link document {DocumentId} to condition {ConditionId}", documentId, conditionId);
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

    // --- Timeline ---

    public async Task<List<TimelineEvent>> GetTimelineAsync(long personId, int offset = 0, int limit = 100)
    {
        try
        {
            return await db.ExecuteListReaderAsync(
                @"SELECT event_type, id, label, detail, sub_type, event_date, doctor_id, created_at
                  FROM (
                      SELECT 'document' AS event_type, d.id, COALESCE(d.title, d.file_name) AS label, d.description AS detail,
                             d.classification AS sub_type, d.document_date AS event_date, d.doctor_id, d.created_at
                      FROM app.medical_documents d WHERE d.person_id = @personId
                      UNION ALL
                      SELECT 'condition', c.id, c.name, c.notes,
                             CASE WHEN c.is_active THEN 'active' ELSE 'resolved' END, c.diagnosed_date, NULL, c.created_at
                      FROM app.medical_conditions c WHERE c.person_id = @personId
                      UNION ALL
                      SELECT 'prescription', p.id, p.medication_name, CONCAT_WS(' - ', p.dosage, p.frequency),
                             CASE WHEN p.is_active THEN 'active' ELSE 'ended' END, p.start_date, p.doctor_id, p.created_at
                      FROM app.medical_prescriptions p WHERE p.person_id = @personId
                      UNION ALL
                      SELECT 'bill', b.id, b.summary, bp.name,
                             b.category, b.bill_date, b.doctor_id, b.created_at
                      FROM app.medical_bills b
                      LEFT JOIN app.medical_billing_providers bp ON b.provider_id = bp.id
                      WHERE b.person_id = @personId
                  ) AS timeline
                  ORDER BY COALESCE(event_date, created_at) DESC
                  LIMIT @limit OFFSET @offset",
                reader => new TimelineEvent
                {
                    EventType = reader.GetString(0),
                    Id = reader.GetInt64(1),
                    Label = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Detail = reader.IsDBNull(3) ? null : reader.GetString(3),
                    SubType = reader.IsDBNull(4) ? null : reader.GetString(4),
                    EventDate = reader.IsDBNull(5) ? null : reader.GetDateTime(5),
                    DoctorId = reader.IsDBNull(6) ? null : reader.GetInt64(6),
                    CreatedAt = reader.GetDateTime(7)
                },
                new { personId, limit, offset });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get timeline for person {PersonId}", personId);
            return [];
        }
    }

    // --- Visit Prep ---

    public async Task<VisitPrepData> GetVisitPrepAsync(long personId, long doctorId)
    {
        var data = new VisitPrepData();

        try
        {
            data.RecentDocuments = await db.ExecuteListReaderAsync(
                @"SELECT id, title, file_name, document_date, classification
                  FROM app.medical_documents
                  WHERE person_id = @personId AND doctor_id = @doctorId
                  ORDER BY COALESCE(document_date, created_at) DESC LIMIT 10",
                reader => new VisitPrepDocument
                {
                    Id = reader.GetInt64(0),
                    Title = reader.IsDBNull(1) ? null : reader.GetString(1),
                    FileName = reader.IsDBNull(2) ? null : reader.GetString(2),
                    DocumentDate = reader.IsDBNull(3) ? null : reader.GetDateTime(3),
                    Classification = reader.IsDBNull(4) ? null : reader.GetString(4)
                },
                new { personId, doctorId });

            data.ActiveConditions = await db.ExecuteListReaderAsync(
                "SELECT id, person_id, name, diagnosed_date, notes, is_active, created_at, updated_at FROM app.medical_conditions WHERE person_id = @personId AND is_active = true ORDER BY name",
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

            data.ActivePrescriptions = await db.ExecuteListReaderAsync(
                @"SELECT p.id, p.person_id, p.doctor_id, p.medication_name, p.dosage, p.frequency, p.rx_number,
                         p.is_active, p.start_date, p.end_date, p.notes, p.created_at, p.updated_at,
                         d.name AS doctor_name
                  FROM app.medical_prescriptions p
                  LEFT JOIN app.medical_doctors d ON p.doctor_id = d.id
                  WHERE p.person_id = @personId AND p.is_active = true
                  ORDER BY p.medication_name",
                reader => new MedicalPrescription
                {
                    Id = reader.GetInt64(0),
                    PersonId = reader.GetInt64(1),
                    DoctorId = reader.IsDBNull(2) ? null : reader.GetInt64(2),
                    MedicationName = reader.GetString(3),
                    Dosage = reader.IsDBNull(4) ? null : reader.GetString(4),
                    Frequency = reader.IsDBNull(5) ? null : reader.GetString(5),
                    RxNumber = reader.IsDBNull(6) ? null : reader.GetString(6),
                    IsActive = reader.GetBoolean(7),
                    StartDate = reader.IsDBNull(8) ? null : reader.GetDateTime(8),
                    EndDate = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                    Notes = reader.IsDBNull(10) ? null : reader.GetString(10),
                    CreatedAt = reader.GetDateTime(11),
                    UpdatedAt = reader.GetDateTime(12),
                    DoctorName = reader.IsDBNull(13) ? null : reader.GetString(13)
                },
                new { personId });

            data.RecentBills = await db.ExecuteListReaderAsync(
                @"SELECT b.id, b.total_amount, b.summary, b.category, b.bill_date
                  FROM app.medical_bills b
                  WHERE b.person_id = @personId AND b.doctor_id = @doctorId
                    AND b.bill_date >= NOW() - INTERVAL '6 months'
                  ORDER BY b.bill_date DESC NULLS LAST LIMIT 10",
                reader => new VisitPrepBill
                {
                    Id = reader.GetInt64(0),
                    TotalAmount = reader.GetDecimal(1),
                    Summary = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Category = reader.IsDBNull(3) ? null : reader.GetString(3),
                    BillDate = reader.IsDBNull(4) ? null : reader.GetDateTime(4)
                },
                new { personId, doctorId });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to get visit prep data for person {PersonId}, doctor {DoctorId}", personId, doctorId);
        }

        return data;
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

public class BillSummary
{
    public decimal TotalCharged { get; set; }
    public decimal TotalPaid { get; set; }
    public decimal TotalDue { get; set; }
    public List<YearBreakdown> ByYear { get; set; } = [];
    public List<ProviderBreakdown> ByProvider { get; set; } = [];
}

public class YearBreakdown
{
    public int Year { get; set; }
    public decimal Total { get; set; }
    public int Count { get; set; }
}

public class ProviderBreakdown
{
    public string ProviderName { get; set; } = "";
    public decimal Total { get; set; }
    public int Count { get; set; }
}

public class LineItemMatchResult
{
    public long BillId { get; set; }
    public bool IsFullMatch { get; set; }
    public int MatchedCount { get; set; }
    public List<MedicalBillCharge> ExistingCharges { get; set; } = [];
}

